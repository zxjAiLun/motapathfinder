#!/bin/sh
# User-scoped ARM64 Node LTS; no apt, sudo, firewall or existing service changes.
set -eu
[ "$(uname -m)" = "aarch64" ] || { echo 'Expected ARM64'; exit 1; }
python3 - <<'PY'
import hashlib, os, pathlib, tarfile, urllib.request
root = pathlib.Path.home() / '.local' / 'share' / 'motapath-solver'
root.mkdir(parents=True, exist_ok=True)
base = 'https://nodejs.org/dist/latest-v22.x/'
checksums = urllib.request.urlopen(base+'SHASUMS256.txt', timeout=30).read().decode()
entries = [line.split() for line in checksums.splitlines() if line.endswith('-linux-arm64.tar.xz')]
if len(entries) != 1: raise RuntimeError('Ambiguous Node release')
expected, name = entries[0]
archive = root / name
with urllib.request.urlopen(base+name, timeout=60) as response, archive.open('wb') as out:
    while True:
        data = response.read(1024*1024)
        if not data: break
        out.write(data)
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if actual != expected: raise RuntimeError('Node checksum mismatch')
folder = root / name.removesuffix('.tar.xz')
if not folder.exists():
    with tarfile.open(archive) as tar: tar.extractall(root, filter='data')
link = root / 'node'
if link.exists() and not link.is_symlink(): raise RuntimeError('Refusing to replace non-symlink node path')
new_link = root / 'node.new'
if new_link.is_symlink(): new_link.unlink()
new_link.symlink_to(folder)
os.replace(new_link, link)
print('Runtime:', folder)
print('SHA256:', actual)
archive.unlink()
PY
"$HOME/.local/share/motapath-solver/node/bin/node" --version
printf '\nUser services: '
systemctl --user is-system-running || true
loginctl show-user "$(id -un)" -p Linger
printf '\nCgroup memory: '
if [ -f /sys/fs/cgroup/memory.max ]; then head -c 80 /sys/fs/cgroup/memory.max; fi
