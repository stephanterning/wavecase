# Development and testing

## Local development

Use Node.js 24 (`nvm use` or `fnm use` reads `.nvmrc`), PostgreSQL 17, and FFmpeg/ffprobe on `PATH`. The supplied Compose database is not exposed to the host. Without a local PostgreSQL 17, start a disposable one with development and test databases:

```sh
docker run -d --name wavecase-dev-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=wavecase -e POSTGRES_PASSWORD=development-password \
  -e POSTGRES_DB=wavecase_dev postgres:17
until docker exec wavecase-dev-db pg_isready -q -h 127.0.0.1 -U wavecase; do sleep 1; done
docker exec wavecase-dev-db createdb -U wavecase wavecase_test
```

Remove it with `docker rm -f wavecase-dev-db`. Export the connection URL in **both** web and worker terminals; the Compose `.env` is not read by these scripts:

```sh
export DATABASE_URL='postgres://wavecase:development-password@127.0.0.1:5432/wavecase_dev'
npm ci
npm run db:migrate
npm run dev
```

In the second terminal, run `npm run worker`. Open [localhost:5173](http://localhost:5173), the origin `APP_URL` defaults to; set `APP_URL` in both terminals if the dev-server port changes. Media is stored in the ignored `data/audio`; set `DATA_DIR` to keep it apart from a Compose installation in the same checkout. For a local production build, run `npm run build`, then use `APP_URL=http://localhost:3000 npm start` and set the worker's origin accordingly. The production server applies proxy/header/rate-limit handling that Vite development does not.

After schema changes, run `npm run db:generate`, review the generated SQL, and commit migrations with the schema. Keep exact dependency pins and `package-lock.json` together; regenerate [third-party notices](../THIRD_PARTY_NOTICES.md) with `npm run notices` after dependency changes.

## Automated checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's test runner through `tsx`, including real FFmpeg fixtures. Database cases run only when `DATABASE_URL` ends **exactly** in `/wavecase_test`; otherwise they are skipped, except when `CI` is set, where the run fails instead. Use a disposable database: tests change setup state, create accounts, and exercise migrations. Never point them at an installation's database or run concurrent suites against the same test database. Temporary test media is cleaned up by the tests.

For local integration tests against the database above:

```sh
DATABASE_URL="${DATABASE_URL%/wavecase_dev}/wavecase_test" sh -c 'npm run db:migrate && npm test'
```

Alternatively, in a disposable checkout with Compose configured:

```sh
docker compose up -d --wait db
docker compose exec db createdb -U wavecase wavecase_test
docker compose build web
docker compose run --rm --no-deps web sh -ec 'export DATABASE_URL="${DATABASE_URL%/wavecase}/wavecase_test"; npm run lint; npm run typecheck; npm run db:migrate; npm test'
```

Create the database only once. Building the image also checks the production build. The URL substitution assumes the supplied Compose database name, `wavecase`. Use a separate checkout and Compose project from a running installation; set `COMPOSE_PROJECT_NAME=wavecase-check` for these commands if checkout names collide. [CI](../.github/workflows/ci.yml) uses its own PostgreSQL service and runs the complete suite. It also checks formatting and fails when `app/server/schema.ts` has changes without a generated migration or when `THIRD_PARTY_NOTICES.md` is out of date.

CI also runs `python3 -B -m unittest discover -s tests -p 'test_local_preview.py'`, which covers the reset safeguards in `scripts/local-test-data.py` ([local preview](local-preview.md)). Run it after changing that script.

| Coverage | Tests |
| --- | --- |
| Passkeys, setup races, invitations, access boundaries, and regression cases | `auth`, `access`, `shared-artists`, `review-regressions` |
| Demo masters, dither, exact duration, invalid input, ZIP/email permissions, and worker replacement | `audio-policy`, `audio`, `audio-exports`, `downloads`, `worker` |
| Scoped demo editing, permanent track/version/link deletion, file cleanup, and aggregate exclusion | `demo-management`, `delete-version`, `share-links`, `library` |
| Playback counts, intervals, retries, normalization, prepared version changes, gestures, and media sessions | `activity`, `listening`, `playback-events`, `telemetry`, `audio-context`, `playback-audio`, `buffered-audio`, `stream-transport`, `audio-stream`, `demo-playback`, `workspace-playback`, `waveform-gestures`, `media-session` |
| Release processing/publication/ZIPs, shared playback, credits, artist links, and previews | `releases`, `release-playback`, `release-artists`, `release-services`, `songwriters`, `track-artist`, `share-preview`, `preview` |

These are files under `tests/` ending in `.test.ts`. There is no checked-in browser automation suite. For code changes, run relevant automated checks and browser journeys; documentation-only changes need command/link verification and the normal PR checks. Record results in the PR, without adding dated test-count logs to these guides.

## Browser acceptance

Use synthetic media and disposable accounts. Test listeners in a separate/private browser so the owner's session does not suppress analytics. Choose the journeys affected by the change:

1. **Accounts:** first setup, sign-out/in, second passkey, invitation use/reuse/expiry/revocation, a second account's private library, disablement, and recovery. Exercise native enrollment and recovery on the devices you intend to use.
2. **Demo lifecycle:** upload high-resolution WAV, lower-resolution/lossy audio, and CAF; check inferred labels, status, measurements, publication, and failure messages. Switch versions with distinct settings, including unsaved edits. A commented version rejects unequal-duration replacement while keeping its current audio; equal-duration replacement retains threads, order, and analytics. Remove/restore audio and request reupload. Delete a version through Edit version with exact-name confirmation; check file-name display, audio/feedback/statistics cleanup, selection fallback, and retention of the track, cover, links and other versions. Delete onward/pinned link targets and edit those links: earlier or different versions must stay hidden, including after new uploads. Deleting the last version leaves a usable upload action. Check cancellation, validation errors, and keyboard focus in the deletion dialog.
3. **Private links and feedback:** create two named links with different visibility/download permissions. An onward link must not expose older audio when its newest version is missing. Create and edit a specific-version link, publish a newer version, and verify that only the selected version remains accessible through the page, preview, audio, downloads, and feedback. Removing/restoring its audio must preserve that restriction. Check neutral inactive pages, protected direct requests, link-scoped point/range/general threads, replies, deletion ownership/placeholders, unread markers, owner filters, and timestamp seeking.
4. **Demo player:** play/pause/repeat, position preservation across versions, wheel zoom/pan, right-button selection in both directions, keyboard seeking/zoom/comment creation, and Space outside editing/dialogs. Modal submission, Escape, focus trapping/restoration, and native dialog-button Space must work. Compare loud, quiet, and transient-heavy files: normalization targets -16 LUFS within peak headroom without changing measurements or downloads.
5. **Demo downloads and analytics:** test WAV/FLAC/MP3/original and legacy stored-master ZIPs, Unicode names, artwork, metadata, and the fixed pre-release warning even for finished demos. Require listener email; exempt the authenticated owner. Reopening clears email. Verify direct/invalid/revoked requests fail, including revocation during MP3 preparation. Check email/format/link/version attribution and clearing analytics; name attribution, visits, repeat counts, timelines, and coverage must remain distinct.
6. **Release publishing:** create multiple artists and a multi-track draft with artwork, credits, service links, and only some masters. Confirm private preview, publication without audio, partial-audio disclosure, unchanged original ZIP bytes, dithered 16-bit/44.1-kHz WAV/FLAC exports, shared MP3 playback/downloads, background AAC migration, all/individual packages, required email even for owners, coupled playback/download permissions, failed replacement, unpublish/republish, and owner-only statistics. Check artist links/renames on demos and songwriter listings across published releases.
7. **Continuous release playback:** start mid-release, navigate through artist/songwriter/other-release pages and back/forward, and return using the mini player. Keep one audio element and the original queue. Check both control surfaces, pause/resume, rapid selection, automatic progression, final metadata, queue replay, track-specific artist/gain, play counts, and errors/revoked availability. Drag the position slider through unbuffered positions: the preview follows the handle without seeking or requesting intermediate audio; release commits once, including outside the slider, and cancel discards it. Normal buffering at the audible position continues. Verify click/tap, keyboard and assistive changes, and a track change during a drag. Space toggles once per press across public pages, including button/slider focus; typing, dialogs, modifiers, and Enter retain normal behavior. Reload starts empty; leaving for management or demos stops playback. Downloads still work after navigation.
8. **Operations:** restart containers and verify metadata/files persist; restart the worker with pending uploads. Exercise backup and restore on a disposable installation.

9. **Management and listener previews:** edit several sections, save one without losing the others, and exercise unsaved navigation/version warnings. Check Save and preview, Preview saved version, invalid fields, new-tab focus, and saved feedback. Filter releases, create one from an artist, and verify stable address suggestions and link rows. Follow artist/release/songwriter links in preview; no owner controls or return buttons should appear. Demo preview follows its active share permissions. Comments, reupload requests, downloads, and analytics must not be submitted in preview; draft releases remain private. Confirm draft deletion and refusal to delete a published release.

10. **Shared artists:** create and copy an invitation link, open it while signed out, sign in and confirm the artist and account name/email, switch accounts, cancel, and exercise single-use/expiry/revocation and concurrent acceptance, and check that both accounts see existing and new material only for their shared artist. Exercise uploads, releases, links, internal and external replies, and statistics. Verify internal discussions never appear through external links. Move a demo between artists or unlink it with confirmation; verify access follows the destination while versions, links and discussions remain. Remove a member or leave; uploads stay and private access is revoked.

On a physical iPhone with HTTPS and the configured `APP_URL`, check uploads, actual audio, repeat pinch/pan/hold gestures, narrow layouts, downloads, background playback, interruptions, automatic release progression, and lock-screen resume. Verify title/artist/artwork updates, a demo without artwork, release cover replacement, and metadata cleanup after errors or leaving the player. Public navigation keeps the media session; private covers still require authorization. Browser automation cannot replace these device checks.

For lock-screen controls, confirm elapsed/remaining time and progress advance while playing, freeze while paused or buffering, restart at each repeat, and follow seeking from either control surface. The real audio element supplies the native timeline; Wavecase must not override position/playback state or temporarily remove seeking commands. Repeat stays on across demos, releases and reloads in the same tab. Demo backward/forward seek ten seconds unless the platform supplies another interval; demos do not advertise track navigation. Drag the lock-screen timeline while playing and paused, after pause/resume, after a seek, and after returning to the active player. Release Previous restarts after three seconds or selects the preceding queued track near the start; Next is unavailable at the queue end. Check title/duration changes, play counts, and seeking into the final track after the queue ends. Errors, revocation and player exit clear custom metadata. Compare with the plain native audio baseline on the same iPhone. `media-session` tests cover direct commands, metadata cleanup, partial support and the absence of timeline/state overrides; only physical iPhone testing establishes lock-screen behavior.

Playback is HLS through an ordinary audio element: native in Safari on macOS, iPhone and iPad, and hls.js elsewhere. With built-in speakers and AirPods, verify audible pause and forward/backward seeks, repeat, source changes, playback across navigation, several minutes locked or in a background tab, phone-call/Siri interruption and resume, and route changes. Confirm that the lock screen shows Play within a moment of pausing or reaching the end, then resumes from the lock screen. Pause, switch between other apps, navigate within Wavecase, then resume; confirm that audio starts and Loading audio clears. Repeat after the track ends. If audio startup cannot complete, verify that the player offers retry rather than waiting indefinitely.

For playback transitions, use Safari on a physical iPhone with AirPods Pro and compare the built-in speaker. Repeat a continuous loop fixture and representative music, distinguishing stored silence from the short gap HLS repeat may add. Seek forward and backward, including rapid seeks and lock-screen controls, and check that the old position is not audible behind the updated cursor. Change demo versions while playing, paused, and loading; include shorter versions, feedback timestamp jumps, errors, cancellation, and revocation. The old version must remain audible until the new one plays within about 250 ms of its position; the switch is a direct cut. Return to the previous version and confirm it resumes without reloading. Select a version while paused on iPhone and confirm Loading audio clears at once and Play starts at the expected position. Verify the selected waveform and comment context after the switch. Repeat one release track, disable repeat, and confirm queue progression and analytics; let the queue advance while the phone is locked. Measure first audible output, cold version switches and A/B return switches separately. Test six-minute tracks with slow/failed transfers, mono/stereo files and 44.1/48 kHz sources. Leave the phone locked for several minutes so successful playback requires fresh background transfers, not just existing buffered audio. Record transferred bytes as well as latency. Browser readiness events do not establish perceptually seamless output on every device; record the physical listening result separately.

For private workspace playback, start the latest playable version from the library without navigating; include a newer processing/missing version and a track with no audio. Navigate through the library, another demo, activity and management pages while the original keeps playing. Return to its current version without resetting time, repeat or the prepared buffers. Start the other demo explicitly and verify only one audible source remains. Check bottom-player and detail controls, Space once per press, feedback seeks, unsaved-edit navigation guards, browser back/forward, mobile row-button hit areas and bottom safe-area spacing. Replacing/deleting active audio or a track must stop stale audio when its availability is learned. Logout and leaving the workspace must stop audio and clear media-session metadata. Share listeners and public release playback retain their own scopes; owner playback must not create listener analytics.

On artist management, check the shared Work in progress list below Releases: only profile-linked demos appear, including finished demos and co-owner uploads. Check search, column sorting, detail links, disabled playback without audio, and latest-playable selection beneath a newer unavailable upload. Start playback from both list locations and navigate between artists, the library and demo details without interruption. Renaming the artist updates list and player names. Free-text-only matches stay unlisted; outsiders and unrelated administrators cannot read the private list, and public artist pages never expose it.


For caching, use the browser's network inspector on a production build (`npm start`; the Vite development server does not apply production headers). Playlists, initialization files and segments under `/hls/` must carry only `public, max-age=31536000, immutable`; resolution redirects from `/media` and `/release-assets` stay `private, no-store`. A repeat, an A/B return and a backward seek should be served from cache rather than transferring segments again.

For the shared demo list, check column order, numeric version counts, sorting in both directions, full-timestamp Updated/Created ordering, empty demos, and horizontal scrolling on mobile in both Work in progress and artist management. Toggle hearts with pointer and keyboard, reload, and verify personal favorites stay independent for co-owners without opening the row. Check playback from the Name cell and uninterrupted navigation. Successful new uploads, replacements, and restorations update Updated; failed uploads, metadata, feedback, and audio removal do not.

## HLS stage trial

HLS is evaluated as the only playback transport. Reload stage fully after deployment; tabs opened before it cannot play until reloaded. Existing audio is backfilled by the worker, which also deletes the previous transport's prepared parts once per start; no re-upload is required once preparation finishes. New uploads prepare FLAC/AAC before publication.

On the owner's iPhone, test a demo and a release: start, pause, switch apps several times, navigate inside Wavecase, resume, then leave it locked for several minutes. Drag the lock-screen timeline forward and backward while playing and paused, including directly after a lock-screen seek, and check that demo backward/forward controls seek ten seconds. Compare repeat boundaries, waveform/lock-screen seeking, version A/B changes, AirPods versus speakers, interruptions and automatic release progression. Record audible gaps/delay separately; native HLS is not assumed sample-accurate or gapless.

`hls` tests encode real FLAC/AAC fMP4, compare every FLAC sample with constant-gain source audio across segment boundaries, check encoded levels, unchanged originals, immutable VOD publication, range/HEAD requests, capability cleanup and failed preparation. `playback-audio` verifies native HLS only in Apple browsers, hls.js elsewhere when MSE exists, version switching, deferred paused start positions and bounded startup. `demo-playback` covers bounded version alignment and reuse of the previous version. Full integration tests must use the isolated `wavecase_test` database. Physical iPhone results remain owner acceptance.

HLS URLs intentionally remain usable without an account once learned, including after share-link revocation. Source deletion removes their files; HTTP caches can retain delivered bytes. Verify that guessing a track/version ID does not reveal a capability and that the static route cannot reach originals, sidecars or arbitrary files. A hard worker kill during encoding can leave an unreferenced hidden temporary HLS directory; this prototype does not yet garbage-collect crash debris.
