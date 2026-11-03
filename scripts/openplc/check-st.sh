#!/bin/bash
# Syntax / type check of a generated OpenPLC project with the MatIEC compiler used by
# OpenPLC Runtime v3, without uploading it:
#
#   check-st.sh <project-dir> [cycle-ms]
#
# Concatenates functions, function blocks and programs into one ST file with a CONFIGURATION,
# like OpenPLC Editor does for a Runtime v3 target, and runs iec2c on it.
set -u
PROJ=$1 CYCLE=${2:-50}
OPENPLC_HOME=${OPENPLC_HOME:-/opt/openplc/OpenPLC_v3}
NAME=$(basename "$PROJ")
WORK=$(mktemp -d /tmp/plccheck.XXXXXX)
ST="$WORK/$NAME.st"
for d in functions function-blocks programs; do
  for f in "$PROJ"/pous/$d/*.st; do [ -f "$f" ] && { cat "$f"; echo; }; done
done > "$ST"
PROG=$(grep -m1 -oP '^\s*PROGRAM\s+\K\w+' "$PROJ"/pous/programs/*.st)
cat >> "$ST" <<EOF
CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK MainTask(INTERVAL := T#${CYCLE}ms, PRIORITY := 0);
    PROGRAM $NAME WITH MainTask : $PROG;
  END_RESOURCE
END_CONFIGURATION
EOF
cd "$WORK" && "$OPENPLC_HOME/webserver/iec2c" -f -l -p -r -R -a -I "$OPENPLC_HOME/webserver/lib" -T "$WORK" "$ST" > "$WORK/iec2c.log" 2>&1
RC=$?
if [ $RC -eq 0 ]; then
  echo "$NAME: OK ($(grep -c . "$WORK/VARIABLES.csv" 2>/dev/null || echo 0) debug variables)"
else
  echo "$NAME: FAILED"
  sed "s#$ST#$NAME.st#" "$WORK/iec2c.log" | head -40
fi
rm -rf "$WORK"
exit $RC
