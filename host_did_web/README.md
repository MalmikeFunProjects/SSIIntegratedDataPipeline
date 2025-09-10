# Host DID Web

A Go service that **fetches and publishes `did:web` documents** into a GitHub Pages repository using **batched Git commits & pushes**. Designed to sit in your SSI toolchain and host DID documents reliably with minimal setup.

---

## Features

* **HTTP API** to request hosting for `did:web` DIDs
* **Fetches** DID documents from upstream servers with custom `Host` headers
* **Maps** DIDs to correct file paths in GitHub Pages repositories
* **Validates** DID document integrity and consistency
* **Batches** Git operations for efficiency
* **Health endpoint** for monitoring
* **Docker support** with secure SSH configuration

---

## API Endpoints

### `POST /process-did`
Processes and hosts a `did:web` DID.

**Request:**
```json
{ "did": "did:web:username.github.io:project:optional:sub:path" }
```

**Success Response:**
```json
{ "success": true, "message": "DID document processed successfully" }
```

**Error Response:**
```json
{ "success": false, "error": "error message" }
```

### `GET /health`
Health check endpoint:
```json
{ "status": "healthy" }
```

---

## DID to File Path Mapping

Given: `did:web:username.github.io:project:sub:dir`

* **Host**: `username.github.io` (must end with `github.io`)
* **Project**: `project` (must match GitHub repo name)
* **Path segments**: `sub/dir` (optional)

**Output files:**
```
project/sub/dir/did.json   # with path segments
project/did.json           # project only
```

The service validates that the JSON contains:
```json
{ "id": "did:web:username.github.io:project:sub:dir" }
```

---

## ⚙️ Configuration

Configure via environment variables:

| Variable        | Default                                 | Description                                          |
| --------------- | --------------------------------------- | ---------------------------------------------------- |
| `SERVER_URL`    | `http://localhost:3332`                 | Base URL serving `did.json` files                   |
| `BRANCH`        | `gh-pages`                              | Git branch to commit to                              |
| `GIT_REMOTE`    | `origin`                                | Git remote name                                      |
| `COMMIT_MSG`    | `chore (did): update did:web documents` | Commit message prefix                                |
| `DRY_RUN`       | `false`                                 | Skip Git operations (write files only)              |
| `PORT`          | `8080`                                  | HTTP server port                                     |
| `BATCH_TIMEOUT` | `5s`                                    | Max wait before auto-flushing batch                 |
| `BATCH_SIZE`    | `10`                                    | Flush when batch reaches this size                  |
| `GH_USER`       | *(required)*                            | Git author name                                      |
| `GH_EMAIL`      | *(required)*                            | Git author email                                     |
| `GH_REPO`       | *(required)*                            | SSH repo URL: `git@github.com:User/Repo.git`        |

Create a `.env` file or set environment variables directly. See `sample.env` for reference.

---

## 🔐 SSH Setup (Deploy Key)

### 1. Generate SSH Key
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
# Save as ~/.ssh/docker_github
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/docker_github
```

### 2. Add Deploy Key to GitHub
1. Go to your repo: **Settings → Deploy keys → Add deploy key**
2. Title: `host-did-web (write)`
3. Key: Contents of `~/.ssh/docker_github.pub`
4. ✅ Check **Allow write access**

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

1. **Create docker-compose.yml:**
```yaml
services:
  host_did_web:
    build: ./host_did_web
    ports:
      - "3999:3999"
    environment:
      - SERVER_URL=http://your-veramo-server:3332
      - GH_USER=your-github-username
      - GH_EMAIL=your-email@example.com
      - GH_REPO=git@github.com:your-username/your-repo.git
    volumes:
      - type: bind
        source: ${HOME}/.ssh/docker_github
        target: /root/.ssh/id_rsa
        read_only: true
      - type: bind
        source: ${HOME}/.ssh/docker_github.pub
        target: /root/.ssh/id_rsa.pub
        read_only: true
```

2. **Run:**
```bash
docker-compose up --build
```

### Option 2: Docker (Manual)

1. **Build:**
```bash
docker build -t host-did-web ./host_did_web
```

2. **Run (Linux/macOS):**
```bash
docker run --name host_did_web --rm \
  -p 3999:3999 \
  -e GH_USER=your-github-username \
  -e GH_EMAIL=your-email@example.com \
  -e GH_REPO=git@github.com:your-username/your-repo.git \
  -v "$HOME/.ssh/docker_github:/root/.ssh/id_rsa:ro" \
  -v "$HOME/.ssh/docker_github.pub:/root/.ssh/id_rsa.pub:ro" \
  host-did-web
```

**For SELinux systems (Fedora/RHEL/CentOS):** Add `:z` to volume flags:
```bash
-v "$HOME/.ssh/docker_github:/root/.ssh/id_rsa:ro,z"
```

**For Windows (PowerShell):**
```powershell
docker run --name host_did_web --rm `
  -p 3999:3999 `
  -e GH_USER=your-github-username `
  -e GH_EMAIL=your-email@example.com `
  -e GH_REPO=git@github.com:your-username/your-repo.git `
  --mount type=bind,src="$env:USERPROFILE\.ssh\docker_github",dst=/root/.ssh/id_rsa,ro `
  --mount type=bind,src="$env:USERPROFILE\.ssh\docker_github.pub",dst=/root/.ssh/id_rsa.pub,ro `
  host-did-web
```

### Option 3: Local Go Development

1. **Setup environment:**
```bash
# Create .env file with your settings
cp sample.env .env
# Edit .env with your values
```

2. **Run:**
```bash
go run src/main.go
```

---

## Testing

1. **Health check:**
```bash
curl -sS http://localhost:3999/health
```

2. **Process a DID:**
```bash
curl -sS -X POST http://localhost:3999/process-did \
  -H 'content-type: application/json' \
  -d '{"did":"did:web:yourname.github.io:your-project"}'
```

3. **Verify the result:**
   - Check your GitHub repo for the new `did.json` file
   - Verify it's accessible at: `https://yourname.github.io/your-project/did.json`

---

## Batching Behavior

The service batches multiple DID requests for efficiency:

- **Triggers a flush when:**
  - Batch size reaches `BATCH_SIZE`, OR
  - `BATCH_TIMEOUT` elapses since last flush

- **Each flush performs:**
  - Validation of repo/user consistency
  - `git add` → single `commit` → `push`

- Each request waits for its batch to complete (30s timeout)

---

## Security Notes

- Use **Deploy Keys** with write access (recommended over personal SSH keys)
- Never bake private keys into Docker images
- Mount SSH keys read-only at runtime
- Ensure GitHub Pages is configured to serve from your chosen branch
- The service validates DID host/project against repo owner/name for safety

---

## Troubleshooting

**Permission denied (publickey)**
- Verify Deploy Key is added with write access
- Check key mounts: `docker exec -it host_did_web ls -l /root/.ssh`
- Test SSH: `docker exec -it host_did_web ssh -T git@github.com`

**Host key verification failed**
- Rebuild image or manually add GitHub keys:
  ```bash
  ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> ~/.ssh/known_hosts
  ```

**Username/repo mismatch errors**
- DID host must match repo owner
- DID project must match repo name
- Service enforces these constraints for security

**DID document ID mismatch**
- Upstream server must return exact DID in `"id"` field
- Service forwards `Host` header to help upstream generate correct ID

---

## Project Structure

- `src/main.go` — Main application logic
- `startup.sh` — Container initialization script
- `Dockerfile` — Container build configuration
- `sample.env` — Environment variable template
- `sample.gitignore` — Git ignore suggestions

