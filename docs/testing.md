# Development and testing

## Local development

Use Node.js 24, PostgreSQL 17, and FFmpeg/ffprobe on `PATH`. Create a disposable development database and export these values in **both** web and worker terminals:

```sh
export DATABASE_URL='postgres://wavecase:development-password@127.0.0.1:5432/wavecase_dev'
export APP_URL='http://localhost:5173'
export DATA_DIR="$PWD/data/dev-audio"
```

Replace the example credentials with your local database credentials. The supplied Compose database is not exposed to the host; use an accessible local database or run the whole app [in Docker](../README.md#run-with-docker). The Compose `.env` is not a substitute for exporting the environment to standalone scripts.

```sh
npm ci
npm run db:migrate
npm run dev
```

In the second terminal, run `npm run worker`. Open [localhost:5173](http://localhost:5173); keep `APP_URL` aligned with the exact origin if the dev-server port changes. For a local production build, run `npm run build`, then use `APP_URL=http://localhost:3000 npm start` and set the worker's origin accordingly. The production server applies proxy/header/rate-limit handling that Vite development does not.

After schema changes, run `npm run db:generate`, review the generated SQL, and commit migrations with the schema. Keep exact dependency pins and `package-lock.json` together; regenerate [third-party notices](../THIRD_PARTY_NOTICES.md) with `npm run notices` after dependency changes.

## Automated checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's test runner through `tsx`, including real FFmpeg fixtures. Database cases run only when `DATABASE_URL` ends **exactly** in `/wavecase_test`; otherwise they are skipped. Use a disposable database: tests change setup state, create accounts, and exercise migrations. Never point them at an installation's database or run concurrent suites against the same test database. Temporary test media is cleaned up by the tests.

For local integration tests, create `wavecase_test`, export its connection URL, apply migrations, and run `npm test`. Alternatively, in a disposable checkout with Compose configured:

```sh
docker compose up -d --wait db
docker compose exec db createdb -U wavecase wavecase_test
docker compose build web
docker compose run --rm --no-deps web sh -ec 'export DATABASE_URL="${DATABASE_URL%/wavecase}/wavecase_test"; npm run lint; npm run typecheck; npm run db:migrate; npm test'
```

Create the database only once. Building the image also checks the production build. The URL substitution assumes the supplied Compose database name, `wavecase`. Use a separate checkout and Compose project from a running installation; set `COMPOSE_PROJECT_NAME=wavecase-check` for these commands if checkout names collide. [CI](../.github/workflows/ci.yml) uses its own PostgreSQL service and runs the complete suite.

| Coverage | Tests |
| --- | --- |
| Passkeys, setup races, invitations, access boundaries, and regression cases | `auth`, `access`, `review-regressions` |
| Demo masters, dither, exact duration, invalid input, ZIP/email permissions, and worker replacement | `audio-policy`, `audio`, `downloads`, `worker` |
| Playback counts, intervals, retries, normalization, gestures, and media sessions | `activity`, `listening`, `playback-events`, `telemetry`, `playback-audio`, `waveform-gestures`, `media-session` |
| Release processing/publication/ZIPs, shared playback, credits, artist links, and previews | `releases`, `release-playback`, `release-artists`, `release-services`, `songwriters`, `track-artist`, `share-preview` |

These are files under `tests/` ending in `.test.ts`. There is no checked-in browser automation suite. For code changes, run relevant automated checks and browser journeys; documentation-only changes need command/link verification and the normal PR checks. Record results in the PR, without adding dated test-count logs to these guides.

## Browser acceptance

Use synthetic media and disposable accounts. Test listeners in a separate/private browser so the owner's session does not suppress analytics. Choose the journeys affected by the change:

1. **Accounts:** first setup, sign-out/in, second passkey, invitation use/reuse/expiry/revocation, a second account's private library, disablement, and recovery. Exercise native enrollment and recovery on the devices you intend to use.
2. **Demo lifecycle:** upload high-resolution WAV, lower-resolution/lossy audio, and CAF; check inferred labels, status, measurements, publication, and failure messages. Switch versions with distinct settings, including unsaved edits. A commented version rejects unequal-duration replacement while keeping its current audio; equal-duration replacement retains threads, order, and analytics. Remove/restore audio and request reupload.
3. **Private links and feedback:** create two named links with different visibility/download permissions. An onward link must not expose older audio when its newest version is missing. Check neutral inactive pages, protected direct requests, link-scoped point/range/general threads, replies, deletion ownership/placeholders, unread markers, owner filters, and timestamp seeking.
4. **Demo player:** play/pause/repeat, position preservation across versions, wheel zoom/pan, right-button selection in both directions, keyboard seeking/zoom/comment creation, and Space outside editing/dialogs. Modal submission, Escape, focus trapping/restoration, and native dialog-button Space must work. Compare loud, quiet, and transient-heavy files: normalization targets -16 LUFS within peak headroom without changing measurements or downloads.
5. **Demo downloads and analytics:** test WAV/MP3 and legacy ZIPs, Unicode names, artwork, metadata, and the fixed pre-release warning even for finished demos. Require listener email; exempt the authenticated owner. Reopening clears email. Verify direct/invalid/revoked requests fail, including revocation during MP3 preparation. Check email/format/link/version attribution and clearing analytics; name attribution, visits, repeat counts, timelines, and coverage must remain distinct.
6. **Release publishing:** create multiple artists and a multi-track draft with artwork, credits, service links, and only some masters. Confirm private preview, publication without audio, partial-audio disclosure, unchanged master ZIP bytes, all/individual packages, required email even for owners, coupled playback/download permissions, failed replacement, unpublish/republish, and owner-only statistics. Check artist links/renames on demos and songwriter listings across published releases.
7. **Continuous release playback:** start mid-release, navigate through artist/songwriter/other-release pages and back/forward, and return using the mini player. Keep one audio element and the original queue. Check both control surfaces, pause/resume, rapid selection, automatic progression, final metadata, queue replay, track-specific artist/gain, play counts, and errors/revoked availability. Space toggles once per press across public pages, including button/slider focus; typing, dialogs, modifiers, and Enter retain normal behavior. Reload starts empty; leaving for management or demos stops playback. Downloads still work after navigation.
8. **Operations:** restart containers and verify metadata/files persist; restart the worker with pending uploads. Exercise backup and restore on a disposable installation.

On a physical iPhone with HTTPS and the configured `APP_URL`, check uploads, actual audio, repeat pinch/pan/hold gestures, narrow layouts, downloads, background playback, interruptions, automatic release progression, and lock-screen resume. Verify title/artist/artwork updates, a demo without artwork, release cover replacement, and metadata cleanup after errors or leaving the player. Public navigation keeps the media session; private covers still require authorization. Browser automation cannot replace these device checks.
