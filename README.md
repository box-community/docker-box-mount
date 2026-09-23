# Docker Sandbox Box Mount contract review

This project demonstrates contract review with Box Mount and Docker Sandboxes. It uses [`sbx-kits-box`](https://github.com/ajeetraina/sbx-kits-box) for the Box Mount binary, Box network policy, and proxy-managed credentials.

## Quick setup — Ubuntu / DigitalOcean

Start with an Ubuntu 24.04+ x86_64 host with KVM available, a sudo-capable SSH account, and Node.js 20+. Have an empty Box folder, a Box Developer Token with Box AI access, and the [developer preview Box Mount](https://developer.box.com/guides/box-mount) Linux binary ready. See the [appendix](#appendix) for environment checks.

### 1. Install Docker and Sandboxes

```bash
curl -fsSL https://get.docker.com | sudo SBX=1 sh
sudo usermod -aG kvm,docker "$USER"
```

Disconnect and SSH back in to apply both group memberships, then sign in:

```bash
sbx login
```

### 2. Set up the project

```bash
git clone <your-repository-url> docker-box-mount
cd docker-box-mount
npm install
mkdir -p kit/box-mount/linux
cp /path/to/box-mount kit/box-mount/linux/box-mount
chmod 0755 kit/box-mount/linux/box-mount
cp .env.example .env
chmod 600 .env
editor .env
```

Set `BOX_ACCESS_TOKEN` and `BOX_FOLDER_ID` in `.env`. Leave the optional fields blank to use Box AI.

### 3. Build and authenticate

```bash
./kit/scripts/build-and-load.sh
sbx secret set box
```

Paste the same Box token at the secret prompt. Editing `.env` does not export its values into your shell.

## Run

```bash
npm run doctor   # validate setup
npm run seed     # upload the sample contract and playbook
npm run demo     # generate the review
```

Find the memo in your Box folder at `Reviewed/Acme-MSA-review.md`. The sandbox stays running for exploration.

```bash
npm run status   # check the mounted workspace
npm run teardown # finish syncing and remove the sandbox when done
```

The fixtures are synthetic and the generated memo is not legal advice.

## Appendix

### Missing utilities

If the build reports `file: command not found`, install it and retry:

```bash
sudo apt-get update
sudo apt-get install -y file
```

If `curl` or `git` is missing, install the corresponding package with `apt-get`. Install `ca-certificates` if the system lacks trusted CA certificates. The optional `kvm-ok` diagnostic below is provided by `cpu-checker` (`sudo apt-get install -y cpu-checker`).

### KVM and host checks

Docker Sandboxes needs hardware virtualization. On a cloud VM, this requires nested virtualization. Check your host with:

```bash
ls -l /dev/kvm
kvm-ok
npm run check:ubuntu
```

If `/dev/kvm` is absent, investigate KVM availability and kernel-module loading with your provider. The host must expose virtualization support before `sbx` can run. If access is denied, confirm your user belongs to the `kvm` group and reconnect after changing membership.

### ARM hosts

For an arm64 host, place the Linux arm64 binary at `kit/box-mount/linux-arm64/box-mount`. The build script selects the binary for your host architecture. Use `file` to check the binary; an amd64 build cannot run in an arm64 sandbox.

### Credentials and token rotation

The kit uses a `proxy-managed` sentinel for Box requests; the host proxy injects the stored Box credential. On headless Linux without a keyring, `sbx` stores secrets under `~/.config/com.docker.sandboxes` by default. Treat that directory and `.env` as sensitive.

When a Box token expires, update `.env`, run `sbx secret set box` with the replacement token, and recreate the sandbox with `npm run teardown` followed by `npm run demo`.

### Inspecting the sandbox

```bash
sbx exec -it box-contract-review -- bash
```

The mounted Box folder is at `/home/agent/workspace/box`. See [the kit documentation](kit/README.md) for binary setup and sync troubleshooting. The private Box Mount binary is ignored by Git; keep it and any image containing it private.
