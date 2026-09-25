# Box Mount Contract Review with Docker Sandboxes

[Box Mount](https://developer.box.com/guides/box-mount) gives agents a filesystem backed by a Box folder. Tools can read documents and write results using ordinary file paths; a background process synchronizes changes in both directions, using the authenticated identity's Box permissions.

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) supplies the execution environment: an isolated microVM with its own filesystem and tools, managed through the `sbx` CLI.

This demo brings them together: an agent discovers a synthetic MSA and approved legal playbook, compares them, and saves a review memo back to Box. Its agent loop and filesystem tools run inside the sandbox; the model runs on OpenAI.

## Prerequisites

- An Ubuntu 24.04+ x86_64 host with KVM available and a sudo-capable account.
- Node.js 20+ and npm.
- A new, empty Box folder and its ID—the number at the end of its Box URL.
- A Box Developer Token and an OpenAI API key.
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

Fill in `BOX_ACCESS_TOKEN`, `BOX_FOLDER_ID`, and `OPENAI_API_KEY`. All three are required; missing values stop the command before it creates a sandbox.

Optionally set `OPENAI_MODEL` in `.env`. To assign the resulting memo to a person, set `BOX_REVIEWER_USER_ID` to their Box user ID; otherwise, task assignment is skipped.

### 3. Build the Box Mount template

