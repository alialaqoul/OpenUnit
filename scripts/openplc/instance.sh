#!/bin/bash
# Start / stop / query one OpenPLC v3 instance created by setup-instance.sh.
#
#   instance.sh start <NAME>     start the runtime web server (it starts the PLC program itself)
#   instance.sh stop <NAME>
#   instance.sh status <NAME>
#   instance.sh stopall          stop the supervisor and every instance
set -u
CMD=$1 NAME=${2:-}
OPENPLC_HOME=${OPENPLC_HOME:-/opt/openplc/OpenPLC_v3}
INSTANCES=${OPENPLC_INSTANCES:-/opt/openplc/plc}
DIR="$INSTANCES/$NAME"
PIDF="$DIR/webserver.pid"

# The pid must still be this instance's web server: after WSL restarts, pids are reused.
running() {
  [ -f "$PIDF" ] || return 1
  local pid
  pid=$(cat "$PIDF")
  kill -0 "$pid" 2>/dev/null || return 1
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$(readlink -f "$DIR")" ] && grep -q webserver.py "/proc/$pid/cmdline" 2>/dev/null
}

case "$CMD" in
  start)
    if running; then echo "[$NAME] already running (pid $(cat "$PIDF"))"; exit 0; fi
    cd "$DIR" || exit 1
    # Own session (setsid): WSL ends the processes of a wsl.exe session when that client exits.
    setsid nohup "$OPENPLC_HOME/.venv/bin/python3" webserver.py > "$DIR/webserver.log" 2>&1 < /dev/null &
    echo $! > "$PIDF"
    sleep 1
    if running; then echo "[$NAME] started (pid $(cat "$PIDF"))"; else echo "[$NAME] FAILED to start - see $DIR/webserver.log"; exit 1; fi
    ;;
  stop)
    if running; then
      PID=$(cat "$PIDF")
      # The web server starts the compiled PLC as a child process: stop both.
      pkill -P "$PID" 2>/dev/null || true
      kill "$PID" 2>/dev/null || true
      sleep 1
      pkill -9 -P "$PID" 2>/dev/null || true
      kill -9 "$PID" 2>/dev/null || true
    fi
    pkill -f "$DIR/core/openplc" 2>/dev/null || true
    rm -f "$PIDF"
    echo "[$NAME] stopped"
    ;;
  stopall)
    # the supervisor of this instance set only (OPENPLC_INSTANCES), not that of a test set
    for pid in $(pgrep -f "openplc/supervise.sh"); do
      set_of=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^OPENPLC_INSTANCES=//p')
      [ "${set_of:-/opt/openplc/plc}" = "$INSTANCES" ] && kill -9 "$pid" 2>/dev/null
    done
    for d in "$INSTANCES"/*/; do
      [ -f "$d/simulator-instance.txt" ] && bash "$0" stop "$(basename "$d")"
    done
    ;;
  status)
    if running; then echo "[$NAME] running (pid $(cat "$PIDF"))"; else echo "[$NAME] stopped"; fi
    ;;
  *)
    echo "usage: instance.sh start|stop|status <NAME> | stopall" >&2
    exit 2
    ;;
esac
