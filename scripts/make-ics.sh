#!/bin/bash
# Regenerates the settled initial-condition snapshots shipped in config/ic.
set -e
cd "$(dirname "$0")/.."
node scripts/headless.js --ic 5 --speed 10 --seconds 2400 --every 600 --snap 5
node scripts/headless.js --ic 4 --speed 10 --seconds 2000 --every 600 --snap 4
node scripts/headless.js --ic 3 --speed 10 --seconds 600 --every 300 --snap 3
node scripts/headless.js --ic 2 --speed 10 --seconds 900 --every 300 --snap 2
echo ALL-ICS-DONE
