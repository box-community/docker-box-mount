# Local-only image carrying the private Box Mount client.
#
# The box-mount binary (~34 MB) can't ship in the kit's files/ (4 MB injection
# limit), so it is baked into an image built FROM the stock shell sandbox
# template. The binary's architecture MUST match the sbx runtime (arm64 on Apple
# Silicon); a mismatched binary will not exec inside the sandbox.
#
# Build + load via: ./scripts/build-and-load.sh
# Or manually:
#   docker build --platform linux/amd64 -t sbx-box:local .
#   docker save sbx-box:local -o /tmp/img.tar && sbx template load /tmp/img.tar
#
# Then run the sandbox with this image + the mixin kit:
#   sbx run shell --template sbx-box:local --kit ./ .

ARG BASE=docker/sandbox-templates:shell-docker
FROM ${BASE}

# The private Box client. Build context is the repo root. The template runs as a
# non-root user, so set ownership/mode at copy time rather than with RUN chmod.
#
# v0.4.0 note: the `mount` command self-invokes a helper executable named
# `box-mount` on PATH (the sync engine), so the binary MUST be installed under
# that name or `mount` fails with FileNotFoundError: 'box-mount'. We also install
# an `agent-mount` alias so the documented CLI surface keeps working. Two COPYs
# (rather than a RUN symlink) because the template's non-root user can't write
# /usr/local/bin at RUN time.
ARG BIN=box-mount/linux/box-mount
COPY --chown=root:root --chmod=0755 ${BIN} /usr/local/bin/box-mount
COPY --chown=root:root --chmod=0755 ${BIN} /usr/local/bin/agent-mount
