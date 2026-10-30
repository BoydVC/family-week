"""ingest.py privacy filter. Uses an obviously synthetic fixture (test-only; never shown in the UI)."""
import json, os, sys, tempfile, unittest
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import ingest, planner  # noqa: E402

RAW = {"calendar": {"id": "calendar-4@example.com", "name": "Team Alpha 12U"},
       "events": [
           {"summary": "TEST FIXTURE practice", "start": {"dateTime": "2030-01-01T22:30:00Z"}, "end": {"dateTime": "2030-01-02T00:00:00Z"},
            "description": "secret notes", "attendees": [{"email": "x@example.com"}], "htmlLink": "https://example.com", "location": "Field 1"},
           {"summary": "TEST FIXTURE all-day", "start": {"date": "2030-01-03"}, "end": {"date": "2030-01-04"}},
           {"summary": "TEST FIXTURE gone", "status": "cancelled", "start": {"dateTime": "2030-01-05T10:00:00-05:00"}, "end": {"dateTime": "2030-01-05T11:00:00-05:00"}},
       ]}


class Ingest(unittest.TestCase):
    def test_privacy_and_shape(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "h.json"); json.dump(RAW, open(f, "w"))
            out = ingest.ingest([f], planner.load_config(os.path.join(HERE, "config.json")), fetched_at="2030-01-01T00:00:00-05:00")
        s = json.dumps(out)
        for leak in ("secret", "attendees", "example.com", "htmlLink", "description\""):
            self.assertNotIn(leak, s)
        self.assertEqual(out["calendars"][0]["key"], "alpha")
        e0, e1, e2 = out["events"]
        self.assertEqual(e0["location"], "Field 1")
        self.assertTrue(e1["allDay"])
        self.assertTrue(e2["title"].startswith("[CANCELED]"))
        self.assertTrue(all(set(e) <= {"cal", "title", "start", "end", "allDay", "location"} for e in out["events"]))


if __name__ == "__main__":
    unittest.main()
