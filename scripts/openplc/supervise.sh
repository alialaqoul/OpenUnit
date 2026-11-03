#!/bin/bash
# Runs the OpenPLC instances of the given controllers and keeps them running:
#
#   supervise.sh <NAME> [NAME ...]
#
# WSL stops a distribution shortly after its last wsl.exe client exits, which would take the
# runtimes with it, so the simulator keeps this script attached for as long as it runs. Crashed
# runtimes are restarted. The supervisor ending does NOT stop the PLCs (like a PLC staying in RUN
# when its engineering station disconnects): the simulator stops them with `instance.sh stopall`,
# and a restarted simulator attaches to them again without disturbing the plant.
set -u
HERE=$(dirname "$(readlink -f "$0")")
NAMES=("$@")
INSTANCES=${OPENPLC_INSTANCES:-/opt/openplc/plc}
trap 'exit 0' TERM INT HUP
# Replace a supervisor left behind by a previous simulator process without stopping the PLCs -
# only the one of this instance set (OPENPLC_INSTANCES), a test set runs beside it.
for pid in $(pgrep -f "openplc/supervise.sh"); do
  [ "$pid" = "$$" ] && continue
  set_of=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^OPENPLC_INSTANCES=//p')
  [ "${set_of:-/opt/openplc/plc}" = "$INSTANCES" ] && kill -9 "$pid" 2>/dev/null
done
for n in "${NAMES[@]}"; do bash "$HERE/instance.sh" start "$n"; done
echo "SUPERVISOR READY"
while true; do
  sleep 5 &
  wait $!
  for n in "${NAMES[@]}"; do
    if ! bash "$HERE/instance.sh" status "$n" | grep -q running; then
      echo "[$n] runtime not running - restarting"
      bash "$HERE/instance.sh" start "$n"
    fi
  done
done
