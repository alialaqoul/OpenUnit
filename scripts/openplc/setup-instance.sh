#!/bin/bash
# Creates (or refreshes) one OpenPLC Runtime v3 instance for a simulator controller.
#
#   setup-instance.sh <NAME> <modbus-port> <web-port> <api-port> <control-port>
#
# An instance is a copy of the OpenPLC v3 "webserver" directory with its own ports, settings
# database, compiled program and certificates, so several soft-PLCs can run side by side.
# Runs as root inside WSL. The base install lives in $OPENPLC_HOME (default /opt/openplc/OpenPLC_v3).
set -euo pipefail

NAME=$1 MB=$2 WEB=$3 API=$4 CTL=$5
# Listen address of the web UI, REST API and Modbus server: 127.0.0.1 on Windows (nothing exposed,
# no firewall prompt), 0.0.0.0 in WSL (needed for the localhost forwarding to Windows).
BIND=${OPENPLC_BIND:-0.0.0.0}
OPENPLC_HOME=${OPENPLC_HOME:-/opt/openplc/OpenPLC_v3}
INSTANCES=${OPENPLC_INSTANCES:-/opt/openplc/plc}
DIR="$INSTANCES/$NAME"

if [ ! -x "$OPENPLC_HOME/webserver/core/openplc" ]; then
  echo "OpenPLC v3 is not installed in $OPENPLC_HOME (run install-openplc.sh first)" >&2
  exit 1
fi

mkdir -p "$DIR"
if [ ! -f "$DIR/webserver.py" ]; then
  echo "[$NAME] creating instance in $DIR"
  cp -a "$OPENPLC_HOME/webserver/." "$DIR/"
  rm -f "$DIR"/*.pem "$DIR"/restapi*.db "$DIR/instance"/*.db 2>/dev/null || true
fi

# Ports: web UI, REST API (used by OpenPLC Editor), interactive control socket
sed -i -E "s/port=[0-9]+\)/port=$WEB)/; s/port=[0-9]+, ssl_context/port=$API, ssl_context/; s/host='[0-9.]+'/host='$BIND'/g" "$DIR/webserver.py"
sed -i -E "s/\('localhost', [0-9]+\)/('localhost', $CTL)/" "$DIR/openplc.py"
sed -i -E "s/startInteractiveServer\([0-9]+\)/startInteractiveServer($CTL)/" "$DIR/core/utils.cpp"
# The web server talks to the PLC core 1 s after launching it, once. A core that starts slower (Windows
# scans a freshly built executable) then never gets its Modbus server enabled: retry for up to 20 s.
if ! grep -q 'simulator: wait for the PLC core' "$DIR/openplc.py"; then
  sed -i -E "s|^( +)s\.connect\(\('localhost', ([0-9]+)\)\)$|\1for _try in range(200):  # simulator: wait for the PLC core\n\1    try:\n\1        s.connect(('localhost', \2))\n\1        break\n\1    except socket.error:\n\1        s.close()\n\1        if _try == 199:\n\1            raise\n\1        time.sleep(0.1)\n\1        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)|" "$DIR/openplc.py"
fi
# the retry loop keeps the configured control port in sync
sed -i -E "s/s\.connect\(\('localhost', [0-9]+\)\)/s.connect(('localhost', $CTL))/" "$DIR/openplc.py"

# Fix a race in the v3 Modbus server: the accept loop handed each connection thread a pointer to
# an argument array on its own stack, so two clients connecting at once could leave one socket
# without a handler (its requests are never answered). Give every thread its own copy.
SRV="$DIR/core/server.cpp"
MBCPP="$DIR/core/modbus.cpp"
# Always patch fresh copies from the base install, so re-running this script is safe.
cp -f "$OPENPLC_HOME/webserver/core/server.cpp" "$SRV"
cp -f "$OPENPLC_HOME/webserver/core/modbus.cpp" "$MBCPP"
sed -i -E 's|^(\s*)int arguments\[2\];|\1int *arguments = (int *)malloc(2 * sizeof(int)); // simulator: per-connection arguments|' "$SRV"
sed -i -E 's|^(\s*)int protocol_type = args\[1\];|\1int protocol_type = args[1];\n\1free(args);|' "$SRV"
grep -q '#include <stdlib.h>' "$SRV" || sed -i '1i #include <stdlib.h>' "$SRV"
if [ "$BIND" != "0.0.0.0" ]; then
  sed -i -E "s|server_addr.sin_addr.s_addr = INADDR_ANY;|server_addr.sin_addr.s_addr = inet_addr(\"$BIND\"); // simulator: listen address|" "$SRV"
  grep -q '#include <arpa/inet.h>' "$SRV" || sed -i '1i #include <arpa/inet.h>' "$SRV"
fi

# Fix FC15 (write multiple coils) in the v3 Modbus server: it wrote whole bytes, so the padding
# bits of the last byte overwrote up to 7 coils after the requested range.
sed -i -E '/^void WriteMultipleCoils/,/^}/ s|^(\s*)int position = Start \+ i \* 8 \+ j;|\1if (i * 8 + j >= CoilDataLength) break; // simulator: stop at the requested coil count\n\1int position = Start + i * 8 + j;|' "$MBCPP"
if [ "$(grep -c 'simulator: per-connection arguments' "$SRV")" != 1 ] || [ "$(grep -c 'free(args);' "$SRV")" != 1 ] \
   || [ "$(grep -c 'simulator: stop at the requested coil count' "$MBCPP")" != 1 ]; then
  echo "[$NAME] failed to patch the OpenPLC Modbus server sources" >&2
  exit 1
fi

# Runtime settings: Modbus server on its own port, other protocols off, start in RUN after boot
sqlite3 "$DIR/openplc.db" <<SQL
UPDATE Settings SET Value='$MB' WHERE Key='Modbus_port';
UPDATE Settings SET Value='disabled' WHERE Key='Dnp3_port';
UPDATE Settings SET Value='disabled' WHERE Key='Enip_port';
UPDATE Settings SET Value='disabled' WHERE Key='Pstorage_polling';
UPDATE Settings SET Value='false' WHERE Key='snap7';
UPDATE Settings SET Value='true' WHERE Key='Start_run_mode';
SQL

echo "$NAME modbus=$MB web=$WEB api=$API ctl=$CTL" > "$DIR/simulator-instance.txt"
echo "[$NAME] ready: Modbus TCP $MB, web $WEB, REST $API, control $CTL"
