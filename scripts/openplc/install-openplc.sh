#!/bin/bash
# Installs OpenPLC Runtime v3 (github.com/thiagoralves/OpenPLC_v3) inside the WSL distribution, as root.
# Idempotent: does nothing when the runtime is already built.
#
# Deviations from the stock "./install.sh linux":
#   - apt runs non-interactively (no debconf / service-restart prompts);
#   - OpenDNP3 is not built (it fails with CMake 4 and the simulator does not use DNP3), and the
#     DNP3 libraries are not linked - the runtime's dnp3_dummy.cpp provides the stubs;
#   - no systemd service: the simulator starts one runtime instance per controller itself.
set -u
OPENPLC_HOME=${OPENPLC_HOME:-/opt/openplc/OpenPLC_v3}
PY="$OPENPLC_HOME/.venv/bin/python3"
# Python packages of the OpenPLC web server / REST API (same set as its installer)
PIP_PKGS="flask==2.3.3 werkzeug==2.3.7 flask-login==0.6.2 pyserial pymodbus==2.5.3 flask_jwt_extended flask_sqlalchemy python-dotenv"
py_ok() { [ -x "$PY" ] && "$PY" -c "import flask, flask_login, serial, pymodbus, flask_jwt_extended, flask_sqlalchemy, dotenv" 2>/dev/null; }
# A failed download in the stock installer leaves the runtime without its web server packages: retry.
ensure_py() {
  py_ok && return 0
  [ -x "$PY" ] || python3 -m venv "$OPENPLC_HOME/.venv" || return 1
  for i in 1 2 3; do
    "$PY" -m pip install -q $PIP_PKGS && py_ok && return 0
    echo "pip install failed (attempt $i), retrying ..."
    sleep 5
  done
  return 1
}
if [ -x "$OPENPLC_HOME/webserver/core/openplc" ] && [ -x "$OPENPLC_HOME/webserver/iec2c" ]; then
  ensure_py || { echo "OpenPLC v3 web server packages could not be installed"; exit 1; }
  echo "OpenPLC v3 already installed in $OPENPLC_HOME"
  exit 0
fi
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
mkdir -p "$(dirname "$OPENPLC_HOME")"
if [ ! -d "$OPENPLC_HOME" ]; then
  command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
  git clone --depth 1 https://github.com/thiagoralves/OpenPLC_v3.git "$OPENPLC_HOME" || exit 1
fi
cd "$OPENPLC_HOME" || exit 1
sed -i 's/^    install_opendnp3 "\$1"/    disable_opendnp3 "$1"/' background_installer.sh
sed -i 's/^    install_systemd_service sudo/    : # no systemd service (the simulator starts the runtimes)/' background_installer.sh
sed -i 's/ -lasiodnp3 -lasiopal -lopendnp3 -lopenpal//g' webserver/scripts/compile_program.sh
# sudo inside the installer drops DEBIAN_FRONTEND: switch debconf to non-interactive meanwhile.
PREV=$(debconf-show debconf 2>/dev/null | sed -n 's/^\* debconf\/frontend: //p')
echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections
echo 'libc6 libraries/restart-without-asking boolean true' | debconf-set-selections
LOG=/opt/openplc/install.log
echo "Building OpenPLC v3 (several minutes, log: $LOG) ..."
./install.sh linux > "$LOG" 2>&1
echo "debconf debconf/frontend select ${PREV:-Dialog}" | debconf-set-selections
if [ -x "$OPENPLC_HOME/webserver/core/openplc" ] && ensure_py; then
  echo "OpenPLC v3 installed in $OPENPLC_HOME"
else
  echo "OpenPLC v3 installation FAILED - see $LOG"
  tail -20 "$LOG"
  exit 1
fi
