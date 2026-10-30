"""Unit tests for the Family Week planner. Run: python3 -m unittest discover -s tests -v"""
import json, os, sys, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import planner  # noqa: E402

CFG = planner.load_config(os.path.join(HERE, "config.json"))
CAL, ST, ERR = planner.load_calendar(os.path.join(HERE, "data", "calendar.json"))
NOW = planner.parse_dt("2026-10-07T16:45:00-04:00")


def plan(now=NOW, cal=CAL, st=ST, err=ERR, weather=None):
    return planner.build_plan(CFG, cal, st, err, now, weather)


def find(p, title, date=None):
    for e in p["events"]:
        if e["title"] == title and (date is None or date in e["dates"]):
            return e
    raise AssertionError(f"event not found: {title} {date}")


class Data(unittest.TestCase):
    def test_snapshot_loads_and_counts_match(self):
        self.assertEqual(ST, "ok")
        counts = {}
        for e in CAL["events"]:
            counts[e["cal"]] = counts.get(e["cal"], 0) + 1
        for c in CAL["calendars"]:
            self.assertEqual(counts.get(c["key"], 0), c["events"], c["name"])
        self.assertEqual(len(CAL["calendars"]), 11)

    def test_privacy_only_titles_times_places(self):
        allowed = {"cal", "title", "start", "end", "allDay", "location"}
        for e in CAL["events"]:
            self.assertTrue(set(e) <= allowed, e)
        raw = json.dumps(CAL["events"]).lower()
        for leak in ("description", "attendee", "passcode", "zoom.us", "htmllink", "@kpd"):
            self.assertNotIn(leak, raw)

    def test_dedupe_and_cancel_stats(self):
        s = plan()["calendar"]["stats"]
        self.assertEqual((s["raw"], s["unique"], s["duplicates"], s["canceled"]), (53, 51, 2, 2))

    def test_utc_converted_to_eastern(self):
        e = find(plan(), "Team Alpha 12U @ SAC/BA boys U12- Premier")
        self.assertEqual(e["start"], "2026-10-09T18:30:00-04:00")
        e = find(plan(), "U14G Club Practice", "2026-10-08")
        self.assertEqual(e["start"], "2026-10-08T19:30:00-04:00")


class Lanes(unittest.TestCase):
    def test_people(self):
        p = plan()
        want = {
            "Bravo 11u - Blue - Practice": "kida", "Team Alpha 12U Practice": "kida", "Kid A hangout with Ty": "kida",
            "U14G Club Practice": "kidb", "Delta 2031 Green - Fall Team practice": "kidb", "HSPT prep class": "kidb",
            "Kid Club Training w/ Coach": "kidb",  # the coach, not Parent A
            "Parent A conference (out of town)": "parenta", "Cap One Breakout": "parenta",
            "Marty’s Pill": "family", "Columbus Day": "family", "Ravens @ Falcons": "family",
            "Bravo 11u - Blue - Potential tournament in Salisbury": "kida",
        }
        for t, who in want.items():
            self.assertEqual(find(p, t)["person"], who, t)
        self.assertFalse(any(e["person"] == "randi" for e in p["events"]))  # nothing invented for Randi

    def test_kinds(self):
        p = plan()
        self.assertEqual(find(p, "2026 WAGS Tournament", "2026-10-10")["kind"], "placeholder")
        self.assertEqual(find(p, "Bravo 11u - Blue at Crofton")["kind"], "game")
        self.assertEqual(find(p, "Team Alpha 12U Practice", "2026-10-13")["kind"], "practice")
        self.assertTrue(find(p, "Bravo 11u - Blue - Perfect Game tournament", "2026-10-17")["allDay"])
        self.assertTrue(find(p, "Bravo 11u - Blue - Potential tournament in Salisbury")["canceled"])


class DriveRules(unittest.TestCase):
    def legs(self, title, date):
        return [(l["type"], l["driver"]) for l in find(plan(), title, date)["legs"]]

    def test_vic_practices_carpool_then_family(self):
        self.assertEqual(self.legs("Bravo 11u - Blue - Practice", "2026-10-07"), [("drop", "Carpool"), ("pickup", "Family")])
        self.assertEqual(self.legs("Team Alpha 12U Practice", "2026-10-15"), [("drop", "Carpool"), ("pickup", "Family")])

    def test_char_tuesday_carpool_thursday_family(self):
        self.assertEqual(self.legs("U14G Club Practice", "2026-10-13"), [("drop", "Carpool"), ("pickup", None)])
        self.assertEqual(self.legs("U14G Club Practice", "2026-10-08"), [("drop", "Family"), ("pickup", None)])

    def test_games_are_never_auto_assigned(self):
        self.assertEqual(self.legs("Team Alpha 12U vs Towson United U12B Maroon", "2026-10-10"), [("drop", None), ("pickup", None)])
        self.assertEqual(self.legs("Bravo 11u - Blue at Crofton", "2026-10-14"), [("drop", None), ("pickup", None)])

    def test_only_rule_drivers_ever_appear(self):
        for e in plan()["events"]:
            for l in e["legs"]:
                self.assertIn(l["driver"], (None, "Carpool", "Family"), e["title"])
        raw = json.dumps(plan()).lower()
        for name in ("grandparente", "grandparentd", "grandpa", "grandma"):
            self.assertNotIn(name, raw)

    def test_tournament_day_is_one_trip_not_four_legs(self):
        a = find(plan(), "12/13 Club vs Cleveland Force SC ECNL RL G2012/13")
        b = find(plan(), "12/13 Club vs Hereford Soccer Club U14G Maroon N1")
        self.assertEqual([l["type"] for l in a["legs"]], ["drop"])
        self.assertEqual([l["type"] for l in b["legs"]], ["pickup"])

    def test_canceled_has_no_legs(self):
        self.assertEqual(find(plan(), "Bravo 11u - Blue - Potential tournament in Salisbury")["legs"], [])


