# Implementation status

The first implementation is local. Nothing may be pushed until the owner has tested and approved it. This is not yet a production release or a claim that every browser/device combination has been verified.

The October 30 review findings have been addressed. See [the review, resolutions, and verification limits](implementation-review.md). The implementation is ready for the owner’s acceptance testing; native device behavior and the complete personal workflow still need that testing.

## Implemented foundations

- React Router framework application, React Compiler, strict TypeScript, PostgreSQL/Drizzle migrations, and Docker web/worker/database services with host-mounted persistence.
- Passkey-only first setup and sign-in, open/invited registration, single-use invitations, multiple passkeys, account disabling, administrator-assisted recovery, and server administrator recovery.
- Private libraries, search/sorting, track metadata/covers, filename suggestions, version descriptions/status, upload, WAV/320 kbps MP3 downloads for newly processed audio, legacy original downloads, and protected range delivery.
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


New audio uses a single playback/download master capped independently at 24 bit and 48 kHz, with triangular dithering for bit-depth reduction above 24. Lossless sources offer WAV (default) and lazily cached LAME 320 kbps MP3; lossy sources offer MP3 only. Existing published files are unchanged. Source-duration metadata is retained for replacement checks. File replacement/removal also cleans cached exports.

## Public artists and releases

The Releases workspace is available from the library at `/releases`. It supports multiple owned artist profiles, public artist pages, single/EP/album drafts, manual publication and unpublishing, independently uploaded artwork and masters, editable metadata/credits, and streaming/shop links. Public addresses use `/artists/<artist>/<release>`; slugs are chosen at creation and stay stable when names or titles change. Explicit address changes and redirects are not implemented in this initial version.

Release audio uses its own durable job queue with pending-upload reconciliation. PCM WAV masters remain byte-for-byte unchanged; mono/stereo AAC listening copies target 256 kbit/s. Existing ready audio remains available while a replacement processes, and failed replacements retain it. One release setting enables/disables playback and downloads together. Releases may have no audio or only a subset of their tracks available.

Downloads stream ZIP packages containing the selected original masters, PNG artwork and `release-info.txt`. The package contents and partial track coverage are shown before download. A syntactically valid email address starts the download without verification or account creation. Addresses and package contents are recorded for the owner; there is no mailing-list subscription or export. Each download submission requires an address; it is not stored in browser storage. Download records remain until database retention/deletion tooling is added; no automatic retention period is imposed.

Release statistics cover page visits, per-track plays, external-link clicks, and download requests. Authenticated owner page visits and playback are excluded. A browser play starts with actual playback, pause/resume does not increment it, and a replay after the track ends counts again. Event IDs deduplicate repeated event submissions. Release telemetry is best-effort and can be lost if a request fails; it does not reuse the feedback feature's detailed interval/session collection. The current view counts release-page visits, not artist-page visits.

Release pages have an artwork-derived background, a custom full-track player, responsive track lists, metadata/credits, search metadata, structured music data and sharing previews. Artist profiles support a biography, image, links and public releases ordered by release date. Required publishing fields are a title, artist, artwork and at least one track; the other metadata fields are optional. Uploaded artwork is normalized to PNG at up to 2000 pixels per side for page display and ZIP inclusion. Uploaded WAV files are never rewritten.

Verification for the release implementation: all 26 tests passed against an isolated PostgreSQL database, with no database scenarios skipped. Type checking, lint (including React Compiler rules), the production build and dependency-notice generation passed. A Chromium walkthrough against the built app and its real worker verified artist/release creation, two-track partial audio, artwork upload, AAC processing, manual publishing, actual playback, native email-gated ZIP download, owner analytics, artist listing, failed replacement preserving the previous master, coupled audio disabling and unpublishing. Desktop and 390-pixel screenshots were inspected with no horizontal overflow. Native download testing caught and fixed a referrer-policy interaction: release pages use `same-origin` so native POST downloads pass origin validation while external links retain `noreferrer`.

## Demo artist profile links

Work-in-progress tracks now have an optional artist-profile reference. Creation and metadata editing offer owned profiles plus free text; unique names match automatically within the owner's account, ignoring case and surrounding whitespace. Ambiguous names remain plain text until a profile is explicitly selected. Migration `0007` applies the same unique-match rule to existing unlinked demos. A linked demo displays the profile's current name and stable public URL after renames. The artist page does not list demos, and private/share-link permissions remain unchanged. Artist choices are returned only to the owner.

Verification: all 28 tests passed against the isolated database, including the new artist-link and backfill scenarios and server-rendered demo link markup. Type checking, lint and the production build passed. The migration has only been applied to the disposable test database, not a live installation.

## Readable download package names

Release ZIPs now contain a directory named `Artist - Release title`; individual-track ZIPs and directories use `Artist - Track title`. WAV entries use `NN - Artist - Track title.wav`, preserving release track numbers and using a track-specific artist when supplied. Artwork and credits are inside the same directory. Unicode filenames are preserved through ZIP entries and the HTTP download header; unsafe filesystem characters are replaced and component lengths are bounded. All 29 tests, type checking, lint and the production build pass, including extracted package paths, Swedish names, artist fallback, partial-release numbering and unchanged original WAV bytes.

PR 3 review: merged the public-release and share-preview changes from main, rejected damaged/unsafe floating-point conversions before publication, and kept native Space behavior inside modal dialogs. All 46 tests pass with the isolated database, including release preservation and permission revocation during an in-flight download.
