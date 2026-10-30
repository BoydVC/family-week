"""Family Week planner: turns a read-only calendar snapshot into lanes, drive legs and conflicts.

Pure functions, stdlib only. Never invents events: everything shown comes from data/calendar.json;
drive drivers come only from the household rules in config.json, otherwise "needs a driver?".
"""
import json, os, re
from datetime import datetime, date, timedelta, time as dtime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ET = ZoneInfo("America/New_York")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TOWNS = ["Nearby Town", "Gambrills", "Severn", "Ellicott City", "Aldie", "Hometown", "Harwood",
         "Quinton", "Orlando", "Crofton", "Hometown", "Salisbury"]
STATE = {"Nearby Town": "MD", "Gambrills": "MD", "Severn": "MD", "Ellicott City": "MD", "Aldie": "VA",
         "Hometown": "MD", "Harwood": "MD", "Quinton": "VA", "Orlando": "FL", "Crofton": "MD",
         "Hometown": "MD", "Salisbury": "MD"}
SHORTEN = [
    (r"^Bravo 11u - Blue - Practice$", "API practice"),
    (r"^Bravo 11u - Blue - ", "API · "),
    (r"^Bravo 11u - Blue ", "API "),
    (r"^Team Alpha 12U Practice$", "Alpha practice"),
    (r"^Team Alpha 12U ", "Alpha "),
    (r"^U14G Club Practice$", "Club practice"),
    (r"^12/13 Club vs\.? ", "Club vs "),
    (r"^Delta 2031 Green - Fall Team practice$", "Delta lax practice"),
    (r"^Delta 2031 Green - ", "Delta · "),
]
CANCEL_RE = re.compile(r"^\s*(\[CANCELL?ED\]|CANCELL?ED:?)\s*", re.I)
GAME_RE = re.compile(r"(\bvs\.?\s|@|\sat\s|tournament|championship|\bgame\b)", re.I)
PRACTICE_RE = re.compile(r"(practice|training)", re.I)
TBD = {"", "tbd", "tba", "tbd."}


def load_config(path=None):
    with open(path or os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def load_calendar(path):
    """Returns (data, status, error). Never raises."""
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data.get("events"), list):
            raise ValueError("no events list")
        return data, ("empty" if not data["events"] else "ok"), None
    except FileNotFoundError:
        return None, "unavailable", "calendar snapshot not found"
    except Exception as e:  # noqa
        return None, "unavailable", f"calendar snapshot unreadable: {e}"


def parse_dt(s):
    if len(s) == 10:
        d = date.fromisoformat(s)
        return datetime.combine(d, dtime(0), ET)
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ET)


def short_title(t):
    for pat, rep in SHORTEN:
        n = re.sub(pat, rep, t)
        if n != t:
            return n
    return t


def place_parts(loc):
    if not loc or loc.strip().lower() in TBD:
        return None, None, None
    loc = loc.strip()
    town = next((t for t in TOWNS if t.lower() in loc.lower()), None)
    first = re.split(r"\s+-\s+|,|\n", loc)[0].strip()
    venue = None if re.match(r"^\d", first) else first
    venue_key = re.sub(r"\s*\((field|turf)[^)]*\)", "", (venue or loc), flags=re.I).strip().lower()
    town_s = f"{town}, {STATE[town]}" if town else None
    return venue, town_s, venue_key


def person_for(ev, cfg):
    L = cfg["lanes"]
    cal, title = ev["cal"], ev["title"]
    for prefix, who, *_ in L["byTitlePrefix"]:
        if title.startswith(prefix):
            return who
    if cal in L["ownerWordsOnlyOn"]:
        for word, who, *_ in L["byTitleWord"]:
            if re.search(r"\b" + re.escape(word) + r"\b", title):
                return who
    return L["byCalendar"].get(cal, "family")


