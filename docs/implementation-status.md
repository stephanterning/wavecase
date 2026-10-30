# Implementation status

The first implementation is local. Nothing may be pushed until the owner has tested and approved it. This is not yet a production release or a claim that every browser/device combination has been verified.

The October 30 review findings have been addressed. See [the review, resolutions, and verification limits](implementation-review.md). The implementation is ready for the owner’s acceptance testing; native device behavior and the complete personal workflow still need that testing.

## Implemented foundations

- React Router framework application, React Compiler, strict TypeScript, PostgreSQL/Drizzle migrations, and Docker web/worker/database services with host-mounted persistence.
- Passkey-only first setup and sign-in, open/invited registration, single-use invitations, multiple passkeys, account disabling, administrator-assisted recovery, and server administrator recovery.
- Private libraries, search/sorting, track metadata/covers, filename suggestions, version descriptions/status, upload, original downloads, and protected range delivery.
- Version-aware share links with independent download permissions, visibility anchors, editing, deactivation, and missing-audio fallback.
- Link/version-scoped threads and replies, deletion ownership, modal timestamp/range/general feedback and replies, owner version/link filters, timestamp navigation, and browser-local unread indications.
- Waveform, zoom, range selection, preserved playback position/state, custom play/pause/time/repeat controls, Space shortcut, wheel/pinch zoom, bidirectional comment selection, and Media Session handlers.
- Audio conversion and measurements, exact decoded-duration replacement checks, atomic publication, removal/restoration, and reupload requests.
- Link-level visits, playback events, browser/name attribution including earlier activity, session timelines, listening time, unique coverage, heatmaps, download details, visitor context, optional local geolocation, referral websites, link/browser filters, and statistics deletion.
- Request-origin enforcement, bounded upload/body sizes, private media cache revalidation, authentication/feedback rate limits, durable jobs, pending-upload reconciliation, and container health dependencies.

## Verification

Lint and React Compiler rules, TypeScript, the production build, and the database integration suite pass. Tests include real signed WebAuthn responses, setup closure, invitation consumption, cross-owner and cross-link access, download gating, range responses, revoked-link cache checks, audio conversion, playback counting, coverage, and worker replacement without loss of the valid file.

All 20 tests pass against the isolated database, including concurrent setup, open-registration invitations, link creation boundaries, delayed telemetry and idempotent retries. The worker test also restarts the worker with queued replacement work.

An isolated browser walkthrough verified version settings, feedback filters/replies, timestamp comments, name association, actual playback and version switching, repeat, CAF upload/publication, reupload requests, and desktop/narrow analytics layouts. Native passkey prompts/recovery, actual sound quality, iPhone uploads, background playback, lock-screen controls, and the owner’s complete workflow still require acceptance testing. Follow [the testing guide](testing.md).

## Operational boundaries

- Location data requires an operator-provided MMDB database. No external geolocation service is contacted.
- Read markers and listener names live in browser storage. Clearing storage loses those local preferences and listener deletion credentials.
- Download records describe initiated transfers, not verified receipt of an entire file.
- Temporary telemetry failures retry while the page is alive, with deduplicated event IDs. Browser termination can lose unacknowledged listening events. Playback telemetry is observational and cannot prove a human heard the audio.
- There are no known production dependency advisories in the checked npm audit. The development dependency tree reports moderate advisories associated with Drizzle Kit's transitive tooling; do not expose development servers publicly.
- Filesystem cleanup failures can leave unreferenced files on disk; public access always depends on database ownership and current link policy. Do not manually delete files from an active installation.

## Player interaction update

The player now uses custom play/pause, elapsed/total time, and a repeat icon with tooltips. Download is a separate icon. The 220-pixel waveform supports wheel zoom, touch pinch, panning, right-button point/range comments and touch hold/drag selection. Space toggles playback except in editable controls. Comment creation and replies use a native modal dialog with focus restoration; general comments have no timing fields and waveform comments retain their selected timing and version. The restart button, native media controls, inline composers and zoom slider have been removed.

The page uses a black background, darker panels/buttons, brighter text/borders, a compact version selector and responsive full-width spacing. Desktop browser checks verified Space from the page and another focused button, preserved typing spaces, general-comment submission, point-comment timing, reply submission, Escape/focus restoration, repeat state and wheel zoom. The final modal focus and 390-pixel layout were also checked. Gesture tests cover left/right ranges, zoomed coordinates, touch hold, pinch cancellation and pointer cancellation. Physical iPhone pinch/long-press behavior remains a device acceptance check.
