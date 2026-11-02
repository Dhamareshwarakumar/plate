#!/bin/sh
# Starts as root only long enough to make the data directory writable by the app user, then drops
# privileges. Docker creates a missing bind-mount directory as root, which would otherwise leave
# SQLite unable to create its database on first start.
set -eu

DATA_DIR="$(dirname "${DATABASE_PATH:-/data/plate.db}")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || echo "warning: could not change ownership of $DATA_DIR" >&2
  exec su-exec node "$@"
fi

exec "$@"
