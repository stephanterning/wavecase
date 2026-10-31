# Wavecase product and technical specification

Wavecase is a self-hosted music sharing application with two separate workflows: private demos for version-specific feedback, and public releases for finished music. Uploaders use passkey accounts; listeners need no account. Independent installations support multiple owners and configurable audio limits, even though the initial personal installation serves one uploader and roughly ten listeners per month.

This is the product contract, reconciled with the implementation through PR #10 on October 31, 2026. It takes precedence over conflicting product guidance in parent directories. [Implementation status](implementation-status.md) records limitations; [testing](testing.md) covers verification and device acceptance. All committed content and interface text are English. The license is AGPL-3.0-only.

## Accounts and ownership

- The first completed setup creates the administrator and closes bootstrap registration, including concurrent attempts. Setup selects open or invitation-only registration; an administrator can change it later.
- Invitations are single-use, revocable, and expire after seven days. A supplied invitation is consumed only after successful account creation, even when registration is open.
- Accounts require a display name and unverified email. Passkeys are the only login method; accounts can hold multiple passkeys and cannot remove their last one.
- Administrators manage registration, invitations, account disablement, and recovery. This role grants no access to another owner's private music, comments, or analytics. Each demo and artist profile has one owner; there is no shared track administration.
- After verifying identity, an administrator may issue a single-use, 15-minute recovery link for a non-administrator. Successful recovery replaces old passkeys and sessions. Administrator recovery requires the server command described in [operations](operations.md#accounts-and-recovery). Neither flow sends email or introduces password login.

## Private demos

### Library and versions

The private library supports title search and sorting by title or newest track. A track has a required title, optional artist, cover, and shared description. Suggest title/version names from the upload filename. Versions have a user-defined name, description, upload timestamp, download permission, and one status: `early idea`, `work in progress`, `almost finished`, or `finished`.

Version order follows new-upload order, not labels, processing completion, or replacements. Successful processing publishes a new version automatically; existing links keep their previous playable audio while processing is pending. There is no demo draft/publish step.

The artist may be free text or an owned artist profile. Explicit selection checks ownership. Free text links automatically only when exactly one owned profile matches, ignoring case and surrounding whitespace; the migration applies the same rule without reassigning existing links. Ambiguous/unmatched names remain free text. Linked demos display the profile's current name and optional thumbnail, linking to its stable public page even without published releases. Renaming preserves the relationship. This never publishes or lists the demo on the artist page, and listeners do not receive the owner's profile choices.

### Audio policy

Accept mono/stereo audio from WAV, AIFF, FLAC, MP3, MP4/M4A/MOV, Matroska/WebM, Ogg, AAC, ASF/WMA, APE, WavPack, AU, and CAF, subject to the shipped FFmpeg decoders. Unsupported, invalid, or empty input must fail clearly. Keep channel metadata extensible; multichannel/Atmos playback is outside scope.

For new uploads and replacements:

- Cap the stored master at 24 bit and 48 kHz independently, without increasing a lower source bit depth or sample rate. Apply triangular dither when reducing above 24 bit; preserve mono/stereo without downmixing, trimming, compression, or loudness normalization during conversion.
- Recognized PCM/lossless sources, including FLAC, ALAC, and APE, use a PCM WAV master. Keep a suitable WAV unchanged; otherwise convert. This single master serves playback and WAV download.
- Preserve compatible lossy audio without re-encoding; other supported sources receive a compatible WAV playback master within the ceiling. Decoding lossy audio does not make it eligible for WAV download.
- Reject decoder failures and floating-point samples that are non-finite or exceed the PCM range. Validate and publish before deleting a superseded upload; failures must preserve the current valid audio.
- Generate waveform peaks and integrated LUFS, sample peak (dBFS), true peak (dBTP), loudness range, and duration from playback audio. Show these measurements on the demo page, without sample rate/bit depth.

All demo audio recognized as lossless/PCM offers WAV and MP3 download choices, defaulting to WAV; other sources offer MP3 only. MP3 uses LAME at constant 320 kbps, algorithm quality 2, prepared on first request and cached. Preserve 44.1/48 kHz for MP3; lower-rate sources export at 32 kHz for MPEG-1 compatibility. This export resampling does not improve source quality or alter the master. Concurrent requests share encoding; failures expose no partial export, and removal/replacement clears cached exports.

Previously published audio keeps its existing playback and original until replaced. It also offers WAV/MP3 choices, checking the original codec rather than the filename. PCM WAV originals remain byte-for-byte unchanged; other recognized lossless originals receive a cached WAV export within the 24-bit/48-kHz ceiling, with triangular dithering when reducing bit depth. Lossy originals cannot request WAV. Existing POST forms requesting a legacy original remain supported.

### Share links and downloads

A link belongs to one track and carries an owner-only label for a recipient or group. Possession grants access; it does not verify identity. Links support all versions or a fixed starting version and every later version. New links default to the latest published version and future versions; creating this policy before publication fails. Missing audio must never broaden that boundary. Labels, boundaries, download settings, and active state can change without changing the URL.

Open the newest visible playable version; if none are playable, retain metadata and feedback without playback. An inactive link shows neutral information and denies protected content, while retaining comments/statistics for the owner. Re-enabling restores access under current settings. Active share pages provide title/description/authorized-cover previews with `noindex`; previews do not bypass link checks.

Listener downloads require an active link, visible version, link and version download permission, available audio, an allowed format, and a syntactically valid email. Enforce all conditions on the server and recheck after export preparation. The authenticated demo owner bypasses listener download permission/email requirements and creates no listener download event. Unavailable versions show an inactive download control.

Download opens a modal and submits via POST, so addresses stay out of download URLs; old direct GET/HEAD download requests do not serve files. Playback GET/range/HEAD delivery remains separate. Every package contains:

- Selected WAV, MP3, or unchanged legacy original, using the readable `Artist - Title - Version` name (omit missing artist) and its format extension.
- `demo-info.txt` and, when available, `artwork.jpg`, inside a directory with the same name as the ZIP.
- The fixed warning `Pre-release version. Do not share.`, also shown in the modal, including for `finished` demos. The info file includes current artist, title, version, status, upload timestamp, format, and descriptions.

Preserve Unicode and sanitize unsafe filename characters. Do not add recipient addresses, private share URLs, or owner account details to package metadata. Explain that email is shared with the owner and stored with the download request. Require each listener request to submit it; do not verify mailboxes, send messages, subscribe addresses, or save email in browser storage. Only the owner sees download addresses with format, version, link, time, and visitor context. Clearing track analytics deletes them; there is no separate address list or automatic expiry.

### Feedback

Threads belong to exactly one version and one link. Listeners see only their link's visible versions and conversations. Threads can concern a timestamp, range, or whole version and allow repeated replies. Owner feedback defaults to the selected version across links, with independent version/link filters. Replies retain the original thread's context; timestamp navigation selects that version and seeks. Missing audio disables seeking, not reading or replying.

Listeners choose an unverified display name, reused from browser local storage. A separate browser-held secret grants deletion rights; matching names or analytics IDs never do. Losing the secret does not recover ownership in another browser. The track owner may moderate any comment on that track; administrator status alone is insufficient. Deleting a comment with later replies leaves `deleted`; a final comment or unanswered opening disappears. Comment editing and resolved states are outside scope.

Unread indications are remembered per browser. Revisit the page to see replies; web push is deferred.

### Playback and interaction

All demo and release playback targets -16 LUFS integrated through constant player gain. Attenuate loud audio; boost quiet audio only within both 0 dBFS sample and 0 dBTP true-peak ceilings, reserving 0.01 dB true-peak headroom for rounding. Missing peak measurements, silence, or below-gate loudness must not produce a boost. Apply no limiting/compression. Stored audio, downloads, waveform data, and displayed measurements stay unchanged. Any future volume control attenuates the normalized signal.

Demo controls are play/pause, elapsed/total time, repeat with tooltip, and a separate download icon. There are no native audio controls, restart/volume buttons, zoom slider, or range-loop mode. Space toggles playback outside editable fields, selects, dialogs, and modified shortcuts. Version switching preserves position when it fits the destination duration (otherwise starts at zero) and preserves play/pause state. Reuse opened media where practical; this is not offline playback.

The 220-pixel waveform may normalize visual amplitude. Click/tap seeks, wheel zooms around the pointer, repeated pinches zoom around the touch midpoint, and dragging pans a zoomed waveform. With waveform focus, arrows seek and plus/minus zoom. Comment gestures are:

- Add comment: whole-version modal without time inputs.
- Right-click or touch hold: point comment; right-button drag or hold-then-drag: range, ordered in either direction.
- Context-menu key or Shift+F10: point comment for keyboard users. Pinch/cancel must not trigger an accidental comment.

Comment/reply/download dialogs trap focus, support Escape/close, and return focus to their trigger. A comment retains its selected version/thread while open and closes after successful submission.

Media Session provides title, artist, available artwork, play/pause, and seek where supported. Private artwork keeps its access checks. Update metadata when tracks change; clear it on player exit, media failure, or learned revocation. Background/lock-screen behavior requires real-device verification; repeat remains a web control.

### Analytics

Owner-only demo analytics group activity by named link, locally generated browser ID, and optional listener name. Commenting associates earlier activity from that browser through the same link with the chosen name. Browser IDs and names are not verified people/devices; multiple browsers do not prove forwarding.

Record link visits independently of the player, including missing-audio pages. A play requires actual playback: first start, a whole-track repeat, or playback of another version. Pause/resume, seeks, visits, preloads, and switching versions while paused do not add plays. Exclude authenticated owner activity. Capture played intervals even from cached media.

Views include link/browser summaries, names, first/latest activity, listening time, unique coverage, version heatmaps, session timelines, pauses/seeks/endings, and download requests. Playing the same minute twice is two minutes of listening but one minute of coverage. Replacement keeps one combined version history. Download events describe initiated transfers, not verified completion; older events may lack format/email.

Sessions use a per-link browser-tab ID, renewed after 30 minutes without recorded activity. Temporary demo telemetry failures retry with stable event IDs while the page is alive; termination may lose pending events. Keep raw events so grouping does not redefine play counts. Retain analytics until explicitly cleared by the owner, including after audio removal.

Record available IP, device/browser/OS details, timestamps, and referring website origin without private paths/query strings. Approximate country/city comes from an optional operator-provided local MMDB database. Missing information remains unknown; no external geolocation request is sent.

### Replacement, removal, and restoration

Replacement keeps version identity, order, link relationships, comments, and combined statistics. If any comments exist, require exactly equal decoded duration by cross-multiplying source sample frames and rates as integers; rounded display times are insufficient. Preserve these source measurements after conversion. Process and validate before switching files; failed replacement leaves current audio usable.

Removing one version's audio or all audio on a track removes masters, legacy files, and WAV/MP3 export caches while retaining metadata, comments, links, and analytics. Show `Audio file missing`. Active listeners can request reupload; the owner sees the link and optional saved name and can dismiss the request. Restoration uses the same version/duration rule, or the owner may upload a new version. Inactive links stay neutral throughout.

## Public artists and releases

### Ownership, publication, and discovery

An account can own multiple artist profiles. Each single, EP, or album belongs to one primary profile and has an ordered track list; guests remain metadata. Release masters and metadata are independent of demos. Editing/removing demo audio never changes a release; conversion from demo to release is deferred.

Artist profiles are public, including before any release is published. They show name, optional image, biography, external links, and published releases newest first by release date (creation date fallback). Releases start as private drafts with owner previews. Publication requires artwork and at least one named track, but audio and other credits are optional. Published edits take effect on save; unpublishing hides release pages/media from visitors and removes listing entries. Republishing keeps the address.

Artist slugs are unique across the installation; release slugs are unique within the artist. Suggest lowercase hyphenated addresses such as `/artists/martin-dice/pressure`, validate collisions, and require a meaningful alternative. Slugs are set at creation; display-name/title edits do not change URLs. Explicit slug edits/redirects are deferred. Release pages include descriptive metadata, cover previews, canonical URLs, and structured music data; draft previews use `noindex`.

Songwriter credits link to generated `/songwriter/:songwriter` pages. Split complete names on comma, semicolon, or newline; normalize whitespace/case/diacritics/punctuation for matching. List each matching published release once across artists, headed `Artist - Release title`. Credit edits/unpublishing update listings immediately; no published matches returns 404. Songwriters have no separate administration or verified identity; normalized name collisions can combine credits.

### Metadata and layout

Release metadata includes title, type, primary artist, description, artwork, release date, label, catalog number, UPC/EAN, genre, credits, and copyright/phonographic notices. Track fields include title, order, artist, guests, version designation, ISRC, songwriters, producers, credits, explicit marking, and measured duration/format. A single-track heading keeps the linked primary artist first, appends distinct additional artists as plain text, and uses `featuring` for guests; multi-track releases keep track credits in their track context.

Public releases use a blurred, darkened artwork background, prominent cover/title/artist, player/track list, service links, and expandable credits. Desktop places cover and content side by side; mobile stacks them. Keep demo feedback/version management out of these pages.

Owner-supplied HTTP(S) service/shop links show their labels. Release links to Spotify, Deezer, SoundCloud, Amazon Music, Qobuz, YouTube, Apple Music, Tidal, and TikTok use local service icons determined by hostname; Amazon storefronts require a `/music/player/` path. Other destinations remain text links.

### Audio and continuous playback

Audio is optional for all or some tracks. Always show the full list and disclose which tracks have audio. One release-level setting controls playback and downloads together, including direct requests. Disabling it leaves the public metadata, artwork, and links available. Streaming needs no email.

Accept mono/stereo PCM WAV masters, preferring 24 bit/48 kHz but preserving other supported resolutions and original bytes/tags for download. Generate separate AAC/M4A playback at a target 256 kbit/s; report actual master format rather than claiming the preferred resolution. Normalize player volume using measurements of the AAC. The worker measures legacy release playback without rewriting it; while measurements are pending, show Preparing playback and keep eligible downloads available.

Release, artist, and songwriter routes share one React Router layout and one audio element:

- Selecting a different track replaces the queue with that track and the remaining playable, measured tracks in its release, in order. Browsing—including back/forward—does not change the queue or position.
- Track controls and the mini player share state. Pause/resume retains position/queue. Advance automatically; after the final track ends retain its metadata, then Play restarts the original queue from the first selected track. A playback error stops instead of silently skipping.
- After music is selected, the mini player appears across public music pages. Artwork/title link to the queued release; artist is plain text, using track artist then release artist fallback. Media Session uses that artist and release title as album; release artwork is a fitted/padded 512 × 512 JPEG derived from the current authorized cover.
- With music loaded, Space toggles the shared player even with another button or the position slider focused. Holding it toggles once without scrolling. Editing, other form inputs, selects, dialogs, composition, modifiers, and Enter retain native behavior; an empty player preserves normal Space behavior.
- Leaving for management, accounts, library, or demos disposes playback and its media session. A full reload starts empty. Newly learned unavailability stops affected playback; server authorization always applies. Future public music views join this layout without moving management/demo routes into it.

### Release downloads and statistics

Downloads use a modal and POST, offering complete-release or individual-track ZIPs. Every request—including the owner's—requires a syntactically valid email. Explain owner access/storage; do not verify, email, subscribe, or retain addresses in browser storage. Downloads require a published release with audio enabled, artwork, and ready audio, even for owners.

Offer mutually exclusive WAV (default) and MP3 choices for full releases and individual tracks, including existing uploads. MP3 uses the same on-demand cached LAME 320 kbps export as demos. Recheck publication, audio permissions and source identity after preparation; replacement/removal clears cached exports.

Each streamed ZIP contains unchanged WAV masters or the selected MP3 exports, normalized `artwork.png` (up to 2000 pixels per side), and `release-info.txt` with release/selected-track metadata and actual formats. Full ZIP/directory names use `Artist - Release title`; individual packages use `Artist - Track title`. Audio entries use `NN - Artist - Track title.wav` or `.mp3`, preserving release track numbers and track-specific artist fallback. Preserve Unicode and bound/sanitize names without changing WAV bytes. Partial packages clearly disclose the included tracks/count before download and in the info file.

Owner statistics show release-page visits, actual per-track playback starts, external-link clicks, and download requests with email, time, selected format, and included tracks. Exclude authenticated owner visits/plays/clicks; record owner downloads. Pause/resume adds no play; replay after ending does. Event IDs deduplicate repeated submissions. These are observations, not proof of human listening or completed transfers.

Public pages and other owners—including administrators—cannot inspect private analytics/addresses. Release statistics have no detailed listening heatmaps/timelines, artist-page view counts, CSV export, deletion/retention UI, or automatic expiry.

## Technical design and operations

| Responsibility | Implementation |
| --- | --- |
| UI and server routes | React 19, React Router framework mode, Vite, strict TypeScript, Node.js 24. |
| React optimization | React Compiler and recommended Hooks/compiler lint rules; verify compiler output after build-tooling changes. Avoid routine manual memoization. |
| Persistence | PostgreSQL 17 with Drizzle schema/migrations. |
| Identity | SimpleWebAuthn browser/server passkeys. |
| Audio | FFmpeg/ffprobe processing, server-generated peaks, wavesurfer.js UI, Web Audio playback gain. |
| Jobs | pg-boss in PostgreSQL, with retries for recoverable processing failures and pending-upload reconciliation. |
| Packaging | One image for web/worker, separate PostgreSQL, Docker Compose and GitHub Actions. |

| Repository area | Purpose |
| --- | --- |
| `app/routes.ts`, `app/routes/` | Route tree, loaders/actions, page UI, and protected media endpoints. |
| `app/components/`, `app/domain/` | Playback/dialog/feedback UI and shared domain rules. |
| `app/server/` | Access/authentication, schema, storage, audio/download processing, and workers. |
| `drizzle/` | Versioned SQL migrations and snapshots. |
| `scripts/` | Production server, migrations, recovery, notices, and registry-digest helper. |
| `tests/`, `.github/workflows/` | Behavior tests and image/release automation. |
| `docs/design/` | Historical interactive mockup and editable fragment; not runtime UI. |

Web and worker share persistent file storage. PostgreSQL holds accounts, metadata, ownership, share settings, comments, analytics, waveform peaks, and durable jobs. Peaks live with version metadata so publication is atomic without coordinating another waveform file. Files include demo masters/legacy originals, WAV/MP3 exports, release WAV/AAC, artwork, and pending uploads. Preserve both database and files outside container writable layers.

Routes enforce ownership and current visibility/download policy, including direct, partial, and conditional media requests. Protected storage is never static public content. Demo audio caches revalidate; release audio uses no-store. Replacing a file changes media cache identity without adding a visible revision/history. When the client learns of revocation, stop playback/discard affected caches; delivered bytes cannot be recalled. Same-origin mutation checks and production rate limits complement authorization. External navigation must not leak private URLs through referrers.

Use exact dependency pins and commit lockfiles/migrations with changes. [Operations](operations.md) defines configuration, startup/migration sequencing, image publishing, recovery, and backup boundaries. Hardware, connectivity, domains/proxies, backup execution, and deployments remain operator responsibilities.

## Visual direction and scope

Use a black background, near-black surfaces, clear high-contrast typography/borders, restrained mint playback accents, and accessible controls. Demo pages prioritize track, compact version selector, waveform, then feedback; owner management and detailed analytics have their own sections/views. Use available width with modest padding; stack content on narrow screens. The historical [mockup](design/wavecase-design.html) records the initial concept, not exact current controls. Supplied visual references were Visona/Demmo for demos and Anjunachill/Amuse for releases; final device polish remains acceptance work.

Out of scope: web push, folders/projects, shared ownership, comment editing/resolution, selected-range looping, Atmos, demo-to-release conversion, slug redirects, mailing lists, and the release analytics extensions listed above. Preserve access control and data integrity when simplifying other low-impact edge cases. Verify the important observable outcomes in [the testing guide](testing.md) rather than maintaining duplicate acceptance checklists here.
