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

For lock-screen controls, verify title/artist/artwork and play/pause on the physical iPhone. The worklet player should have no reported elapsed time or progress timeline and no seek commands. Release Previous restarts after three seconds or goes to the preceding queued track near the start; Next is unavailable at the queue end; demos show no track navigation. Check pause/resume after app switches, lock/unlock, track changes, repeat boundaries, production/stage navigation, interruptions and reaching the queue end. In-app waveform and slider seeking, repeat and automatic release progression must continue to work with the production worklet engine. Confirm that a previous player's timeline is cleared and errors, revocation and player exit clear metadata/handlers. `media-session` tests cover metadata, play/pause, queue navigation, position clearing and the absence of time reports and seeking actions. iOS controls the actual layout; native fallback elements may still expose a browser-owned timeline.

On macOS Safari, verify the shared media-stream output with built-in speakers: audible pause and forward/backward seeks, repeat, source changes, playback across navigation, several minutes in a background tab, and interruption/resume. Normalization remains upstream of this output. Mobile Safari (including iPad desktop identity) and other browsers retain the direct Web Audio destination. Check their existing playback journeys too.

When investigating delayed controls, measure the command-to-worklet response separately from acoustic output. Compare an identical tone pulse through Web Audio and ordinary HTML audio using the same microphone and threshold; this gives a relative output delay while both round-trip measurements include capture latency. Do not treat `outputLatency`, `getOutputTimestamp()` or a worklet acknowledgment as proof of audible responsiveness. Microphone capture can change the audio session; record that change, use a separate capture tab when playback requires the `playback` category, and stop all microphone tracks after testing.

For playback transitions, use Safari on a physical iPhone with AirPods Pro and compare the built-in speaker. Test segmented repeat with a continuous loop fixture and representative WAV/MP3 music; distinguish stored silence from an added gap. Seek forward/backward inside and outside the prepared window, including rapid seeks and lock-screen controls. Check that the old position is not audible behind the updated cursor. Change demo versions while playing, paused, and loading; include shorter versions, feedback timestamp jumps, errors, cancellation, and revocation. The old version must remain audible until a prepared switch, with no more than 5 ms of crossfade. Verify the selected waveform and comment context after the switch. Repeat one release track, disable repeat, and confirm queue progression and analytics. Measure first audible output, cold version switches and prepared A/B return switches separately. Test six-minute tracks with slow/failed transfers, rapid cancellation, mono/stereo files and 44.1/48 kHz sources. Validate sample continuity at every two-second boundary and that the cache stays bounded after long play and repeated seeks. Leave the phone locked for several minutes so successful playback requires fresh background transfers, not just existing buffered audio. Check interruptions and lock-screen resume on iOS 27. Record transferred bytes and additional storage as well as latency; compare FLAC demo transfer and storage with the previous PCM transport. For integer PCM demo masters, verify native samples across window boundaries, resampled FLAC seeks, A/B return and repeat. For other demo codecs, verify PCM fallback. For release MP3, verify random seeks and loop boundaries against uninterrupted decoding at 32/44.1/48 kHz, including mono and partial final parts. The compressed windows overlap to restore decoder history. Unsupported browsers must retain the indicated native streaming fallback. Signal measurements and browser readiness events do not establish perceptually seamless output on every device; record the physical listening result separately.

For private workspace playback, start the latest playable version from the library without navigating; include a newer processing/missing version and a track with no audio. Navigate through the library, another demo, activity and management pages while the original keeps playing. Return to its current version without resetting time, repeat or the prepared buffers. Start the other demo explicitly and verify only one audible source remains. Check bottom-player and detail controls, Space once per press, feedback seeks, unsaved-edit navigation guards, browser back/forward, mobile row-button hit areas and bottom safe-area spacing. Replacing/deleting active audio or a track must stop stale audio when its availability is learned. Logout and leaving the workspace must stop audio and clear media-session metadata. Share listeners and public release playback retain their own scopes; owner playback must not create listener analytics.

On artist management, check the shared Work in progress list below Releases: only profile-linked demos appear, including finished demos and co-owner uploads. Check search, column sorting, detail links, disabled playback without audio, and latest-playable selection beneath a newer unavailable upload. Start playback from both list locations and navigate between artists, the library and demo details without interruption. Renaming the artist updates list and player names. Free-text-only matches stay unlisted; outsiders and unrelated administrators cannot read the private list, and public artist pages never expose it.


For compressed caching, compare audio GET payloads on the first complete pass and a repeated pass. The repeated pass should reuse FLAC/MP3 bytes while HEAD requests still verify access and revision. Repeat the check across A/B/A and another track, and distinguish decoded-window hits from compressed-cache hits. Exercise revoked links, replaced sources, canceled transfers, source errors, logout and leaving the player scope. Verify that a shared 96 MB byte limit evicts least-recently-used parts across all transports and that PCM fallback is excluded. On a physical iPhone, check several six-minute versions and repeated loops for memory pressure, interruptions and unchanged audible transitions.

For the shared demo list, check column order, numeric version counts, sorting in both directions, full-timestamp Updated/Created ordering, empty demos, and horizontal scrolling on mobile in both Work in progress and artist management. Toggle hearts with pointer and keyboard, reload, and verify personal favorites stay independent for co-owners without opening the row. Check playback from the Name cell and uninterrupted navigation. Successful new uploads, replacements, and restorations update Updated; failed uploads, metadata, feedback, and audio removal do not.
