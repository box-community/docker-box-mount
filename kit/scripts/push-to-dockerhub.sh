#!/usr/bin/env bash
# Build the Box Mount image and push it to Docker Hub.
#
# Unlike scripts/build-and-load.sh (which loads a single-arch image into the local
# sbx runtime and pushes nothing), this script publishes a MULTI-ARCH image to
# Docker Hub so users on either Apple Silicon (arm64) or Intel/amd64 pull the
# binary that matches their sbx runtime automatically.
#
# The private box-mount binaries live under box-mount/<arch>/ and are baked in
# per platform (arm64 -> box-mount/linux-arm64/box-mount, amd64 ->
# box-mount/linux/box-mount). Only the platforms whose binary is present get
# built; missing ones are skipped with a warning.
#
# Auth: pass Docker Hub creds via env for non-interactive login, e.g.
#   export DOCKERHUB_USERNAME=<your-hub-user>
#   export DOCKERHUB_TOKEN=<access-token>      # a Hub access token, NOT your password
# If those are unset the script assumes you are already logged in (docker login).
#
# The target namespace is NOT hard-coded: pass it as the first argument or via
# NAMESPACE=. Use whichever Docker Hub org you own (e.g. `box`).
#
# Usage:
#   ./scripts/push-to-dockerhub.sh box                    # push box/sbx-box :v0.4.0 + :latest
#   NAMESPACE=box ./scripts/push-to-dockerhub.sh          # same, via env
#   VERSION=v0.4.1 ./scripts/push-to-dockerhub.sh box     # override the version tag
#   PLATFORMS=linux/arm64 ./scripts/push-to-dockerhub.sh box   # single-arch push
set -euo pipefail

# Namespace comes from $1 or NAMESPACE= (no default — this script is not tied to
# any one Docker Hub account).
NAMESPACE="${1:-${NAMESPACE:-}}"
if [ -z "$NAMESPACE" ]; then
  echo "ERROR: no Docker Hub namespace given." >&2
  echo "       Usage: $0 <namespace>   (or NAMESPACE=<namespace> $0)" >&2
  echo "       e.g.:  $0 box" >&2
  exit 1
fi
IMAGE_NAME="${IMAGE_NAME:-sbx-box}"
REPO="${REPO:-${NAMESPACE}/${IMAGE_NAME}}"
VERSION="${VERSION:-v0.4.0}"
BASE="${BASE:-docker/sandbox-templates:shell-docker}"
# Space-separated list of platforms to publish. Only those with a matching binary
# on disk are actually built.
PLATFORMS="${PLATFORMS:-linux/arm64 linux/amd64}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Map a docker platform -> the private binary that must be baked in for it.
bin_for_platform() {
  case "$1" in
    linux/arm64) echo "box-mount/linux-arm64/box-mount" ;;
    linux/amd64) echo "box-mount/linux/box-mount" ;;
    *) echo "" ;;
  esac
}

command -v docker >/dev/null || { echo "ERROR: docker not found on PATH" >&2; exit 1; }
docker buildx version >/dev/null 2>&1 || {
  echo "ERROR: 'docker buildx' is required for the multi-arch push." >&2
  echo "       Install/enable buildx, then re-run." >&2
  exit 1
}

# Non-interactive login if creds were provided; otherwise trust an existing session.
if [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo ">> logging in to Docker Hub as ${DOCKERHUB_USERNAME:-$NAMESPACE}"
  echo "$DOCKERHUB_TOKEN" | docker login -u "${DOCKERHUB_USERNAME:-$NAMESPACE}" --password-stdin
else
  echo ">> DOCKERHUB_TOKEN not set; assuming an existing 'docker login' session"
fi

# Ensure a buildx builder that can drive multi-platform builds exists.
if ! docker buildx inspect sbx-box-builder >/dev/null 2>&1; then
  echo ">> creating buildx builder 'sbx-box-builder'"
  docker buildx create --name sbx-box-builder --driver docker-container >/dev/null
fi
docker buildx use sbx-box-builder

# Build + push each available platform to an arch-suffixed tag, collecting the
# per-arch refs so we can stitch them into one multi-arch manifest at the end.
arch_tags=()
for plat in $PLATFORMS; do
  bin="$(bin_for_platform "$plat")"
  if [ -z "$bin" ]; then
    echo "!! WARNING: no binary mapping for platform '$plat'; skipping" >&2
    continue
  fi
  if [ ! -f "$bin" ]; then
    echo "!! WARNING: binary for $plat not found ($bin); skipping this platform" >&2
    continue
  fi
  arch="${plat#linux/}"
  tag="${REPO}:${VERSION}-${arch}"
  echo ">> building + pushing $tag  (binary: $bin)"
  docker buildx build \
    --platform "$plat" \
    --build-arg BASE="$BASE" \
    --build-arg BIN="$bin" \
    -t "$tag" \
    --push .
  arch_tags+=("$tag")
done

[ "${#arch_tags[@]}" -gt 0 ] || { echo "ERROR: no platforms built; nothing pushed." >&2; exit 1; }

# Combine the per-arch images into version + latest manifest lists.
echo ">> creating multi-arch manifest ${REPO}:${VERSION} (+ :latest)"
docker buildx imagetools create -t "${REPO}:${VERSION}" -t "${REPO}:latest" "${arch_tags[@]}"

echo ">> done. Published:"
echo "     ${REPO}:${VERSION}"
echo "     ${REPO}:latest"
for t in "${arch_tags[@]}"; do echo "     $t"; done
cat <<EOF

Pull + run from Docker Hub:
  docker pull ${REPO}:${VERSION}
  docker save ${REPO}:${VERSION} -o /tmp/sbx-box.tar && sbx template load /tmp/sbx-box.tar
  sbx run shell --template ${REPO}:${VERSION} --kit ./ .
EOF
