# Docker Sandbox Box Mount contract review

This project demonstrates contract review with Box Mount and Docker Sandboxes. It uses [`sbx-kits-box`](https://github.com/ajeetraina/sbx-kits-box) for the Box Mount binary, Box network policy, and proxy-managed credentials.

## Ubuntu / DigitalOcean setup

Docker Sandboxes on Linux requires Ubuntu 24.04 or newer, x86_64 or arm64, and KVM hardware virtualization. A cloud droplet must expose `/dev/kvm`; many ordinary VPS plans do not provide nested virtualization. Confirm this first:

```bash
uname -m
ls -l /dev/kvm
```

If `/dev/kvm` is absent, choose a DigitalOcean plan/image that supports nested virtualization or use a different host. Do not continue with a container-only workaround: `sbx` runs microVMs and needs KVM.

1. Create an Ubuntu 24.04 droplet with a public IP and SSH in as a sudo-capable user.

2. Install the host dependencies and KVM tools:

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl file git qemu-kvm cpu-checker
   sudo usermod -aG kvm "$USER"
   newgrp kvm
   ```

3. Install Docker Engine and Docker Sandboxes. Docker’s installer sets up the `docker-sbx` package with `SBX=1`:

   ```bash
   curl -fsSL https://get.docker.com | sudo SBX=1 sh
   sudo usermod -aG docker "$USER"
   newgrp docker
   sbx login
   ```

   `sbx login` is required once. On a headless droplet, the CLI stores secrets under `~/.config/com.docker.sandboxes`; protect the account and home directory.

4. Install Node.js 20 or newer, then clone this project:

   ```bash
   # Use your preferred Node.js 20+ installation method.
   node --version
   git clone <your-fork-or-copy-url> docker-box-mount
   cd docker-box-mount
   npm install
   npm run check:ubuntu
   ```

5. Obtain the private Box Mount Linux binary from Box. On an x86_64 droplet, place it here and make it executable:

   ```bash
   mkdir -p kit/box-mount/linux
   cp /path/to/box-mount kit/box-mount/linux/box-mount
   chmod 0755 kit/box-mount/linux/box-mount
   file kit/box-mount/linux/box-mount   # must report ELF 64-bit x86-64
   ```

   The binary is private-preview material and is ignored by Git. Do not commit or publish it.

6. Create `.env` and set the Box values:

   ```bash
   cp .env.example .env
   chmod 600 .env
   editor .env
   ```

   Set `BOX_ACCESS_TOKEN` to a valid Box Developer Token and `BOX_FOLDER_ID` to an empty Box folder ID. Developer Tokens are short-lived. Box AI access is used by default; configure `OPENAI_API_KEY` only if your OpenAI reviewer path is enabled.

7. Build and load the amd64 template, then store the Box secret in the host-side proxy:

   ```bash
   ./kit/scripts/build-and-load.sh
   printf '%s\n' "$BOX_ACCESS_TOKEN" | sbx secret set box
   sbx secret ls
   ```

The kit keeps the real token out of the sandbox. The container sees only the `proxy-managed` sentinel and Docker injects the credential on allow-listed Box requests.

## Run

```bash
npm run doctor
npm run seed
npm run demo
npm run status
npm run teardown
```

Run these commands from the project directory:

```bash
npm run doctor   # validates Box access, the template, and the Box Mount binary
npm run seed     # uploads the synthetic contract and playbook to Box
npm run demo     # creates the sandbox, mounts Box, and generates the review
npm run status   # checks sync and the generated workspace
npm run teardown # final sync, unmount, and remove the sandbox
```

`demo` creates the named `box-contract-review` sandbox with `sbx`, mounts the Box folder at `/home/agent/workspace/box`, writes the review to `Reviewed/Acme-MSA-review.md`, and leaves the sandbox running. Use `sbx exec box-contract-review -- bash` to inspect it.

If the token expires, update `.env`, run `printf '%s\n' "$BOX_ACCESS_TOKEN" | sbx secret set box`, remove the old sandbox with `npm run teardown`, and run `npm run demo` again. The secret is injected by the kit’s Box proxy; the real token is not placed in the sandbox filesystem.

The fixtures are synthetic and the generated memo is not legal advice. Box Mount is a private-preview binary and is intentionally not committed.
