# sbx-kits-box - Box Mount kit (private / local-only)

An [sbx](https://docs.docker.com/ai/sandboxes/) kit that brings Box's **Box Mount**
client into a sandbox: mount a Box folder into the sandbox and keep it in two-way
sync, with the Box access token injected by the sbx proxy (the real token never
enters the container).


## What's in here

```
sbx-kits-box/
├── spec.yaml                       # the kit (v2 mixin): Box network policy + token injection + agent instructions
├── Dockerfile                      # bakes the box-mount binary into a local image (binary is too big for files/)
├── scripts/build-and-load.sh       # build that image + load it into the sbx runtime (auto-selects the arch binary)
├── scripts/push-to-dockerhub.sh    # build + push a multi-arch image to a Docker Hub namespace you pass in (e.g. box)
├── box-mount/                     # (contents below are PRIVATE - git-ignored, obtain from Box)
│   ├── README.md                   # upstream Box Mount CLI docs (Box Confidential)
│   ├── linux/box-mount           # linux/amd64 binary (v0.x)   -> amd64 sandbox
│   ├── linux-arm64/box-mount       # linux/arm64 binary (v0.4.0) -> Apple Silicon sandbox
│   └── mac/box-mount             # darwin/arm64 binary         -> HOST use only (not the sandbox)
└── README.md
```

> **The `box-mount/` binaries and docs are NOT in this repo.** They are Box
> private-preview artifacts and are **git-ignored**. Obtain them from Box and drop
> them into `box-mount/<arch>/` locally before building. This public repo ships
> only the kit scaffolding (spec, Dockerfile, scripts, docs).

The kit (`spec.yaml`) supplies only the **Box network allowlist**, **credential
injection**, the **`BOX_ACCESS_TOKEN` sentinel**, and the **agent instructions**. The
binary itself is delivered via a locally-built image (see below), because kit
`files/` are capped at a 4 MB injection message and the binary is ~34 MB.

> **v0.4.0 naming.** The current build ships as **`box-mount`**, and its `mount`
> command self-invokes a helper executable named `box-mount` on `PATH` (the sync
> engine). The Dockerfile installs the binary as **both** `box-mount` (required) and
> `agent-mount` (back-compat alias), so either command works inside the sandbox.

> **Private preview.** The `linux-arm64/box-mount` binary is a Box private-preview
> artifact and is **git-ignored** - it is not committed here. Obtain it from Box and
> drop it at `box-mount/linux-arm64/box-mount` before building on Apple Silicon.

---

## ⚠️ Architecture requirement (read first)

A sandbox can only run a binary that **matches the sbx runtime's architecture**,
and the sbx runtime does **not** emulate other architectures.

| Your host / sbx runtime  | Binary you need                        | Status |
|--------------------------|----------------------------------------|--------|
| `x86_64` (amd64)         | `box-mount/linux/box-mount`         | works  |
| `aarch64` (Apple Silicon)| `box-mount/linux-arm64/box-mount` (v0.4.0) | ✅ works - verified end-to-end |

Check your runtime arch:

```console
sbx exec <any-sandbox> -- uname -m        # x86_64  or  aarch64
```

`build-and-load.sh` auto-selects the binary matching your host arch (arm64 → the
v0.4.0 `linux-arm64/box-mount`, amd64 → `linux/box-mount`). Override with `BIN=…`
if you have a different build.

---

## Quick start (local-only)

### 1. Obtain the Box binary and recreate the `box-mount/` structure

This public repo ships **scaffolding only** - the Box binaries are private-preview
artifacts and are **not** committed (they are git-ignored). A fresh clone therefore
has no `box-mount/` directory, and `build-and-load.sh` will fail with
`ERROR: binary not found: box-mount/linux-arm64/box-mount` until you drop the
binary in.

Get the build from Box (e.g. the `box-mount-0.4.0-linux-<arch>.tar.gz` archives),
then recreate the layout the build expects **from the repo root**:

```console
# Apple Silicon (aarch64 sbx runtime) - REQUIRED to build here
mkdir -p box-mount/linux-arm64
tar xzf /path/to/box-mount-0.4.0-linux-aarch64.tar.gz -C box-mount/linux-arm64
chmod +x box-mount/linux-arm64/box-mount
file box-mount/linux-arm64/box-mount     # sanity: should say  ELF ... ARM aarch64

# amd64 runtime (Windows / Intel) - only if building for x86_64
mkdir -p box-mount/linux
tar xzf /path/to/box-mount-0.4.0-linux-x86_64.tar.gz -C /tmp
mv /tmp/box-mount box-mount/linux/box-mount
```

Target layout (all paths are git-ignored, so nothing here gets committed):

```
box-mount/
├── linux-arm64/box-mount    # arm64 sbx runtime (Apple Silicon)
├── linux/box-mount        # amd64 sbx runtime (Windows / Intel)
└── mac/box-mount          # host-side use only (not the sandbox)
```

`build-and-load.sh` auto-selects the binary matching your host arch, so on Apple
Silicon only `box-mount/linux-arm64/box-mount` is required.

### 2. Build the image and load it into the sbx runtime

```console
./scripts/build-and-load.sh
```

This builds `sbx-box:local` (FROM the stock shell template, with the
`box-mount` binary baked in under both `box-mount` and `agent-mount`) and loads it
into sbx's image store via `sbx template load`. Nothing is pushed. The script warns
if the binary arch won't match your runtime.

> **Docker must be running** before this step. If the daemon is down the build
> fails silently, the image is never loaded, and `sbx run --template …` later fails
> with a **500 pull failed** (sbx falls back to pulling a local-only image). Confirm
> with `docker version` (Server section present) and `sbx template ls`.

#### (Optional) Publish the image to Docker Hub

To share the image instead of loading it only into your local sbx runtime, push a
**multi-arch** image to Docker Hub. Pass the namespace you own as the first
argument (e.g. `box`) — the script has no hard-coded default. It publishes to
`<namespace>/sbx-box`. Because both Linux binaries live under
`box-mount/`, the script bakes the right one per platform (arm64 →
`linux-arm64/box-mount`, amd64 → `linux/box-mount`) and stitches them into a
single `:v0.4.0` + `:latest` manifest, so consumers pull the binary matching their
runtime automatically.

```console
export DOCKERHUB_USERNAME=<your-hub-user>
export DOCKERHUB_TOKEN=<your-docker-hub-access-token>   # a Hub access token, NOT your password
./scripts/push-to-dockerhub.sh box                     # -> box/sbx-box
```

Overrides: `NAMESPACE=box …` instead of the positional arg, `VERSION=v0.4.1 …` to
change the tag, `PLATFORMS=linux/arm64 …` for a single-arch push. If
`DOCKERHUB_TOKEN` is unset the script assumes an existing `docker login` session.
Requires `docker buildx` (it creates a `sbx-box-builder` builder if needed).

> ⚠️ **The `box-mount/` binaries are Box-confidential.** Only push to a Docker Hub
> repo you intend to be **private** (or one you are cleared to publish). A public
> image would expose the private binary.

### 3. Store your Box token (kept out of the container)

Developer-token / static-access-token mode (the documented "developer token via
environment variable, no config file" path). The token is stored as an sbx secret
and injected by the proxy as `Authorization: Bearer …` on Box API calls. Note this
mode does **not** auto-refresh - only true OAuth (which also needs `client_id` +
`client_secret` + `refresh_token`) does, and this kit injects only the access token:

```console
echo "<your-box-developer-or-oauth-access-token>" | sbx secret set box
sbx secret ls            # confirm a 'box' service secret exists
```

> A Box **developer token** (Developer Console → Configuration → *Generate
> Developer Token*) is the quickest way to test; it lasts ~60 min. When it
> expires, re-run the `sbx secret set box` line with a fresh token and **recreate
> the sandbox** (the proxy binds the secret at creation).

### 4. Run the sandbox with the template + this kit

```console
sbx run shell --template sbx-box:local --kit ./ .
```

### 5. Use Box Mount inside the sandbox

```console
box-mount --version
box-mount mount "/home/agent/workspace/box" "<box-folder-id>"   # folder id = number at the end of the box.com folder URL (root = 0)
box-mount status
box-mount unmount "/home/agent/workspace/box"
```

(`agent-mount` works too - it's an alias for the same binary.)

---

## Verify

```console
# binary present and runs (matches runtime arch)
sbx run shell --template sbx-box:local --kit ./ -- box-mount --version

# the env var holds the sentinel, NOT the real token (proxy swaps it on outbound)
sbx run shell --template sbx-box:local --kit ./ -- printenv BOX_ACCESS_TOKEN
# -> proxy-managed

# credential injection works: a Box API call from inside the sandbox returns 200
sbx run shell --template sbx-box:local --kit ./ -- \
  curl -s -o /dev/null -w '%{http_code}\n' https://api.box.com/2.0/users/me
# -> 200
```

Two-way sync smoke test, once mounted:

```console
# down-sync: the mount lists the Box folder's files
box-mount mount "/home/agent/workspace/box" "0" && ls /home/agent/workspace/box

# up-sync: a file created in the mount appears in Box within a few seconds
echo hi > /home/agent/workspace/box/e2e.txt        # then check box.com / the Box API
```

---

## Evaluating on Windows (amd64)

The `linux/box-mount` binary is **linux/amd64**. On an amd64 sbx runtime
(a Windows machine - Docker Desktop's VM is `x86_64` on amd64 hardware, WSL 2 **or**
Hyper-V backend) it execs fine. You don't need bash/WSL - the underlying steps are
three `docker`/`sbx` commands that run in native **PowerShell**:

```console
# from the repo root (PowerShell) - replaces build-and-load.sh, no bash needed
docker version                  # FIRST: confirm the Docker daemon is running (Server section present)
docker build --platform linux/amd64 --build-arg BIN=box-mount/linux/box-mount -t sbx-box:local .
docker save sbx-box:local -o sbx-box.tar
sbx template load sbx-box.tar

sbx template ls                 # confirm sbx-box:local is now in sbx's store
# (if it's not listed, --template will try to PULL it and fail with a 500 - see Troubleshooting)

# Box token - interactive paste (avoids PowerShell pipe encoding mangling the token)
sbx secret set box
```

> Shortcut: you can also build the tar **on an Apple Silicon Mac**
> (`docker build --platform linux/amd64 …` then `docker save`) - the build only
> *copies* the binary, never execs it, so cross-building works. Copy `sbx-box.tar`
> to Windows and just run `sbx template load sbx-box.tar` there.

---

## How auth works

`box-mount` sends `Authorization: Bearer proxy-managed` to Box; the sbx proxy
replaces the `proxy-managed` sentinel with the real token from `sbx secret set box`
on outbound requests to the allowlisted Box hosts. The real token is never present
in the container, and `BOX_ACCESS_TOKEN` only ever reads as `proxy-managed` inside
the sandbox.

`box-mount` consumes the `BOX_ACCESS_TOKEN` env var directly - the documented
"developer token via environment variable, no config file needed" path - so it runs
in static-access-token mode and sends *some* token, which the proxy overwrites on
the wire.

**Do not** run `box-mount config` inside the sandbox. (Note: a
`~/.box-mount/box-config.json` would **not** override the env token - per the
Box Mount docs, *environment variables take precedence over file values*, and the
proxy overwrites the header regardless.) The reason to avoid `config` is different:
it runs an interactive OAuth/JWT handshake and can write `client_id` /
`client_secret` / `refresh_token` or `auth_type=jwt`, flipping the client out of
the simple static-token mode the proxy relies on. You don't need it - the kit
already supplies the token via env.

Full JWT / service-account mode has **no token expiry** (the SDK mints short-lived
assertions), which is attractive for longer sessions - but it needs the keypair JSON
*inside the container*, the opposite of this proxy/secret model, so it's a separate
setup.

---

## Troubleshooting

- **`FileNotFoundError: [Errno 2] No such file or directory: 'box-mount'` on mount** -
  the v0.4.0 `mount` command self-invokes a `box-mount` executable on `PATH`. If the
  binary was installed only as `agent-mount`, this fails. The Dockerfile installs it
  as `box-mount` (and `agent-mount`); rebuild if you see this. *(Found during arm64
  end-to-end bring-up.)*

- **`Cannot determine minimum Box Mount version allowed, exiting` (HTTP 403 from
  `cdn07.boxcdn.net/AgentMount.json`)** - the sync engine's startup version check
  hit a host that wasn't allowlisted, and the proxy default-denied it (403). Fix:
  `*.boxcdn.net` is in `permissions.network.allow` in `spec.yaml`; if a new CDN host
  appears, widen it. Find blocked hosts with `sbx policy log <sandbox-name>`.

- **`500 ... pull failed for image 'sbx-box:local'`** - the template image
  isn't in sbx's store, so `--template` fell back to pulling it from a registry (it's
  local-only - there's nothing to pull). The build/save/load didn't complete, usually
  because **Docker wasn't running** during `docker build`. Confirm with `docker
  version`, rebuild, `sbx template load sbx-box.tar`, then verify with `sbx template ls`.

- **`ERROR: unknown flag: --template`** - the `sbx` on that machine is too old / a
  different build. Check `sbx version`; `sbx run --help` should list `-t, --template`.

- **`403 Blocked by network policy` on mount** - the host the SDK reached isn't in
  the allowlist. Find it and add it to `permissions.network.allow` in `spec.yaml`:
  ```console
  sbx policy log <sandbox-name>
  ```
  The starting allowlist is `api.box.com`, `upload.box.com`, `dl.boxcloud.com`,
  `*.boxcloud.com`, `*.services.box.net`, `*.boxcdn.net` (the `services.box.net`
  entry covers the events long-poll used for two-way sync; widen here if sync stalls).

- **`box-mount: not found` / exec format error** - architecture mismatch; see the
  Architecture section above. Confirm with `sbx exec <sandbox> -- uname -m`.

- **`401 Unauthorized` from Box** - the token is invalid/expired. Developer tokens
  last ~60 min and cannot be refreshed under this kit (there's no refresh token, and
  a refresh POST carries client creds in the body, not the `Bearer` header the proxy
  injects). Fix: get a fresh token, `sbx secret set box`, and **recreate the
  sandbox** (the proxy binds the secret at creation time). To confirm whether it's
  the token vs. injection, test the token host-side:
  `curl -H "Authorization: Bearer <token>" https://api.box.com/2.0/users/me` - a 200
  means the token is good and the sandbox just needs recreating with the fresh secret.

- **`mount`/`status` work but file downloads 401** - Box download redirects often
  land on a `*.boxcloud.com` shard. It's network-allowed and covered by the
  `*.boxcloud.com` credential inject, but if you see a redirect host in `sbx policy
  log` that isn't getting a Bearer header, add it to the `credentials.inject` block.

- **Lost Box version history on save** - Box Mount doesn't support atomic-save
  (temp-file + rename); edit files in place inside the mount.

---

## Host-side binaries (not part of the sandbox)

The `box-mount/mac/box-mount` (darwin/arm64) and Windows builds run Box Mount
**on your host machine**, not inside the sandbox, and are **not** used by the kit.
Like the Linux binaries they are Box private-preview artifacts - obtain them from
Box; they are git-ignored, not shipped in this repo. Only a **Linux** binary
belongs inside an sbx sandbox.