def normalize(raw_events, cfg):
    """Dedupe, classify and enrich events. Returns (events, stats)."""
    out, seen, dup = [], {}, 0
    for i, ev in enumerate(raw_events):
        start, end = parse_dt(ev["start"]), parse_dt(ev["end"])
        title = ev["title"].strip()
        canceled = bool(CANCEL_RE.match(title))
        clean = CANCEL_RE.sub("", title)
        all_day = bool(ev.get("allDay")) or (start.time() == dtime(0) and end.time() == dtime(0) and end > start)
        key = (clean.lower(), start.isoformat() if not all_day else start.date().isoformat())
        if key in seen:
            seen[key]["alsoOn"].append(ev["cal"])
            dup += 1
            continue
        venue, town, venue_key = place_parts(ev.get("location"))
        person = person_for(dict(ev, title=clean), cfg)
        kid = person in cfg["kids"]
        dur = (end - start).total_seconds() / 60
        placeholder = bool(re.search(r"tournament", clean, re.I)) and not venue and not town and dur <= 60 and not all_day
        if ev["cal"] in cfg.get("tv", []):
            kind = "tv"
        elif ev["cal"] == "work":
            kind = "meeting"
        elif placeholder:
            kind = "placeholder"
        elif kid and PRACTICE_RE.search(clean):
            kind = "practice"
        elif kid and GAME_RE.search(clean):
            kind = "game"
        elif all_day:
            kind = "allday"
        else:
            kind = "event"
        e = {
            "id": f"e{i}", "cal": ev["cal"], "title": clean, "short": short_title(clean),
            "start": start.isoformat(), "end": end.isoformat(), "allDay": all_day,
            "location": ev.get("location"), "venue": venue, "town": town, "venueKey": venue_key,
            "person": person, "kind": kind, "canceled": canceled, "alsoOn": [], "legs": [],
            "placeUnknown": not (venue or town),
        }
        if all_day:
            days = []
            d = start.date()
            last = (end - timedelta(seconds=1)).date()
            while d <= last:
                days.append(d.isoformat()); d += timedelta(days=1)
            e["dates"] = days
        else:
            e["dates"] = [start.date().isoformat()]
        seen[key] = e
        out.append(e)
    out.sort(key=lambda e: (e["start"], not e["allDay"]))
    stats = {"raw": len(raw_events), "unique": len(out), "duplicates": dup,
             "canceled": sum(1 for e in out if e["canceled"])}
    return out, stats


def away_days(events, cfg):
    pat = re.compile(cfg["awayPattern"])
    away = {}
    for e in events:
        if e["person"] == "parenta" and e["allDay"] and not e["canceled"] and pat.search(e["title"]):
            for d in e["dates"]:
                away[d] = e["title"]
    return away


def _rule_for(e, cfg):
    wd = parse_dt(e["start"]).weekday()
    for r in cfg["driveRules"]:
        if r["person"] != e["person"]:
            continue
        if r.get("calendar") and r["calendar"] != e["cal"]:
            continue
        if r.get("match") == "practice" and e["kind"] != "practice":
            continue
        if "weekday" in r and r["weekday"] != wd:
            continue
        # Alpha/API practices only for Kid A; Club rule only for Club calendar practices
        if r["id"] == "kida-practice" and "training" in e["title"].lower():
            continue
        return r
    return None


def assign_legs(events, cfg):
    """Drive legs for kid events. Driver = rule value or None (=> 'needs a driver?')."""
    kids = cfg["kids"]
    cand = [e for e in events if e["person"] in kids and not e["canceled"]
            and e["kind"] not in ("tv", "placeholder")]
    # group same-kid, same-day, same-venue timed events (tournament days) into blocks
    blocks = []
    for e in cand:
        if e["allDay"]:
            blocks.append([e]); continue
        prev = blocks[-1] if blocks else None
        for b in reversed(blocks):
            last = b[-1]
            if (not last["allDay"] and last["person"] == e["person"] and last["dates"] == e["dates"]
                    and last["venueKey"] and last["venueKey"] == e["venueKey"]
                    and parse_dt(e["start"]) - parse_dt(last["end"]) < timedelta(hours=4)):
                b.append(e); prev = None; break
        else:
            prev = True
        if prev is not None:
            blocks.append([e])
    for b in blocks:
        first, last = b[0], b[-1]
        bid = first["id"]
        for e in b:
            e["block"] = bid
            e["blockSize"] = len(b)
        if first["allDay"]:
            where = first["town"] or first["venue"] or "venue TBD"
            first["legs"] = [{"type": "trip", "label": f"Trip to {where}", "time": None,
                              "driver": None, "rule": None, "date": first["dates"][0]}]
            continue
        rule = _rule_for(first, cfg)
        drop = rule["drop"] if rule else None
        pick = rule["pickup"] if rule else None
        first["legs"].append({"type": "drop", "time": first["start"], "driver": drop,
                              "rule": rule["id"] if rule else None, "date": first["dates"][0]})
        last["legs"].append({"type": "pickup", "time": last["end"], "driver": pick,
                             "rule": rule["id"] if rule else None, "date": last["dates"][0]})
        for e in b:
            e["rule"] = rule["id"] if rule else None
            e["ruleWhy"] = rule["why"] if rule else None
    return blocks


