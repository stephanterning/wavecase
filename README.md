# Wavecase

Self-hosted music sharing for works in progress and finished releases. Uploaders sign in with passkeys; listeners need no account.

- **Private demos:** named share links, audio versions, waveform comments, and listening analytics.
- **Public releases:** artist and songwriter pages, credits, streaming/shop links, and continuous playback across public music pages.
- **Downloads:** email-gated ZIPs with audio, artwork, and metadata. Demos offer WAV/MP3 or legacy originals; releases preserve uploaded WAV masters.

Built with React, React Compiler, React Router, TypeScript, Node.js, PostgreSQL, Drizzle, SimpleWebAuthn, FFmpeg, wavesurfer.js, and pg-boss. See [current scope and limitations](docs/implementation-status.md).

## Run with Docker

Requires Docker with Compose. From a checkout:

```sh
cp .env.example .env
```

Edit `.env`: replace `POSTGRES_PASSWORD` with a random URL-safe password and set `APP_URL` to the exact browser origin. Then:

```sh
docker compose up --build -d
```

Open [localhost:3000](http://localhost:3000) on the host, or your configured origin. The first visitor creates the administrator account and chooses open or invitation-only registration. Keep access private until setup is complete.

Passkeys require HTTPS except on localhost and are bound to the hostname. Choose the intended hostname before enrolling permanent accounts. The default web port binds to `127.0.0.1`; PostgreSQL is not exposed on the host.

```sh
docker compose logs -f web worker
docker compose down
```

Data persists in `data/postgres` and `data/audio` across container rebuilds. Back them up together; `.env` contains secrets. See [operations](docs/operations.md) for configuration, recovery, upgrades, and published images.

## Documentation

- [Development and testing](docs/testing.md): local setup, isolated tests, and device checks.
- [Product and technical specification](docs/wavecase-specification.md): behavior, access rules, audio policies, and repository structure.
- [Implementation status](docs/implementation-status.md): supported scope and remaining acceptance work.

The [design concept](docs/design/wavecase-design.html) and [editable fragment](docs/design/wavecase-design.fragment.html) are historical mockups with example data, not the current interface.

## License

Copyright © 2026 Wavecase contributors. Licensed under [GNU AGPL version 3 only](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md). All committed content is in English.