Clone the upstream [Box Kit](https://github.com/ajeetraina/sbx-kits-box) next to this project. From the `docker-box-mount` directory:

```bash
git clone https://github.com/ajeetraina/sbx-kits-box.git ../sbx-kits-box
git -C ../sbx-kits-box checkout --detach 897deef77ee6c7dedea81c600f5fbc3753eff550
mkdir -p ../sbx-kits-box/box-mount/linux
cp /path/to/box-mount ../sbx-kits-box/box-mount/linux/box-mount
chmod 0755 ../sbx-kits-box/box-mount/linux/box-mount
(cd ../sbx-kits-box && ./scripts/build-and-load.sh)
```

The upstream script builds `sbx-box:local` and loads it into the sandbox runtime's image store. Nothing is pushed to a registry. The subshell returns you to the demo project for the remaining commands.

The upstream [Dockerfile](https://github.com/ajeetraina/sbx-kits-box/blob/897deef77ee6c7dedea81c600f5fbc3753eff550/Dockerfile) packages the private Box Mount binary in a **template**. At sandbox creation, `sbx` fetches the upstream [kit specification](https://github.com/ajeetraina/sbx-kits-box/blob/897deef77ee6c7dedea81c600f5fbc3753eff550/spec.yaml) directly from GitHub to apply Box network rules and credential injection. This project does not bundle a kit; both references use the same pinned commit.

On a fresh host, allow Docker Hub and this kit repository as [trusted kit sources](https://docs.docker.com/ai/sandboxes/customize/use-kits/#restrict-kit-sources):

```bash
sbx settings set kit.allowedSources '["docker.io/","github.com/ajeetraina/sbx-kits-box"]'
```

If you already customized `kit.allowedSources`, add this repository to your existing list instead of replacing it. Sandbox creation needs access to GitHub to resolve the kit.

### 4. Register sandbox credentials

```bash
npm run setup
```

This reads both tokens from `.env` and registers them with `sbx` through stdin—no second paste, token-bearing command arguments, or token logs. It creates or replaces the host-level `box` and `openai` service secrets, just like the manual `sbx secret set` commands. No sandbox is created by this step.

The host scripts use the Box token for account checks and optional task assignment. Inside the sandbox, Docker's [credential proxy](https://docs.docker.com/ai/sandboxes/configuration/credentials/) replaces placeholder credentials on matching outbound requests. Seeing `proxy-managed` in a sandbox environment variable is expected.

## Run

Run these steps in order from the project directory. Finish with teardown before starting another session; the commands share the sandbox name `box-contract-review`.

### 1. Validate your setup

```bash
npm run doctor
```

This checks the local configuration and fixtures, Box account and folder access, and whether a temporary sandbox can execute Box Mount. It also checks OpenAI authentication and access to the selected model.

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

The demo creates a sandbox from the local template and the pinned upstream GitHub kit, then mounts your Box folder at `/home/agent/workspace/box`.

The agent receives a goal: **review the incoming contract against the approved playbook and save the findings**. It chooses its own sequence of `list_files`, `read_file`, and `write_file` calls, observes each result, and can correct errors or revise its report. DOCX text extraction is handled by `read_file`; source documents are not preloaded into the prompt.

All filesystem actions execute inside Docker Sandbox against the Box Mount directory. Text returned by reads is sent to OpenAI for analysis. Tool handlers restrict reads to Markdown/DOCX sources in `Incoming/` and `Playbook/`, plus the review output; writes are limited to `Reviewed/Acme-MSA-review.md`. The agent has no shell or credential-reading tool. These are application-enforced tool permissions, in addition to the sandbox's isolation and Box's access controls.

After the runner finishes, the terminal prints its tool-action trace without document contents or model reasoning. Completion requires this run to read both sources, write the review, and read back the latest saved version. The sequence is model-selected, not a fixed script.

The reviewer writes `Reviewed/Acme-MSA-review.md` into the mount for synchronization back to Box. Open that file in Box to inspect the findings. If a reviewer ID is configured, the demo attempts to assign a Box review task on the memo.

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

### Agent limits and failures

The runner stops after 20 model turns, 30 tool calls, or four minutes, whichever comes first. Each API request has a 60-second timeout and an 8,192-output-token cap. Files are limited to 2 MiB, returned document text and saved reviews to 128 KiB, and directory listings to 200 entries. Paths are validated; traversal, symlinks, hard links, and writes outside the designated review file are rejected.

Recoverable tool errors are returned to the model so it can choose another action. API failures, exhausted limits, or an unverified result fail the demo explicitly, without a substitute reviewer. A failed run may already have written a partial review into the synced folder; inspect any such file before using it. Read-back verifies the local saved file, not Box synchronization or legal correctness. Qualified legal review is still required.

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

Install `curl`, `git`, or `ca-certificates` only if your image lacks them. For an ARM host, put the Linux arm64 binary at `../sbx-kits-box/box-mount/linux-arm64/box-mount` instead; the upstream build script selects the host architecture.

### Tokens and authentication

Box Developer Tokens expire after approximately 60 minutes and cannot refresh themselves. Whenever either token changes, update it in `.env`, run `npm run setup`, and recreate the demo sandbox. Editing `.env` alone does not update the secret store. Setup validates both tokens are present before registering them; if one registration fails, fix the reported issue and rerun the command to register both again. Registration stores credentials; `npm run doctor` checks whether they work.

An OpenAI error that names `proxy-managed` means the placeholder reached the API. Check the stored OpenAI secret and the request's use of Docker's credential proxy. An unavailable-model error should name your configured `OPENAI_MODEL`.

On headless Linux without a keyring, Docker stores secrets under `~/.config/com.docker.sandboxes` by default. Also keep `.env` private: this demo shares the project directory with the sandbox, so proxy injection alone does not hide secrets saved in that shared directory.

### Sync and template troubleshooting

Check `sbx template ls` if the sandbox cannot find `sbx-box:local`. Check `sbx policy log box-contract-review` for blocked network requests while the sandbox exists. Edit files in place inside the mount; save-by-replacement can affect Box version history.

If `sbx` rejects the GitHub source, check `sbx settings get kit.allowedSources` and the trusted-source step above. Do not use a wildcard to allow every publisher. If your organization manages this setting, ask its administrator to permit the upstream repository.

See the [upstream kit documentation](https://github.com/ajeetraina/sbx-kits-box#readme) for build, publishing, and kit-specific troubleshooting. Keep the preview binary and images containing it private.

### Updating or migrating the kit

The upstream revision is pinned by `BOX_KIT_REVISION` in `src/sandbox.ts`. To upgrade, review the upstream changes, update that constant and the checkout revision in these instructions together, rebuild the template from the same commit, and recreate the sandbox. Updating the separate build checkout alone does not change the runtime kit reference.

When upgrading from an older version of this demo, copy any private binary left in `kit/box-mount/` into the separate upstream checkout before deleting local leftovers. The old directory remains ignored by Git to protect those files; none of the code or build instructions depend on it.
