#!/usr/bin/env bash
# Runs unit tests + the CDP smoke test against the live server on :4847.
cd "$(dirname "$0")/.." || exit 1
python3 -m unittest discover -s tests -v 2>&1 | tail -4 || exit 1
node --experimental-websocket tests/smoke.mjs 4847
