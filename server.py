"""Family Week server: http://127.0.0.1:4847  (stdlib only, read-only, local-only)."""
import json, os, sys, threading, time, urllib.request, mimetypes
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planner  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
CACHE = os.path.join(HERE, "data", "cache")
os.makedirs(CACHE, exist_ok=True)
CFG = planner.load_config()
STATE = {"weather": None, "weatherAt": 0}
LOCK = threading.Lock()


def _weather_from_wall():
    """Reuse Parent A Wall's weather (its API, then its on-disk cache). No new upstream calls."""
    try:
        with urllib.request.urlopen(CFG["weather"]["wallApi"], timeout=4) as r:
            w = json.load(r)["weather"]
        out = {"daily": w.get("daily") or [], "hourly": w.get("hourly") or [], "current": w.get("current"),
               "source": w.get("source"), "location": w.get("location"),
               "state": (w.get("status") or {}).get("state", "live"),
               "fetchedAt": (w.get("status") or {}).get("fetchedAt"), "via": "Parent A Wall API"}
        with open(os.path.join(CACHE, "weather.json"), "w") as f:
            json.dump(out, f)
        return out
    except Exception:
        pass
    for path, via in ((os.path.join(CACHE, "weather.json"), "Family Week cache"),):
        try:
            with open(path) as f:
                out = json.load(f)
            out["state"] = "stale"; out["via"] = via
            return out
        except Exception:
            pass
    try:  # last resort: Parent A Wall's raw Open-Meteo cache
        with open(CFG["weather"]["wallCache"]) as f:
            raw = json.load(f)
        d = raw["data"]["daily"]
        daily = [{"date": t, "hi": d["temperature_2m_max"][i], "lo": d["temperature_2m_min"][i],
                  "pop": d["precipitation_probability_max"][i], "text": None, "icon": None}
                 for i, t in enumerate(d["time"])]
        return {"daily": daily, "hourly": [], "current": None, "source": "Open-Meteo (via Parent A Wall cache)",
                "state": "stale", "fetchedAt": raw.get("fetchedAt"), "via": "Parent A Wall cache file"}
    except Exception:
        return {"daily": [], "hourly": [], "current": None, "state": "unavailable", "via": None}


def weather():
    with LOCK:
        if not STATE["weather"] or time.time() - STATE["weatherAt"] > 300:
            STATE["weather"] = _weather_from_wall()
            STATE["weatherAt"] = time.time()
        return STATE["weather"]


def plan(qs):
    now = datetime.now(planner.ET)
    if qs.get("now"):
        try:
            now = planner.parse_dt(qs["now"][0])
        except Exception:
            pass
    sim = (qs.get("simulate") or [""])[0]
    if sim == "outage":
        cal, st, err = None, "unavailable", "simulated outage: calendar snapshot unreadable"
        wx = {"daily": [], "hourly": [], "current": None, "state": "unavailable", "via": None}
    elif sim == "empty":
        cal, st, err = {"fetchedAt": now.isoformat(), "events": [], "calendars": []}, "empty", None
        wx = weather()
    else:
        cal, st, err = planner.load_calendar(os.path.join(HERE, CFG["calendarFile"]))
        wx = weather()
    p = planner.build_plan(CFG, cal, st, err, now, wx, ndays=14)
    p["weather"] = {k: wx.get(k) for k in ("state", "source", "via", "fetchedAt", "location", "current")}
    p["weather"]["hourly"] = [h for h in wx.get("hourly", []) if h.get("time", "")[:10] == now.date().isoformat()]
    p["weather"]["days"] = len(wx.get("daily", []))
    return p


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store"):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        p = u.path
        if p == "/api/week":
            return self._send(200, json.dumps(plan(qs)))
        if p == "/api/health":
            cal, st, err = planner.load_calendar(os.path.join(HERE, CFG["calendarFile"]))
            return self._send(200, json.dumps({"ok": True, "calendar": st, "error": err,
                                               "weather": (STATE["weather"] or {}).get("state")}))
        if p in ("/", "/kiosk", "/ambient", "/index.html"):
            p = "/index.html"
        f = os.path.normpath(os.path.join(WEB, p.lstrip("/")))
        if not f.startswith(WEB) or not os.path.isfile(f):
            return self._send(404, "not found", "text/plain")
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if f.endswith(".woff2"):
            ctype = "font/woff2"
        with open(f, "rb") as fh:
            self._send(200, fh.read(), ctype, "no-cache")


class S(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", CFG["port"]))
    print(f"Family Week on http://127.0.0.1:{port}", flush=True)
    S(("127.0.0.1", port), H).serve_forever()