def _family(driver):
    return driver in (None, "Family")


def busy_intervals(blocks, cfg):
    """Times when a family driver is committed, per block."""
    win = timedelta(minutes=cfg["conflictWindowMin"])
    buf = timedelta(minutes=cfg["gameBufferMin"])
    out = []
    for b in blocks:
        first, last = b[0], b[-1]
        if first["allDay"]:
            for d in first["dates"]:
                s = datetime.combine(date.fromisoformat(d), dtime(0), ET)
                out.append({"block": first["id"], "person": first["person"], "date": d, "s": s,
                            "e": s + timedelta(days=1), "drivers": [None], "what": "trip",
                            "where": first["town"] or first["venue"]})
            continue
        if first["placeUnknown"] and not first.get("rule"):
            continue  # no place, no rule: show legs but don't guess at conflicts
        legs = first["legs"][:1] + last["legs"][-1:]
        stays = first["kind"] == "game" and all(_family(l["driver"]) for l in legs)
        if stays:
            out.append({"block": first["id"], "person": first["person"], "date": first["dates"][0],
                        "s": parse_dt(first["start"]) - buf, "e": parse_dt(last["end"]),
                        "drivers": [l["driver"] for l in legs], "what": "game",
                        "where": first["town"] or first["venue"]})
        else:
            for l in legs:
                if _family(l["driver"]):
                    t = parse_dt(l["time"])
                    out.append({"block": first["id"], "person": first["person"], "date": l["date"],
                                "s": t - win, "e": t + win, "drivers": [l["driver"]], "what": l["type"],
                                "t": t, "where": first["town"] or first["venue"]})
    return out


def fmt_t(dt):
    h = dt.hour % 12 or 12
    return f"{h}:{dt.minute:02d}" + (" AM" if dt.hour < 12 else " PM")


