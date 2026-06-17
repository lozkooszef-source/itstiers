#!/usr/bin/env bash
set -euo pipefail

cd /home/container

if [[ ! -d .git || ! -d src ]]; then
  rm -rf /tmp/itstiers
  git clone --depth 1 --branch main https://github.com/lozkooszef-source/itstiers.git /tmp/itstiers

  find /home/container -mindepth 1 -maxdepth 1 \
    ! -name '.env' \
    ! -name 'start.sh' \
    -exec rm -rf {} +

  cp -a /tmp/itstiers/. /home/container/
  rm -rf /tmp/itstiers
else
  git pull origin main
fi

/usr/local/bin/npm install
/usr/local/bin/node /home/container/src/index.js
