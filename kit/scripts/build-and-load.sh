#!/usr/bin/env bash
# Build the local-only Box Mount image and load it into the sbx runtime.
#
# The private box-mount binary is too big for kit files/ (4 MB injection limit),
# so it is baked into an image built FROM the stock shell template, then loaded
# into sbx's own image store with `sbx template load`. Nothing is pushed anywhere.
#
# IMPORTANT — architecture: a sandbox can only run a binary matching the sbx
# runtime's architecture. On Apple Silicon the sbx runtime is arm64 and does NOT
# emulate; an amd64 box-mount will fail to exec there. Use a binary whose arch
# matches your sbx runtime (check with: sbx run shell -- uname -m).
set -euo pipefail

IMAGE="${IMAGE:-sbx-box:local}"
BASE="${BASE:-docker/sandbox-templates:shell-docker}"
TAR="${TAR:-/tmp/${IMAGE//[:\/]/_}.tar}"

# Auto-select a binary whose arch matches the sbx runtime (= host arch) unless the
# caller pinned BIN. On Apple Silicon that's the v0.4.0 linux/arm64 box-mount; on
# amd64 it's the linux/amd64 box-mount. Override with BIN=<path> for other builds.
if [ -z "${BIN:-}" ]; then
  case "$(uname -m)" in
    arm64|aarch64) BIN="box-mount/linux-arm64/box-mount" ;;
    x86_64|amd64)  BIN="box-mount/linux/box-mount" ;;
    *)             BIN="box-mount/linux/box-mount" ;;
  esac
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

[ -f "$BIN" ] || { echo "ERROR: binary not found: $BIN" >&2; exit 1; }

# Determine the binary's target arch -> Docker platform.
case "$(file -b "$BIN")" in
  *x86-64*|*amd64*)  PLATFORM="linux/amd64" ;;
  *aarch64*|*ARM*)   PLATFORM="linux/arm64" ;;
  *) echo "ERROR: cannot determine arch of $BIN" >&2; exit 1 ;;
esac
echo ">> binary $BIN -> $PLATFORM"

# Warn if the binary arch won't match the sbx runtime (it must, to exec). The
# sbx runtime arch matches the local Docker Desktop VM, i.e. the host arch.
case "$(uname -m)" in
  x86_64|amd64)  rt_plat="linux/amd64" ;;
  arm64|aarch64) rt_plat="linux/arm64" ;;
  *)             rt_plat="" ;;
esac
if [ -n "$rt_plat" ] && [ "$rt_plat" != "$PLATFORM" ]; then
  echo "!! WARNING: sbx runtime is $rt_plat but the binary is $PLATFORM." >&2
  echo "!!          box-mount will NOT exec inside the sandbox (no emulation)." >&2
  echo "!!          Provide a $rt_plat box-mount build and re-run with BIN=<path>." >&2
fi

echo ">> building $IMAGE ($PLATFORM)"
docker build --platform "$PLATFORM" --build-arg BASE="$BASE" --build-arg BIN="$BIN" -t "$IMAGE" .

echo ">> saving + loading into the sbx runtime"
docker save "$IMAGE" -o "$TAR"
sbx template load "$TAR"
rm -f "$TAR"

echo ">> done. Loaded template:"
sbx template ls | grep -i "${IMAGE%%:*}" || true
cat <<EOF

Next:
  echo "<your-box-developer-or-oauth-token>" | sbx secret set box
  sbx run shell --template $IMAGE --kit ./ .
  # inside the sandbox (box-mount; agent-mount is an alias):
  #   box-mount --version
  #   box-mount mount "/home/agent/workspace/box" "<box-folder-id>"   # root = 0
  #   box-mount status
EOF