def detect_conflicts(events, blocks, away, cfg):
    by_id = {e["id"]: e for e in events}
    conflicts = []
    busy = busy_intervals(blocks, cfg)
    pairs = set()
    for i, a in enumerate(busy):
        for b in busy[i + 1:]:
            if a["person"] == b["person"] or a["date"] != b["date"]:
                continue
            if not (a["s"] < b["e"] and b["s"] < a["e"]):
                continue
            k = (a["date"], a["block"], b["block"])
            if k in pairs:
                continue
            pairs.add(k)
            ea, eb = by_id[a["block"]], by_id[b["block"]]
            family = [d for d in a["drivers"] + b["drivers"] if d == "Family"]
            is_away = a["date"] in away
            def desc(x, e):
                if x["what"] == "trip":
                    return f"{e['person'].title()} away all day ({x['where']})"
                if x["what"] == "game":
                    return f"{e['person'].title()} at {e['short']} {fmt_t(parse_dt(e['start']))} ({x['where'] or 'place TBD'})"
                verb = "drop-off" if x["what"] == "drop" else "pickup"
                who = "Family" if x["drivers"][0] == "Family" else "needs a driver?"
                return f"{e['person'].title()} {verb} {fmt_t(x['t'])} · {e['short']} ({x['where'] or 'place not on calendar'}) · {who}"
            sev = "hard" if (len(family) >= 2 and is_away) else "warn"
            note = ("Parent A is away (" + away[a["date"]] + "), so both Family legs land on one driver"
                    if is_away and family else
                    ("Both are Family legs at once, so it takes two cars" if len(family) >= 2 else
                     "Two drivers are needed at the same time"))
            conflicts.append({"type": "rides", "severity": sev, "date": a["date"],
                              "title": "Two rides at once" if sev == "warn" else "One driver, two places",
                              "items": [desc(a, ea), desc(b, eb)], "note": note,
                              "events": sorted({a["block"], b["block"]}),
                              "at": min(a["s"], b["s"]).isoformat()})
    # same-person double-bookings
    live = [e for e in events if not e["canceled"] and e["kind"] != "tv"]
    for i, a in enumerate(live):
        for b in live[i + 1:]:
            if a["person"] != b["person"] or a.get("block") and a.get("block") == b.get("block"):
                continue
            if a["allDay"] and b["allDay"]:
                continue
            if (a["allDay"] and a["placeUnknown"]) or (b["allDay"] and b["placeUnknown"]):
                continue
            if a["allDay"] or b["allDay"]:
                ad, td = (a, b) if a["allDay"] else (b, a)
                if td["dates"][0] not in ad["dates"]:
                    continue
                if ad["town"] and td["town"] and ad["town"] == td["town"]:
                    continue
            elif not (parse_dt(a["start"]) < parse_dt(b["end"]) and parse_dt(b["start"]) < parse_dt(a["end"])):
                continue
            ph = "placeholder" in (a["kind"], b["kind"])
            sev = "info" if (ph or a["person"] == "parenta") else "hard"
            who = a["person"].title()
            def line(e):
                if e["allDay"]:
                    return f"{e['short']} · all day · {e['town'] or e['venue'] or 'place TBD'}"
                return f"{e['short']} · {fmt_t(parse_dt(e['start']))}–{fmt_t(parse_dt(e['end']))} · {e['venue'] or e['town'] or 'place TBD'}"
            d = (b if a["allDay"] else a)["dates"][0]
            conflicts.append({"type": "double", "severity": sev, "date": d,
                              "title": f"{who} is double-booked" + (" (placeholder time)" if ph else ""),
                              "items": [line(a), line(b)],
                              "note": ("One side is a 1-hour tournament placeholder; real times not posted yet" if ph else
                                       ("Overlapping work meetings" if a["person"] == "parenta" else
                                        "Both are on the calendar for the same time")),
                              "events": [a["id"], b["id"]],
                              "at": (b if a["allDay"] else a)["start"]})
    # coverage while Parent A is away
    for d, why in sorted(away.items()):
        legs = [(e, l) for e in events for l in e["legs"]
                if l["date"] == d and _family(l["driver"]) and not e["canceled"]]
        if legs:
            items = []
            for e, l in legs:
                t = fmt_t(parse_dt(l["time"])) if l["time"] else "all day"
                items.append(f"{e['person'].title()} {l['type']} {t} · {e['short']} · "
                             + ("Family" if l["driver"] == "Family" else "needs a driver?"))
            conflicts.append({"type": "coverage", "severity": "info", "date": d,
                              "title": "Parent A away: reduced coverage", "items": items,
                              "note": why, "events": sorted({e["id"] for e, _ in legs}),
                              "at": d + "T00:00:00-04:00"})
    sev_rank = {"hard": 0, "warn": 1, "info": 2}
    conflicts.sort(key=lambda c: (c["date"], sev_rank[c["severity"]], c["at"]))
    for i, c in enumerate(conflicts):
        c["id"] = f"c{i}"
    return conflicts


