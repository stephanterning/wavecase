# Operations

For first setup, follow the [README](../README.md). The supplied Compose file builds from the checkout and runs web, worker, and PostgreSQL 17 services. Domains, HTTPS proxies/tunnels, host security, backups, and deployment decisions belong to the operator.

## Configuration

Compose reads `.env`; it supplies the same application environment to web and worker.

| Variable | Compose default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Required | Random URL-safe database password; replace the example value. |
| `APP_URL` | `http://localhost:3000` | Exact browser origin for passkeys, request checks, and generated links. Use HTTPS outside localhost. |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface for web port 3000. |
| `MAX_UPLOAD_MB` | `256` | Audio upload size limit in MiB. Artwork has a separate 10 MiB limit. |
| `MAX_DURATION_SECONDS` | `7200` | Audio duration limit. |
| `TRUST_PROXY` | Empty | Comma-separated trusted proxy IPs/subnets. Leave empty for direct access; do not trust arbitrary forwarded headers. |
| `GEOIP_DATABASE` | Empty | Container path to an operator-supplied GeoIP City MMDB file. Lookups stay local; missing information stays unknown. |

For geolocation, a file at `data/audio/GeoLite2-City.mmdb` is available as `/data/audio/GeoLite2-City.mmdb`. Obtain and update it under the provider's terms, and restart web after replacing it. The database is not bundled.

Outside Compose, supply `DATABASE_URL`, `APP_URL`, and `DATA_DIR` explicitly to both roles. `DATA_DIR` defaults to `data/audio`; the production server's `PORT` defaults to `3000`. Compose sets the database connection internally and mounts `DATA_DIR` at `/data/audio`. Its database has no host port.

A phone cannot use the host's localhost address. Point an HTTPS origin at the installation and configure `APP_URL` before enrolling passkeys. Ensure proxy upload-size and timeout limits accommodate the configured uploads and first-time MP3 preparation.

## Accounts and recovery

**Your account** manages passkeys and prevents removing the last one. **Installation settings** manages registration, seven-day single-use invitations, and account disablement. Administrator status does not grant access to other owners' private music or analytics.

After verifying a non-administrator's identity, an administrator can generate a single-use recovery link. It expires after 15 minutes. Successful enrollment replaces the account's old passkeys and sessions. Share the link securely; email is an account identifier, not an authentication or delivery mechanism.

Recover an administrator with server access:

```sh
docker compose exec web npm run recover -- administrator@example.com
```

Open the generated link at the configured origin and enroll a replacement passkey.

## Storage and upgrades

`data/postgres` contains database metadata, accounts, comments, waveform peaks, analytics, and queued jobs. `data/audio` contains demo masters/legacy files, MP3 exports, release masters/AAC playback, artwork, and pending uploads. Web and worker must share this directory. Never serve it as a public static directory.

Before upgrading, take a consistent database-and-file backup and retain `.env` securely. Stop web and worker during the backup if necessary to avoid mismatched files and metadata. Do not copy a running PostgreSQL data directory as if it were an ordinary file backup; use PostgreSQL backup tooling or stop the database for a filesystem copy.

After updating the checkout, `docker compose up --build -d` rebuilds both roles. Web applies migrations before serving; worker waits for web's health check. Check `docker compose ps` and `docker compose logs web worker`. `GET /health` checks database connectivity, not worker progress. Pending uploads are reconciled by the worker at startup and every minute.

Container removal preserves bind-mounted data. Deleting the host directories does not. Keep database and audio backups consistent when restoring; rolling back an image does not undo migrations. Separate installations need separate databases, credentials, and storage.

## Published images

[CI](../.github/workflows/ci.yml) builds the application and runs lint, type checking, and the full database suite for pull requests and every branch push. Successful branch pushes and manual workflow runs publish:

```text
ghcr.io/stephanterning/wavecase:sha-<full-40-character-commit>
```

Images support `linux/amd64` and `linux/arm64`. Pull-request runs do not publish. Re-running a commit build preserves an existing image. There are no floating `latest` or `main` tags.

A published GitHub Release or pre-release, such as `v0.1.0` or `v0.1.0-rc.1`, [tags the existing commit image](../.github/workflows/release.yml) without rebuilding. Wait for that branch build first; if the release job ran too early, rerun it. Release commits need not be on `main`. Promoting a candidate on the same commit keeps the same image digest; moving an existing version to another image is rejected.

The Actions summary records the exact `ghcr.io/stephanterning/wavecase@sha256:...` reference. Pin that digest for deployment and retain images needed for rollback. Publishing uses `GITHUB_TOKEN` with `packages: write`; package visibility and Actions access are configured in GitHub Packages. Public source does not automatically make the package public. Private consumers need registry read access.

The supplied Compose file uses `build: .`; it does not select published images. For image-based deployment, use the same pinned image for both roles:

| Role | Command | Requirement |
| --- | --- | --- |
| Web | Image default: `npm run db:migrate && npm start` | Serve port 3000 and wait for `/health`. |
| Worker | `["npm", "run", "worker"]` | Start after migrations/web health; share database and files with web. |
| Explicit migration job | `["npm", "run", "db:migrate"]` | If run separately, start web with `["npm", "start"]`. |

The image includes FFmpeg and ffprobe; PostgreSQL runs separately. Publishing images never triggers a deployment.
