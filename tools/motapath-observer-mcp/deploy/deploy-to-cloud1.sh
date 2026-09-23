#!/bin/sh
set -eu

# Target host
HOST=${1:-cloud1}
REMOTE_DIR="/home/ubuntu/motapath-solver/observer-mcp"
SYSTEMD_USER_DIR="/home/ubuntu/.config/systemd/user"

echo "=== Deploying motapath-observer-mcp to ${HOST} ==="

# 1. Ensure remote directory exists
ssh "$HOST" "mkdir -p '${REMOTE_DIR}/lib' '${REMOTE_DIR}/deploy' '${SYSTEMD_USER_DIR}'"

# 2. Rsync / SCP local files to remote
echo "Uploading files..."
scp tools/motapath-observer-mcp/server.js "${HOST}:${REMOTE_DIR}/server.js"
scp tools/motapath-observer-mcp/package.json "${HOST}:${REMOTE_DIR}/package.json"
scp tools/motapath-observer-mcp/test-observer-mcp.js "${HOST}:${REMOTE_DIR}/test-observer-mcp.js"
scp tools/motapath-observer-mcp/lib/*.js "${HOST}:${REMOTE_DIR}/lib/"
scp tools/motapath-observer-mcp/deploy/motapath-observer.service "${HOST}:${SYSTEMD_USER_DIR}/motapath-observer.service"

# 3. Run self-test on remote using remote Node runtime
echo "Running self-test on ${HOST}..."
ssh "$HOST" "/home/ubuntu/.local/share/motapath-solver/node/bin/node ${REMOTE_DIR}/test-observer-mcp.js"

# 4. Reload systemd and enable/restart service
echo "Enabling and starting motapath-observer.service..."
ssh "$HOST" "systemctl --user daemon-reload && systemctl --user enable --now motapath-observer.service && systemctl --user status motapath-observer.service --no-pager"

# 5. Verify HTTP health check and JSON-RPC tools/list
echo "Testing loopback endpoints on ${HOST}..."
ssh "$HOST" "curl -s http://127.0.0.1:8788/health && echo ''"
ssh "$HOST" "curl -s -X POST http://127.0.0.1:8788/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | head -c 200 && echo '...'"

echo "=== Deployment to ${HOST} COMPLETED SUCCESSFULLY ==="
