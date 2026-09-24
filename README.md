# Box Mount Contract Review with Docker Sandboxes

[Box Mount](https://developer.box.com/guides/box-mount) gives agents a filesystem backed by a Box folder. Tools can read documents and write results using ordinary file paths; a background process synchronizes changes in both directions, using the authenticated identity's Box permissions.

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) supplies the execution environment: an isolated microVM with its own filesystem and tools, managed through the `sbx` CLI.

This demo brings them together to compare a synthetic MSA with an approved legal playbook and save a review memo back to Box. It uses Box AI by default, or an optional OpenAI reviewer running inside the sandbox.

## Prerequisites

- An Ubuntu 24.04+ x86_64 host with KVM available and a sudo-capable account.
- Node.js 20+ and npm.
- A new, empty Box folder and its ID—the number at the end of its Box URL.
- A Box Developer Token and Box AI API access, or an OpenAI API key.
- The Linux x86_64 Box Mount binary from the [Box Mount preview](https://developer.box.com/guides/box-mount).

The steps below target Ubuntu, including a DigitalOcean droplet with nested virtualization. Environment checks and ARM instructions are in the [appendix](#appendix).

## Setup

### 1. Install Docker and Sandboxes

Run these commands on your Ubuntu host:

```bash
curl -fsSL https://get.docker.com | sudo SBX=1 sh
sudo usermod -aG kvm,docker "$USER"
```

Reconnect over SSH to apply the group memberships, then sign in:

```bash
sbx login
```

Docker Engine builds the template image; `sbx` creates and manages the sandbox. Docker Desktop is not required on this host. See [Docker's installation guide](https://docs.docker.com/ai/sandboxes/install/) for details.

### 2. Configure the project

```bash
git clone https://github.com/box-community/docker-box-mount.git
cd docker-box-mount
npm install
cp .env.example .env
chmod 600 .env
editor .env
```

Fill in `BOX_ACCESS_TOKEN` and `BOX_FOLDER_ID`. Leave `OPENAI_API_KEY` blank to use Box AI.

To use the OpenAI reviewer, set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in `.env`. To assign the resulting memo to a person, set `BOX_REVIEWER_USER_ID` to their Box user ID; otherwise, task assignment is skipped.

### 3. Build the Box Mount template

Place the supplied Linux executable in the kit and build:

```bash
mkdir -p kit/box-mount/linux
cp /path/to/box-mount kit/box-mount/linux/box-mount
chmod 0755 kit/box-mount/linux/box-mount
./kit/scripts/build-and-load.sh
```

The script builds `sbx-box:local` and loads it into the sandbox runtime's image store. Nothing is pushed to a registry.

This project uses [`sbx-kits-box`](https://github.com/ajeetraina/sbx-kits-box). Its [Dockerfile](kit/Dockerfile) packages the Box Mount executable in a **template**; its [kit specification](kit/spec.yaml) adds Box network rules and credential injection when the sandbox is created. The binary is supplied separately and is ignored by Git.

### 4. Register sandbox credentials

```bash
sbx secret set box
```

Paste the same Box token you put in `.env`. The host scripts read `.env` for Box API calls; Box Mount uses the secret registered with `sbx`. Editing `.env` does not populate the sandbox secret store.

If you configured the OpenAI reviewer, also run:

```bash
sbx secret set openai
```

Paste your OpenAI API key. Docker's [credential proxy](https://docs.docker.com/ai/sandboxes/configuration/credentials/) replaces placeholder credentials on matching outbound requests. Seeing `proxy-managed` in a sandbox environment variable is expected.

## Run

Run these steps in order from the project directory. Finish with teardown before starting another session; the commands share the sandbox name `box-contract-review`.

### 1. Validate your setup

```bash
npm run doctor
```

This checks the local configuration and fixtures, Box account and folder access, and whether a temporary sandbox can execute Box Mount. When OpenAI is configured, it also checks authentication and access to the selected model.

### 2. Seed the Box folder

```bash
npm run seed
```

This mounts your Box folder in a temporary sandbox and copies the sample files into the mount. Box Mount uploads them to Box; the command then unmounts and removes that sandbox.

Your Box folder now contains:

```text
Incoming/Acme-MSA.docx
Playbook/approved-contract-playbook.md
Reviewed/
```

### 3. Run the review

```bash
npm run demo
```

The demo creates a sandbox from the template and kit, then mounts your Box folder at `/home/agent/workspace/box`.

With **Box AI**, the host script asks Box AI to compare the documents stored in Box and writes the answer into the sandbox's mounted folder. With **OpenAI**, the reviewer runs inside the sandbox, reads the mounted documents, and sends their text to OpenAI for analysis.

Both paths write `Reviewed/Acme-MSA-review.md` into the mount for synchronization back to Box. Open that file in Box to inspect the findings. If a reviewer ID is configured, the demo attempts to assign a Box review task on the memo.

### 4. Explore the live workspace

The sandbox stays running after the review. Check the mount:

```bash
npm run status
```

You can also open a shell:

```bash
sbx exec -it box-contract-review -- bash
ls /home/agent/workspace/box
```

Changes in Box flow into this directory, and writes in the directory flow back to Box while sync is active. This is what lets an agent work with familiar filesystem tools while people continue working in Box.

### 5. Clean up

Exit the sandbox shell, then run on the host:

```bash
npm run teardown
```

This requests a final sync and unmount, then removes the sandbox and local session state. Successfully synchronized files remain in Box. Use this command when finished; the application does not enforce an automatic sandbox expiry.

The included contract and generated review are synthetic demonstrations, not legal advice.

## Appendix

### KVM and Ubuntu checks

```bash
ls -l /dev/kvm
npm run check:ubuntu
```

If `/dev/kvm` is absent, check kernel-module loading and nested virtualization support with your provider. If access is denied, confirm your account belongs to the `kvm` group and reconnect after changing membership. For additional diagnostics, install `cpu-checker` and run `kvm-ok`.

### Missing utilities and ARM hosts

If the build reports `file: command not found`:

```bash
sudo apt-get update
sudo apt-get install -y file
```

Install `curl`, `git`, or `ca-certificates` only if your image lacks them. For an ARM host, use the Linux arm64 binary at `kit/box-mount/linux-arm64/box-mount`; the build script selects the host architecture.

### Tokens and authentication

Box Developer Tokens expire after approximately 60 minutes and cannot refresh themselves. Update `.env` and `sbx secret set box`, then recreate the demo sandbox. For OpenAI key changes, update `.env` and `sbx secret set openai`.

An OpenAI error that names `proxy-managed` means the placeholder reached the API. Check the stored OpenAI secret and the request's use of Docker's credential proxy. An unavailable-model error should name your configured `OPENAI_MODEL`.

On headless Linux without a keyring, Docker stores secrets under `~/.config/com.docker.sandboxes` by default. Also keep `.env` private: this demo shares the project directory with the sandbox, so proxy injection alone does not hide secrets saved in that shared directory.

### Sync and template troubleshooting

Check `sbx template ls` if the sandbox cannot find `sbx-box:local`. Check `sbx policy log box-contract-review` for blocked network requests while the sandbox exists. Edit files in place inside the mount; save-by-replacement can affect Box version history.

See the [kit documentation](kit/README.md) for more detail. Keep the preview binary and images containing it private.
