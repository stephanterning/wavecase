# Wavecase

Self-hosted music sharing through private links, version-specific feedback, and listening analytics. Built with React, React Compiler, React Router, TypeScript, Node.js, PostgreSQL, Drizzle, SimpleWebAuthn, FFmpeg, wavesurfer.js, and pg-boss.

The first implementation is undergoing local validation. It has not been released. See the [specification](docs/wavecase-specification.md), [implementation status](docs/implementation-status.md), and [testing guide](docs/testing.md).

## Run with Docker

Requires Docker Compose. Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with a random URL-safe password, and set `APP_URL` to the exact browser origin.

```sh
docker compose up --build -d
```

Open `http://localhost:3000` on the host Mac. The first visitor creates the administrator account with a passkey and chooses open or invitation-only registration. Subsequent accounts follow that policy. Keep the installation private until you have completed setup.

Passkeys require HTTPS except on localhost. A phone cannot use the Mac's `localhost`; phone testing requires an HTTPS origin pointing to this installation. Set `APP_URL` before creating the account you intend to keep: passkeys are bound to the hostname. Domain, proxy, tunnel, and backup operations are outside this project's scope.

By default the published port binds to the Mac's loopback interface. Adjust `BIND_ADDRESS` only when your network/proxy arrangement requires it. PostgreSQL is not exposed on the host.

```sh
docker compose logs -f web worker
docker compose down
```

Stopping or rebuilding containers preserves `data/audio` and `data/postgres`, which are bind-mounted host directories. Database metadata and the corresponding audio directory must be backed up consistently. The `.env` file contains installation secrets; it and `data/` are ignored by Git.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Exact public origin for passkeys and request checks. |
| `POSTGRES_PASSWORD` | Required | URL-safe database password. |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface for the web port. |
| `MAX_UPLOAD_MB` | `256` | Maximum uploaded audio size. |
| `MAX_DURATION_SECONDS` | `7200` | Maximum source duration. |
| `TRUST_PROXY` | Empty | Comma-separated trusted proxy IPs/subnets. Leave empty for direct access; never trust arbitrary forwarded headers. |
| `GEOIP_DATABASE` | Empty | Optional path inside the container to an operator-provided GeoIP City MMDB database. For example `/data/audio/GeoLite2-City.mmdb`. No lookup request is sent to an external service. Unknown locations remain unknown. Obtain and update the database under its provider's terms. |

## Passkeys and recovery

Manage additional passkeys under **Your account**. Keep at least one passkey registered. An administrator can create a single-use recovery link for another account after verifying the person's identity. The link expires after 15 minutes; successful recovery revokes the old passkeys and sessions. Share recovery links securely.

An administrator who loses every passkey needs server access:

```sh
docker compose exec web npm run recover -- administrator@example.com
```

Open the generated link and enroll a replacement passkey. Email is an account identifier, not a login or recovery delivery mechanism.

## Development

Use Node.js 24 and FFmpeg/ffprobe. Configure `DATABASE_URL`, `APP_URL`, and `DATA_DIR` for a development database before running:

```sh
npm ci
npm run db:migrate
npm run dev
npm run worker
```

Run the worker in a separate terminal. `npm run db:generate` generates migrations after schema changes. Commit migrations and `package-lock.json` with the related code.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Database integration tests only execute when `DATABASE_URL` ends in `/wavecase_test`; see the testing guide. Production client bundles contain React Compiler's memoization runtime. Dependencies are pinned to exact versions.

## Design and license

The [interface concept](docs/design/wavecase-design.html) is an earlier interactive mockup with example data. Its [editable fragment](docs/design/wavecase-design.fragment.html) is preserved for reference.

Copyright © 2026 Wavecase contributors. Licensed under [GNU AGPL version 3](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md). All committed content is written in English.

## Published Docker images

GitHub Actions tests pull requests and pushes to every branch with PostgreSQL 17
and FFmpeg, including the database integration suite. Successful branch builds publish
`ghcr.io/stephanterning/wavecase:sha-<full-40-character-commit>` for both
`linux/arm64` (Apple Silicon) and `linux/amd64`. The workflow can also be run
manually for any branch selected in **Actions → Test and publish image → Run
workflow**. Re-running it preserves an already published commit image. Pull
requests test only; they never publish images.

Publishing a GitHub Release or pre-release adds its version tag to the existing
commit image, without rebuilding it. Use names such as `v0.1.0-rc.1` and
`v0.1.0`. Wait for the commit's image build to succeed before publishing a
release; if it is still building, re-run the failed release job afterwards.
Release commits must have a published branch build; they do not need to be on
`main`. Moving an existing version to a different image is rejected. There are no floating `latest` or `main` tags.

To promote a tested candidate, create a stable release tag on **the same commit**
as the pre-release. Both versions then resolve to the same image digest. The
Actions job summary records the tag, commit (for releases), and exact
`ghcr.io/stephanterning/wavecase@sha256:...` reference. Deployments should pin that
digest. Keep commit and release images in GHCR for as long as deployments or
rollback plans reference them.

Publishing uses the repository's `GITHUB_TOKEN` with `packages: write`; no
personal token or deployment credentials are required. After the first publish,
check the package's visibility and Actions access in GitHub Packages. Public
source does not automatically make the container package public. Private package
consumers need registry read access; public images can be pulled anonymously.

Wavecase only builds and publishes software. It does not trigger deployments or
know about deployment repositories, servers, domains, or environments.

### Image runtime contract

The same image runs both roles:

- **Web:** the default command runs database migrations, then starts the server
  on port `3000`. `GET /health` checks database connectivity.
- **Worker:** override the command with `["npm", "run", "worker"]`. Start it after
  web is healthy. FFmpeg and ffprobe are included in the image.
- **Explicit migrations:** an orchestrator can run `["npm", "run", "db:migrate"]`
  once before starting the services, and override web's command with
  `["npm", "start"]` to avoid migrating again at web startup.

Provide `DATABASE_URL`, `APP_URL` (the exact HTTPS origin), and `DATA_DIR` to both
roles. Mount the same persistent audio directory at `DATA_DIR` for web and worker
within one installation. PostgreSQL 17 runs separately using its official image.
See the configuration table above for upload limits and optional settings.

Each environment needs its own database, credentials, and audio storage. Keep
setup access restricted until its administrator has registered a passkey at the
final hostname. Database and audio backups, migration sequencing, health checks,
and deployment/rollback decisions belong to the operator. Rolling back an image
does not undo database migrations.