class Conflicts(unittest.TestCase):
    def by_date(self):
        out = {}
        for c in plan()["conflicts"]:
            out.setdefault(c["date"], []).append((c["type"], c["severity"]))
        return out

    def test_expected_conflicts(self):
        d = self.by_date()
        self.assertIn(("rides", "warn"), d["2026-10-10"])        # Aldie VA vs Ellicott City
        self.assertIn(("double", "hard"), d["2026-10-11"])       # Kid B: Delta vs WAGS game
        self.assertIn(("rides", "hard"), d["2026-10-15"])        # Family drop Kid B 7:30 + Family pick Kid A 8:00, Parent A away
        self.assertIn(("rides", "warn"), d["2026-10-17"])        # Kid A in Quinton VA vs Kid B in Harwood
        self.assertIn(("double", "hard"), d["2026-10-18"])       # Kid A: tournament vs Alpha game
        self.assertIn(("rides", "warn"), d["2026-10-19"])        # 7:00 Gambrills vs 7:30 Hometown
        self.assertIn(("double", "info"), d["2026-10-20"])       # Parent A overlapping work meetings

    def test_no_false_alarms(self):
        d = self.by_date()
        self.assertNotIn("2026-10-07", d)
        self.assertNotIn("2026-10-08", d)
        self.assertNotIn(("rides", "warn"), d.get("2026-10-13", []))   # 8:00 vs 9:00 pickups are an hour apart
        self.assertNotIn("2026-10-21", d)

    def test_canceled_never_conflicts(self):
        p = plan()
        cx = {e["id"] for e in p["events"] if e["canceled"]}
        for c in p["conflicts"]:
            self.assertFalse(cx & set(c["events"]), c)

    def test_away_days(self):
        self.assertEqual(sorted(plan()["away"]), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"])


class Views(unittest.TestCase):
    def test_tonight(self):
        p = plan()
        self.assertEqual([find_id(p, i)["short"] for i in p["tonight"]], ["API practice"])
        late = plan(planner.parse_dt("2026-10-07T21:30:00-04:00"))
        self.assertEqual(late["tonight"], [])

    def test_days_and_games(self):
        p = plan()
        self.assertEqual(len(p["days"]), 14)
        self.assertEqual(p["days"][0]["date"], "2026-10-07")
        self.assertTrue(p["days"][0]["isToday"])
        self.assertEqual(p["games"][0]["short"], "Alpha @ SAC/BA boys U12- Premier")
        self.assertEqual(len([g for g in p["games"] if g["short"].startswith("Club vs Hereford")]), 0)  # folded into tournament day

    def test_weather_attaches_by_date_only(self):
        p = plan(weather={"daily": [{"date": "2026-10-08", "hi": 78, "lo": 57, "pop": 1}]})
        self.assertIsNone(p["days"][0]["weather"])
        self.assertEqual(p["days"][1]["weather"]["hi"], 78)


class Failure(unittest.TestCase):
    def test_missing_file_is_unavailable_not_invented(self):
        cal, st, err = planner.load_calendar("/nonexistent/calendar.json")
        self.assertEqual(st, "unavailable")
        p = plan(cal=cal, st=st, err=err)
        self.assertEqual(p["calendar"]["status"], "unavailable")
        self.assertEqual((p["events"], p["conflicts"], p["games"], p["tonight"]), ([], [], [], []))

    def test_empty_calendar(self):
        p = plan(cal={"fetchedAt": NOW.isoformat(), "events": []}, st="empty", err=None)
        self.assertEqual(p["calendar"]["status"], "empty")
        self.assertEqual(p["events"], [])

    def test_stale_after_36h(self):
        p = plan(now=planner.parse_dt("2026-10-09T12:00:00-04:00"))
        self.assertEqual(p["calendar"]["status"], "stale")


def find_id(p, i):
    return next(e for e in p["events"] if e["id"] == i)


if __name__ == "__main__":
    unittest.main()
