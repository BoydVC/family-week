#!/usr/bin/env bash
# Regenerates every 1920×1080 screenshot in screenshots/ (server must be running on :4847).
cd "$(dirname "$0")"
U=http://127.0.0.1:4847; N="now=2026-10-07T16:45:00-04:00"
python3 export_snapshot.py >/dev/null
./screenshot.sh "$U/?still=1&view=7&$N"                         screenshots/week.png
./screenshot.sh "$U/?still=1&view=14&$N"                        screenshots/fortnight-14day.png
./screenshot.sh "$U/?still=1&view=tl&$N"                        screenshots/timeline.png
./screenshot.sh "$U/?still=1&view=7&now=2026-10-15T16:30:00-04:00" screenshots/conflict-day-oct15.png
./screenshot.sh "$U/?still=1&view=tl&now=2026-10-10T12:20:00-04:00" screenshots/timeline-tournament-weekend.png
./screenshot.sh "$U/?still=1&view=7&now=2026-10-07T21:30:00-04:00" screenshots/tonight-late.png
./screenshot.sh "$U/?still=1&view=7&mode=ambient&$N"            screenshots/ambient.png
./screenshot.sh "$U/?still=1&view=7&kiosk=1&$N"                 screenshots/kiosk.png
./screenshot.sh "$U/?still=1&view=7&simulate=outage&$N"         screenshots/outage.png
./screenshot.sh "$U/?still=1&view=7&simulate=empty&$N"          screenshots/empty.png
./screenshot.sh "file://$PWD/dist/family-week-snapshot.html?still=1&view=7" screenshots/snapshot-offline.png
