#!/usr/bin/env bash
set -euo pipefail

fail=0
echo "Docker Sandbox Ubuntu preflight"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "OS: ${PRETTY_NAME:-unknown}"
  if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-0}" < "24.04" ]; then
    echo "ERROR: Docker Sandboxes requires Ubuntu 24.04 or newer." >&2
    fail=1
  fi
else
  echo "ERROR: cannot identify the operating system." >&2
  fail=1
fi

arch="$(uname -m)"
echo "Architecture: $arch"
if [ "$arch" != "x86_64" ] && [ "$arch" != "aarch64" ]; then
  echo "ERROR: Docker Sandboxes requires x86_64 or aarch64." >&2
  fail=1
fi

if [ -e /dev/kvm ]; then
  echo "KVM device: /dev/kvm"
else
  echo "ERROR: /dev/kvm is missing. Enable nested virtualization or use a droplet that exposes KVM." >&2
  fail=1
fi

if id -nG "$USER" 2>/dev/null | tr ' ' '\n' | grep -qx kvm; then
  echo "KVM group: $USER is a member"
else
  echo "ERROR: $USER is not in the kvm group. Run: sudo usermod -aG kvm $USER, then reconnect." >&2
  fail=1
fi

command -v sbx >/dev/null && echo "sbx: $(sbx version 2>/dev/null || true)" || { echo "ERROR: sbx is not installed." >&2; fail=1; }
command -v docker >/dev/null && echo "docker: $(docker --version)" || { echo "ERROR: Docker CLI is not installed." >&2; fail=1; }
command -v node >/dev/null && echo "node: $(node --version)" || { echo "ERROR: Node.js is not installed." >&2; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "\nPreflight failed. Fix the errors above before continuing." >&2
  exit 1
fi
echo "Preflight passed."
