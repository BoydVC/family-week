# Family Week: the family's kitchen-display week planner

**Live:** http://127.0.0.1:4847 · kiosk: `/kiosk` or `/?kiosk=1` · ambient: `/ambient` or `/?mode=ambient`
**Offline:** `dist/family-week-snapshot.html` (one self-contained file, about 0.5 MB, works from `file://`)

A 1920×1080 board for the kitchen TV. It shows who has to be where, who drives each leg, and where the week breaks.
It shares Parent A Wall's design system (tokens, fonts, starfield, ambient and kiosk modes) and reuses its cached weather.

## What's on screen
| Area | What it shows |
|---|---|
| **Header pulse** | Ride and hard conflicts, count of legs that still say "needs a driver?", rule-based Family legs, and game days in the current view |
| **7-day board** (default) | One color-coded lane per person: **Kid B** (pink), **Kid A** (teal), **Parent A** (green), **Randi** (violet), **Family** (blue). Each kid card has drive legs: ↓ drop / ↑ pick up, with **Family**, **Carpool**, or an amber dashed **needs a driver?** |
| **14-day board** | Same lanes over two weeks with compact cards. The side column folds away for width |
| **Timeline** | A clock view of each day, 7 AM to 11 PM. Kid bars carry leg markers (`↓C` carpool, `↑B` Family, `?` needs a driver). Hatched red/amber bands mark conflicts, and a now-line runs across today |
| **Day headers** | Weather per day (hi/lo/rain% from Parent A Wall; days past the 7-day forecast say "no forecast"), game-day badges per kid, conflict badges, ✈ when Parent A is away |
| **Tonight** | Tonight's events with venue and legs, current temperature, sunset, evening temps, and a "next drive" countdown. After 9 PM it rolls over to tomorrow |
| **Conflicts** | All conflicts for the next 14 days, hard and ride conflicts first. Pages every 12 s when they don't fit |
| **Game days** | The next games and tournaments, each with a live countdown |
| **Ambient** | Big clock, the next drive, and this week's conflict count. Turns on automatically 11 PM to 6 AM in kiosk mode (`?ambient=auto`) |

Keys: `W` toggles 7/14 days · `T` timeline · `A` ambient · `F` fullscreen · `R` reload data. Clicking the 7 DAYS / 14 DAYS / TIMELINE buttons works too.
URL options: `?view=7|14|tl`, `?kiosk=1` (no cursor, reload every 6 h, auto-ambient), `?cycle=1` (rotates 7 → timeline → 14 every 45 s),
`?mode=ambient`, `?still=1` (no motion), `?now=2026-10-15T16:30:00-04:00` (time travel), `?simulate=outage|empty`.

## Household rules (config.json → `driveRules`)
- **Kid A: Bravo 11u and Team Alpha practices.** He carpools there (↓ Carpool) and the Family pick up (↑ Family). This covers practices only, not games.
- **Kid B: Club practice on Tuesdays.** She carpools there (↓ Carpool). Her pickup isn't specified, so it shows **needs a driver?**
- **Kid B: Club practice on Thursdays at Venue 1, Hometown.** The Family drive her there (↓ Family). Her pickup shows **needs a driver?**
- **Everything else** (games, tournaments, Delta lacrosse, HSPT, hangouts) shows **needs a driver?** on both legs.
- **Nobody else is ever auto-assigned.** That includes Grandma and Grandpa (Grandparents C and D) and Grandparent E. "Family" means either parent; the board never picks one.
- **Tournament days** at one venue become a single drop and a single pickup. **All-day away tournaments** become one 🚗 trip leg.
- **Parent A away.** Parent A-lane all-day events like "Parent A conference (out of town)" mark away days with ✈. Family legs on those days are flagged because one parent covers both.

### Conflict engine (planner.py)
| Type | Severity | When it fires |
|---|---|---|
| **rides** | `warn` | Two kids each need a family driver (Family or unassigned) at the same time, at different places. At practices a leg occupies ±30 min. At games and away tournaments the driver is assumed to stay, so the whole game counts plus 45 min of travel. |
| **rides** | `hard` | Both legs are Family legs and Parent A is away. |
| **double** | `hard` | The same kid is on the calendar twice at once. |
| **double** | `info` | One side is a 1-hour tournament placeholder, or the overlap is two of Parent A's work meetings. |
| **coverage** | `info` | A summary of every family leg on Parent A's away days. |

Canceled events (`[CANCELED]…`) are struck through and never cause conflicts. Duplicate events across calendars are merged.

## Data and privacy
- `data/calendar.json` is a **read-only snapshot** of Parent A's Google Calendar (11 calendars). I read it through the calendar connector with `list_calendars` and `list_events` only, so there were no creates, updates, deletes or RSVPs.
- **Only titles, times and places are stored.** Descriptions, attendees, links, conference info and IDs are dropped, and tests enforce this.
- Everything stays local. The server binds to 127.0.0.1 only, and nothing is sent anywhere.
- **Lanes:**
  - Owner comes from the calendar (Alpha → Kid A, 360Player/Club → Kid B, KPD work import → Parent A), from a title prefix (`Bravo 11u` → Kid A, `Delta 2031` → Kid B), or from a name in a Family Events title.
  - **HSPT → Kid B is an inference:** it's the 8th-grade placement test.
  - "Coach" on the Club calendar stays in Kid B's lane.
- **Weather** is taken from Parent A Wall: first its `/api/wall`, then Family Week's last copy, then Parent A Wall's raw Open-Meteo cache file. Family Week never calls a weather API itself.
- **Honest failure:**
  - A missing or unreadable snapshot shows "Calendar unavailable" with nothing guessed.
  - An empty calendar shows "Nothing on the calendar".
  - A snapshot older than 36 h is chipped as stale.
  - Randi's lane says no calendar of hers is connected.

### Refreshing the calendar
The server can't call the calendar connector itself, so a refresh needs an agent with Parent A's read-only grant:
1. Run `list_calendars` and `list_events` for each calendar over the next 14 days.
2. Save each response as `data/raw/<name>.json` in the form `{"calendar": {"id", "name"}, "events": [...]}`.
3. Run `python3 ingest.py`. It privacy-filters the events, rewrites `data/calendar.json` atomically, and deletes the raw files.

The board picks up the change within 60 s; no restart is needed.

## Run / test / build
```bash
./run.sh start|restart|stop|status     # server on 127.0.0.1:4847 (pid in data/server.pid, log in data/server.log)
tests/run.sh                            # 23 unit tests + 34-check CDP smoke test (live + offline snapshot)
python3 export_snapshot.py              # → dist/family-week-snapshot.html
./refresh_screenshots.sh                # → screenshots/*.png at 1920×1080
python3 planner.py 2026-10-07T16:45:00-04:00   # print conflicts and legs in the terminal
```

## Files
`server.py` (stdlib HTTP) · `planner.py` (lanes, legs, conflicts; pure functions) · `ingest.py` (refresh + privacy filter) · `config.json` (people, colors, rules, calendar IDs) · `data/calendar.json` (snapshot) · `web/` (index.html, style.css, app.js, fonts) · `tests/` · `dist/` · `screenshots/`


---
## Repo notes
- **Built:** 2026-10-15, by TokenMax (Parent A's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/family-week` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
