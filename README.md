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
