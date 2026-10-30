#!/usr/bin/env bash
# Family Week: ./run.sh [start|restart|stop|status]
cd "$(dirname "$0")"
PIDF=data/server.pid
stop() { [ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null; rm -f $PIDF; }
start() {
  nohup python3 server.py >> data/server.log 2>&1 &
  echo $! > $PIDF; sleep 1
  curl -fs http://127.0.0.1:4847/api/health && echo && echo "Family Week running: http://127.0.0.1:4847 (pid $(cat $PIDF))"
}
case "${1:-start}" in
  start) if [ -f $PIDF ] && kill -0 "$(cat $PIDF)" 2>/dev/null; then echo "already running (pid $(cat $PIDF))"; else start; fi ;;
  restart) stop; sleep 0.5; start ;;
  stop) stop; echo stopped ;;
  status) curl -fs http://127.0.0.1:4847/api/health || echo down ;;
esac