def build_plan(cfg, cal, cal_status, cal_error, now, weather=None, ndays=14):
    events, stats = ([], {"raw": 0, "unique": 0, "duplicates": 0, "canceled": 0})
    if cal and cal_status == "ok":
        events, stats = normalize(cal["events"], cfg)
    away = away_days(events, cfg)
    blocks = assign_legs(events, cfg)
    conflicts = detect_conflicts(events, blocks, away, cfg)
    today = now.astimezone(ET).date()
    wx = {d["date"]: d for d in (weather or {}).get("daily", [])}
    days = []
    for i in range(ndays):
        d = today + timedelta(days=i)
        ds = d.isoformat()
        evs = [e for e in events if ds in e["dates"]]
        games = [e for e in evs if e["kind"] == "game" and not e["canceled"]]
        days.append({
            "date": ds, "dow": DOW[d.weekday()], "dom": d.day, "month": d.strftime("%b"),
            "isToday": i == 0, "away": away.get(ds), "weather": wx.get(ds),
            "events": [e["id"] for e in evs], "conflicts": [c["id"] for c in conflicts if c["date"] == ds],
            "gameDay": [e["person"] for e in games],
            "legs": {
                "family": sum(1 for e in evs for l in e["legs"] if l["date"] == ds and l["driver"] == "Family" and not e["canceled"]),
                "needs": sum(1 for e in evs for l in e["legs"] if l["date"] == ds and l["driver"] is None and not e["canceled"]),
                "carpool": sum(1 for e in evs for l in e["legs"] if l["date"] == ds and l["driver"] == "Carpool" and not e["canceled"]),
            },
        })
    horizon_end = (today + timedelta(days=ndays)).isoformat()
    games = [{"id": e["id"], "person": e["person"], "short": e["short"], "start": e["start"],
              "allDay": e["allDay"], "venue": e["venue"], "town": e["town"], "date": e["dates"][0]}
             for e in events if e["kind"] == "game" and not e["canceled"]
             and parse_dt(e["end"]) > now and e["dates"][0] < horizon_end]
    # one countdown per tournament block (first game of a same-venue day)
    seen_b, gl = set(), []
    for g in games:
        b = next(e for e in events if e["id"] == g["id"]).get("block")
        if b in seen_b:
            continue
        seen_b.add(b); gl.append(g)
    tonight_cut = datetime.combine(today, dtime(15), ET)
    t_start = max(now, tonight_cut) if now < datetime.combine(today, dtime(23, 59), ET) else now
    tonight = [e["id"] for e in events if today.isoformat() in e["dates"] and not e["allDay"]
               and parse_dt(e["end"]) > min(now, t_start) and parse_dt(e["end"]) > tonight_cut]
    fetched = parse_dt(cal["fetchedAt"]) if cal and cal.get("fetchedAt") else None
    age_min = round((now - fetched).total_seconds() / 60) if fetched else None
    shown_status = cal_status
    if cal_status == "ok" and age_min is not None and age_min > 36 * 60:
        shown_status = "stale"
    return {
        "now": now.isoformat(),
        "calendar": {"status": shown_status, "error": cal_error,
                     "fetchedAt": cal.get("fetchedAt") if cal else None, "ageMin": age_min,
                     "window": cal.get("window") if cal else None,
                     "calendars": cal.get("calendars", []) if cal else [], "stats": stats},
        "people": cfg["people"], "unassignedLabel": cfg["unassignedLabel"],
        "rules": [{"id": r["id"], "why": r["why"]} for r in cfg["driveRules"]],
        "away": away, "days": days, "events": events, "conflicts": conflicts,
        "games": gl, "tonight": tonight,
    }


if __name__ == "__main__":
    import sys
    cfg = load_config()
    cal, st, err = load_calendar(os.path.join(HERE, cfg["calendarFile"]))
    now = parse_dt(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(ET)
    p = build_plan(cfg, cal, st, err, now)
    print(json.dumps(p["calendar"]["stats"]), "status", p["calendar"]["status"])
    for c in p["conflicts"]:
        print(c["date"], c["severity"].upper(), c["title"], "|", " // ".join(c["items"]), "|", c["note"])
    print("games:", [(g["date"], g["person"], g["short"]) for g in p["games"]])
    print("tonight:", [next(e["short"] for e in p["events"] if e["id"] == i) for i in p["tonight"]])
    for e in p["events"]:
        if e["legs"]:
            print(e["dates"][0], e["person"], e["short"], [(l["type"], l["driver"] or "needs a driver?") for l in e["legs"]])
