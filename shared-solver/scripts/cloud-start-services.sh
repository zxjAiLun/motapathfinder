#!/bin/sh
# Usage: sh cloud-start-services.sh /absolute/release/path
# Installs only this application's user services; refuses existing unit files.
set -eu
RELEASE=${1:?absolute release directory required}
NODE="$HOME/.local/share/motapath-solver/node/bin/node"
RUN="$HOME/motapath-solver/runs/neko-zero-key"
UNITS="$HOME/.config/systemd/user"
[ -x "$NODE" ]
[ -f "$RELEASE/shared-solver/profiles/neko-zero-key.json" ]
mkdir -p "$RUN" "$UNITS"
for unit in motapath-search-neko.service motapath-progress.service; do
  [ ! -e "$UNITS/$unit" ] || { echo "Refusing to overwrite $unit"; exit 1; }
done
cat > "$UNITS/motapath-search-neko.service" <<EOF
[Unit]
Description=Motapath bounded canonical DP - neko zero keys
After=network.target
[Service]
Type=simple
WorkingDirectory=$RELEASE
ExecStart=$NODE --max-old-space-size=1024 $RELEASE/shared-solver/run-durable-search.js --config=$RELEASE/shared-solver/profiles/neko-zero-key.json --tower-root=$RELEASE/tower --run-dir=$RUN
Restart=no
Nice=10
CPUQuota=150%
MemoryMax=9G
MemorySwapMax=0
KillMode=mixed
TimeoutStopSec=150
NoNewPrivileges=true
UMask=0077
[Install]
WantedBy=default.target
EOF
cat > "$UNITS/motapath-progress.service" <<EOF
[Unit]
Description=Motapath read-only loopback progress UI
[Service]
Type=simple
WorkingDirectory=$RELEASE
ExecStart=$NODE --max-old-space-size=128 $RELEASE/shared-solver/search-progress-server.js --run-dir=$RUN --port=8787
Restart=on-failure
RestartSec=5
MemoryMax=256M
NoNewPrivileges=true
UMask=0077
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now motapath-progress.service motapath-search-neko.service
systemctl --user show motapath-progress.service motapath-search-neko.service -p Id -p ActiveState -p SubState -p MemoryMax -p MainPID
