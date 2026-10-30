"""Refresh data/calendar.json from raw Google Calendar list_events output — privacy filter included.

The server cannot call the calendar connector itself (that needs an agent with Parent A's read-only grant).
Refresh flow for an agent:
  1. list_calendars + list_events (read-only) for each calendar, next 14 days.
  2. Save each response as data/raw/<anything>.json:  {"calendar": {"id": "...", "name": "..."}, "events": [ ...raw events... ]}
  3. python3 ingest.py            → rewrites data/calendar.json, then deletes data/raw/*.json (use --keep-raw to keep)
Only title, start, end, all-day flag and location survive. Descriptions, attendees, links, IDs, conference data are dropped.
"""
import glob, json, os, re, sys
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import planner  # noqa: E402

KEEP = ("title", "start", "end", "allDay", "location")


def slim(ev):
    """One raw API event → the minimal, private-safe shape used by Family Week."""
    title = (ev.get("summary") or ev.get("title") or "(untitled)").strip()
    if ev.get("status") == "cancelled" and not re.match(r"^\[?cancel", title, re.I):
        title = "[CANCELED] " + title
    s, e = ev.get("start") or {}, ev.get("end") or {}
    if isinstance(s, str):
        s, e = {"dateTime": s}, {"dateTime": e}
    out = {"title": title}
    if "date" in s and "dateTime" not in s:
        out.update(allDay=True, start=s["date"], end=e.get("date", s["date"]))
    else:
        out.update(start=s.get("dateTime"), end=e.get("dateTime") or s.get("dateTime"))
    loc = (ev.get("location") or "").strip()
    if loc:
        out["location"] = loc
    return out


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:24] or "cal"


def ingest(raw_files, cfg, fetched_at=None, window=None):
    ids = cfg.get("calendarIds", {})
    cals, events = [], []
    for f in sorted(raw_files):
        with open(f) as fh:
            raw = json.load(fh)
        meta = raw.get("calendar", {})
        key = ids.get(meta.get("id"), None) or slug(meta.get("name", os.path.basename(f)))
        evs = [dict(slim(e), cal=key) for e in raw.get("events", [])]
        evs = [{k: v for k, v in e.items() if k in KEEP + ("cal",)} for e in evs]
        cals.append({"key": key, "name": meta.get("name", key), "status": raw.get("status", "ok"), "events": len(evs)})
        events.extend(evs)
    return {
        "_note": "Read-only snapshot of Parent A's Google Calendar. Only titles, times and places are kept.",
        "fetchedAt": fetched_at or datetime.now(planner.ET).isoformat(timespec="seconds"),
        "window": window, "calendars": cals, "events": events,
    }


if __name__ == "__main__":
    cfg = planner.load_config()
    files = glob.glob(os.path.join(HERE, "data", "raw", "*.json"))
    if not files:
        sys.exit("no data/raw/*.json files; nothing changed (the existing snapshot is kept)")
    data = ingest(files, cfg)
    out = os.path.join(HERE, cfg["calendarFile"])
    tmp = out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, out)
    if "--keep-raw" not in sys.argv:
        for f in files:
            os.remove(f)
    print(f"wrote {out}: {len(data['events'])} events from {len(data['calendars'])} calendars")
