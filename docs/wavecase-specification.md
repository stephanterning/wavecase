# Wavecase product and technical specification

Wavecase is a self-hosted music sharing application with two separate workflows: private demos for version-specific feedback, and public releases for finished music. Uploaders use passkey accounts; listeners need no account. Independent installations support multiple owners and configurable audio limits, even though the initial personal installation serves one uploader and roughly ten listeners per month.

This is the product contract. It takes precedence over conflicting product guidance in parent directories. [Implementation status](implementation-status.md) records limitations; [testing](testing.md) covers verification and device acceptance. All committed content and interface text are English. The license is AGPL-3.0-only.

## Accounts and ownership

- The first completed setup creates the administrator and closes bootstrap registration, including concurrent attempts. Setup selects open or invitation-only registration; an administrator can change it later.
- Invitations are single-use, revocable, and expire after seven days. A supplied invitation is consumed only after successful account creation, even when registration is open.
- Accounts require a display name and unverified email. Passkeys are the only login method; accounts can hold multiple passkeys and cannot remove their last one.
- Administrators manage registration, invitations, account disablement, and recovery. This role grants no access to another owner's private music, comments, or analytics. Artist profiles support shared ownership as described below; administrator status does not grant artist membership.
- After verifying identity, an administrator may issue a single-use, 15-minute recovery link for a non-administrator. Successful recovery replaces old passkeys and sessions. Administrator recovery requires the server command described in [operations](operations.md#accounts-and-recovery). Neither flow sends email or introduces password login.

### Shared artists and account administration

Accounts remain personal: each user manages their own name and passkeys. An artist profile is the boundary of a shared workspace. Its creator remains the membership manager and can invite existing, active accounts by their exact registered email, revoke pending invitations, and remove co-owners. Invitations appear on the recipient’s Artists page, require acceptance by that account, and expire after seven days; no email is sent. Pending invitations grant no private access. Recipients can decline; accepted co-owners can leave. Only the creator manages other memberships and cannot leave. Account disablement remains a separate system-administrator operation.

All accepted co-owners, including the creator, have the same rights over artist content: edit the profile; create, edit, publish, unpublish and delete releases; upload demos and versions; edit, move and delete demos; manage external share links; read and moderate feedback; and inspect statistics, including download email addresses. Existing and future material is shared regardless of who uploaded it. Shared artists, demos and draft/published releases appear in each member’s normal lists and dashboard. All authenticated co-owners receive the existing owner playback/analytics/download treatment. Other artists and unlinked personal demos remain private. Throughout this specification, owner access includes accepted co-owners of the current artist, or the personal owner for an unlinked demo.

Linked demos derive private access exclusively from their current artist’s membership. The uploader does not retain special access. Leaving or removal revokes private access without removing uploaded material or comments. Moving a demo to another accessible artist requires explicit confirmation: all versions, internal discussions, external links, feedback and statistics move with it, and access follows the destination artist. Existing external links keep working. Removing the profile association makes the demo private to the person making the change, including its retained history. Members can move a demo even when this removes another member’s access. Free-text names alone do not confer membership.

## Private workspace

Authenticated users start at `/dashboard`. A shared sidebar links Dashboard, Work in progress (`/library`), Releases (`/releases`), and Artists (`/artist-profiles`), including on private detail, account, and admin pages. Below 900 pixels the navigation opens in a keyboard-accessible modal panel. Public music and share pages remain outside this workspace.

The dashboard shows current demo, artist, published release, and draft counts. Activity uses a URL-selected rolling 7-day, 30-day (default), or all-time period. Its selector sits beside the welcome heading and applies changes immediately. Demo cards count plays, nondeleted listener feedback, download requests, and currently active links. Separate release cards count visits, plays, download requests, and external clicks. Existing owner exclusions apply; release download requests include owners. Counts describe recorded activity, not verified people or completed transfers. Show up to five received feedback entries in the selected period and five newest demos/releases across all time. Feedback links open the relevant version. All queries are scoped to accessible personal/shared content, including for administrators.

Artist administration has a name-sorted grid of fully clickable cards with profile images (or placeholders), release counts, and individual profile editors, preserving stable public addresses. New artists and releases use creation modals, with dashboard shortcuts also opening these and the existing new-track modal. Release cards show artwork, with a placeholder for drafts without it; the entire card links to release editing, without a separate public-page link. Releases require an accessible artist. Public artist URLs remain `/artists/:artist`.

Artist management presents the profile image, name, biography, artwork-based discography, and a compact links column. Profile, links, and image changes open scoped editors. Release management presents artwork and identity before the track list, with a separate Activity view. Metadata, artwork, track details, and masters use contextual dialogs; less frequently edited credits and identifiers are expandable. Editor dialogs mount fresh values on opening, confirm discarded changes, remain open on errors, and close after successful saves with focus returned to their trigger. Profile saves preserve links unless links are explicitly supplied; link saves preserve the profile. Demo Upload new version opens a focused dialog; the inline link overview sits above Feedback. Catalog artwork has bounded widths, dashboard feedback/recent music precede compact statistics, and private library rows show the newest version and its status.

Management editors save each section independently, show unsaved/saved status, and warn before leaving with unsaved edits. Preview links open a new tab with saved content; when sections are dirty, offer Save and preview, Preview saved version, or Cancel. Saving one section preserves edits in other sections. There is no autosave.

Release management supports title/artist search and artist/status filters. Artist editors show the current image and all owned releases, including drafts, with an artist-preselected Add release shortcut. Release editors provide contextual detail/artwork editors, collapsed track rows with audio status, a separate Activity view, a publication checklist, and a Release actions menu. Demo headers expose Upload new version and Edit track. The artist appears beside the title; empty track/version descriptions are not shown. Edit track opens a combined title, artist, and description form, with Delete track at the bottom leading to its separate confirmation. The shared cover sits at the right of the track identity, outside the version module, and stacks on small screens. Clicking it opens the cover editor, which can replace or remove the image; owners without artwork see Add cover. Version menus show names only in larger text and size to the selected name, bounded by the available width. Show the menu only when more than one version is available; otherwise show the version name as plain text with the same typography. Edit version sits at the upper right of the player module and opens a combined name, description, status, and download-permission form. A replacement-upload icon above the waveform appears on hover or keyboard focus and remains visible on touch devices; missing audio offers Restore audio. There are no separate Version settings or Track details panels or Share/Feedback anchor shortcuts. Dashboard quick actions precede statistics. Link editors use separate name and URL fields, and creation forms display the proposed immutable public address. Explain why the last passkey cannot be removed.

Owner previews use the listener interface without account controls, editing links, or return buttons. Demo preview requires ownership and an active share link and follows that link's version/download permissions. Preview navigation preserves this mode; playback is allowed but does not record analytics. Comment and download dialogs remain explorable, but submission reports that nothing was sent or saved. Draft release previews remain private, and drafts cannot download. Preview never publishes content. Normal published pages can offer owners a Back to editing link. Public branding does not lead listeners to account login, and unavailable share pages advise contacting the sender without revealing protected metadata.

## Private demos

### Library and versions

The private library lists one track per fully clickable, keyboard-accessible row linking to its detail page, with sortable Name, Created, and Artist columns, initially newest first. A live filter on the right matches names and artists on each keystroke, with the search input’s built-in clear control and an accessible label instead of a visible heading. Add new track sits on the left. Add new track opens the creation form in a modal. On narrow screens, the toolbar stacks and the table scrolls horizontally. The header provides an administrator settings gear beside the logo and an account initial opening a dismissible menu with Your account and Log out. The footer sits at the bottom of short pages and follows the content on longer pages. A track has a required title, optional artist, cover, and shared description. Suggest title/version names from the upload filename. Versions have a user-defined name, description, upload timestamp, download permission, and one status: `early idea`, `work in progress`, `to finish`, or `finished`.

New demos default to `early idea`. New version uploads preselect the latest uploaded version's status, or `early idea` when there are no versions yet. The uploader can change the status before submitting.

Version order follows new-upload order, not labels, processing completion, or replacements. Successful processing publishes a new version automatically; existing links keep their previous playable audio while processing is pending. There is no demo draft/publish step.

The artist may be free text or an accessible artist profile. Explicit selection checks current artist access. Free text links automatically only when exactly one accessible profile matches, ignoring case and surrounding whitespace; the migration applies the same rule without reassigning existing links. Ambiguous/unmatched names remain free text. Linked demos display the profile's current name and optional thumbnail, linking to the artist editor for the owner and its stable public page for listeners, even without published releases. Renaming preserves the relationship. This never publishes or lists the demo on the artist page, and listeners do not receive the owner's profile choices.

### Audio policy

Accept mono/stereo audio from WAV, AIFF, FLAC, MP3, MP4/M4A/MOV, Matroska/WebM, Ogg, AAC, ASF/WMA, APE, WavPack, AU, and CAF, subject to the shipped FFmpeg decoders. Unsupported, invalid, or empty input must fail clearly. Keep channel metadata extensible; multichannel/Atmos playback is outside scope.

For new uploads and replacements:

- Preserve the uploaded original byte-for-byte for download. Cap the separate playback master at 24 bit and 48 kHz independently, without increasing a lower source bit depth or sample rate. Apply triangular dither when reducing above 24 bit; preserve mono/stereo without downmixing, trimming, compression, or loudness normalization during conversion.
- Recognized PCM/lossless sources, including FLAC, ALAC, and APE, use a PCM WAV master. Keep a suitable WAV unchanged; otherwise convert. Reuse the original for playback when suitable; otherwise keep a separate playback master.
- Preserve compatible lossy audio without re-encoding; other supported sources receive a compatible WAV playback master within the ceiling. Decoding lossy audio does not make it eligible for WAV or FLAC download.
- Reject decoder failures and floating-point samples that are non-finite or exceed the PCM range. Validate and publish before deleting a superseded upload; failures must preserve the current valid audio.
- Generate waveform peaks and integrated LUFS, sample peak (dBFS), true peak (dBTP), loudness range, and duration from playback audio. Show these measurements on the demo page, without sample rate/bit depth.

Demo downloads offer WAV and FLAC at 16 bit/44.1 kHz for recognized lossless/PCM sources, MP3 at 320 kbps, and the unchanged original upload. WAV is the default for lossless sources; lossy uploads offer MP3 and original only. Preserve mono/stereo. The fixed 16-bit/44.1-kHz exports are compatibility formats, not an improvement to lower-resolution sources.

Prepare WAV/FLAC on first request and cache by upload identity. Resample before the final 16-bit quantization, applying triangular (TPDF) dither when reducing bit depth or requantizing resampled audio. Do not dither unchanged 16-bit/44.1-kHz samples again. FLAC encodes the exact WAV export samples without another dither pass. Keep suitable 16-bit/44.1-kHz PCM WAV uploads unchanged for that export. Do not normalize or compress audio dynamics in downloads.

MP3 uses LAME at constant 320 kbps, algorithm quality 2, prepared directly from the stored original on first request and cached. Preserve 44.1/48 kHz for MP3; lower-rate sources export at 32 kHz for MPEG-1 compatibility. This export resampling does not improve source quality or alter playback. Concurrent requests share encoding; failures expose no partial export, and removal/replacement clears cached exports.

Previously published demo playback is not rewritten. Older uploads that retained their original offer it unchanged. Uploads processed under the former single-master policy offer that file as **Stored master**, with an explanation that its resolution may differ from the upload; originals discarded during conversion cannot be recovered. They receive the new export choices using the available master. Legacy original POST requests remain supported; new uploads preserve the original filename and bytes.

### Share links and downloads

A link belongs to one track and carries an owner-only label for a recipient or group. Possession grants access; it does not verify identity. Links support all versions, a fixed starting version and every later version, or one specific published version only. A specific-version link never grants access to earlier or later versions, including after new uploads or removal of its audio; restoring or replacing that version keeps the link attached to the same version. New links default to the latest published version and future versions; creating this policy before publication fails. Missing audio must never broaden that boundary. Labels, boundaries, download settings, and active state can change without changing the URL. The owner’s Share links section, directly above Feedback, shows every link in a compact overview, including its label, active state, download permission, version boundary, and all-time play and download-request counts across versions. Copy, listener preview, and edit use labeled icon controls; editing opens a focused dialog. Play counts link to activity filtered by that link. Disabled links retain their statistics, and narrow layouts wrap rows without hiding settings.

Open the newest visible playable version; if none are playable, retain metadata and feedback without playback. An inactive link shows neutral information and denies protected content, while retaining comments/statistics for the owner. Re-enabling restores access under current settings. Active share pages provide title/description/authorized-cover previews with `noindex`; previews do not bypass link checks.

Listener downloads require an active link, visible version, link and version download permission, available audio, an allowed format, and a syntactically valid email. Enforce all conditions on the server and recheck after export preparation. The authenticated demo owner bypasses listener download permission/email requirements and creates no listener download event. Unavailable versions show an inactive download control.

Download format choices show an estimated total ZIP size (decimal MB, at most one decimal), including artwork and an allowance for metadata/ZIP overhead. Originals and cached exports use measured sizes; unprepared WAV uses duration/channels at 16 bit/44.1 kHz and MP3 uses duration at 320 kbps. FLAC size is unavailable until prepared because compression depends on the signal. Show output bit depth and sample rate for WAV/FLAC, bitrate and output sample rate for MP3, and actual available resolution for originals; mixed packages show min–max ranges, updated when choosing all or individual tracks. Inspect files only when the dialog opens, under the same visibility/download permissions. Estimates do not prepare exports or record download events.

Download opens a modal and submits via POST, so addresses stay out of download URLs; old direct GET/HEAD download requests do not serve files. Playback GET/range/HEAD delivery remains separate. Every package contains:

- Selected WAV, FLAC, MP3, or unchanged original/stored master, using the readable `Artist - Title - Version` name (omit missing artist) and its format extension.
- `demo-info.txt` and, when available, `artwork.jpg`, inside a directory with the same name as the ZIP.
- The fixed warning `Pre-release version. Do not share.`, also shown in the modal, including for `finished` demos. The info file includes current artist, title, version, status, upload timestamp, format, and descriptions.

Preserve Unicode and sanitize unsafe filename characters. Do not add recipient addresses, private share URLs, or owner account details to package metadata. Explain that email is shared with the owner and stored with the download request. Require each listener request to submit it; do not verify mailboxes, send messages, subscribe addresses, or save email in browser storage. Only the owner sees download addresses with format, version, link, time, and visitor context. Clearing track analytics deletes them; there is no separate address list or automatic expiry.

### Feedback

Threads belong to exactly one version and either one external share link or an internal discussion with no link. Authenticated owners can start internal whole-version, timestamp and range threads directly on the demo page, including personal demos without an artist. Internal threads are visible only to people with current private access to that demo, never through share links. Authenticated comments record the account identity and use its display name. The interface labels internal and external conversations and makes external reply visibility explicit before submission. Replies inherit their thread’s visibility; internal threads cannot be converted into external ones. Listeners see only their link's visible versions and conversations. Threads can concern a timestamp, range, or whole version and allow repeated replies. Owner feedback defaults to the selected version across internal and external conversations, with independent version/conversation filters. Replies retain the original thread's context; timestamp navigation selects that version and seeks. Missing audio disables seeking, not reading or replying.

Listeners choose an unverified display name, reused from browser local storage. A separate browser-held secret grants deletion rights; matching names or analytics IDs never do. Losing the secret does not recover ownership in another browser. The track owner may moderate any comment on that track; administrator status alone is insufficient. Deleting a comment with later replies leaves `deleted`; a final comment or unanswered opening disappears. Comment editing and resolved states are outside scope.

Unread indications are remembered per browser. Revisit the page to see replies; web push is deferred.

### Playback and interaction

All demo and release playback targets -16 LUFS integrated through constant player gain. Attenuate loud audio; boost quiet audio only within both 0 dBFS sample and 0 dBTP true-peak ceilings, reserving 0.01 dB true-peak headroom for rounding. Missing peak measurements, silence, or below-gate loudness must not produce a boost. Apply no limiting/compression. Stored audio, downloads, waveform data, and displayed measurements stay unchanged. Any future volume control attenuates the normalized signal.

Demo controls are play/pause, elapsed/total time, repeat with tooltip, and a separate download icon. There are no native audio controls, restart/volume buttons, zoom slider, or range-loop mode. Space toggles playback outside editable fields, selects, dialogs, and modified shortcuts. Version switching preserves position when it fits the destination duration (otherwise starts at zero) and preserves play/pause state. Reuse opened media where practical; this is not offline playback.

The 220-pixel waveform may normalize visual amplitude. Click/tap seeks, wheel zooms around the pointer, repeated pinches zoom around the touch midpoint, and dragging pans a zoomed waveform. With waveform focus, arrows seek and plus/minus zoom. Comment gestures are:

- Add comment: whole-version modal without time inputs.
- Right-click or touch hold: point comment; right-button drag or hold-then-drag: range, ordered in either direction.
- Context-menu key or Shift+F10: point comment for keyboard users. Pinch/cancel must not trigger an accidental comment.

Comment time fields use minutes:seconds with optional hundredths, converted to numeric seconds on submission. Comment/reply/download dialogs trap focus, support Escape/close, and return focus to their trigger. A comment retains its selected version/thread while open and closes after successful submission.

Media Session provides title, artist, available artwork, play/pause, and seek where supported. Private artwork keeps its access checks. Update metadata when tracks change; clear it on player exit, media failure, or learned revocation. Background/lock-screen behavior requires real-device verification; repeat remains a web control.

### Analytics

Owner-only demo analytics group activity by named link, locally generated browser ID, and optional listener name. Commenting associates earlier activity from that browser through the same link with the chosen name. Browser IDs and names are not verified people/devices; multiple browsers do not prove forwarding.

Record link visits independently of the player, including missing-audio pages. A play requires actual playback: first start, a whole-track repeat, or playback of another version. Pause/resume, seeks, visits, preloads, and switching versions while paused do not add plays. Exclude authenticated owner activity. Capture played intervals even from cached media.

When a different playable version loads, record a version-change event at its restored position (or zero when the previous position does not fit). Restoring that position is not a seek. Actual playback records its own start at that position; a paused version change records no play. Explain that play counts include version playback starts and repeats, not complete listens.

Views include link/browser summaries, names, first/latest activity, listening time, unique coverage, version heatmaps, session timelines, pauses/seeks/endings, and download requests. Playing the same minute twice is two minutes of listening but one minute of coverage. Replacement keeps one combined version history. Download events describe initiated transfers, not verified completion; older events may lack format/email.

Sessions use a per-link browser-tab ID, renewed after 30 minutes without recorded activity. Temporary demo telemetry failures retry with stable event IDs while the page is alive; termination may lose pending events. Keep raw events so grouping does not redefine play counts. Retain analytics until explicitly cleared by the owner, including after audio removal.

Record available IP, device/browser/OS details, timestamps, and referring website origin without private paths/query strings. Approximate country/city comes from an optional operator-provided local MMDB database. Missing information remains unknown; no external geolocation request is sent.

### Replacement, removal, and restoration

Replacement keeps version identity, order, link relationships, comments, and combined statistics. If any comments exist, require exactly equal decoded duration by cross-multiplying source sample frames and rates as integers; rounded display times are insufficient. Preserve these source measurements after conversion. Process and validate before switching files; failed replacement leaves current audio usable.

Removing a version’s audio removes masters, legacy files, and WAV/FLAC/MP3 export caches while retaining metadata, comments, links, and analytics. This action is available in the Replace audio dialog with confirmation; Remove all audio is not exposed in the UI. Missing audio retains a player-height placeholder showing **Audio unavailable** and “The audio for this version is currently unavailable. Please check back later.” Playback and downloads are unavailable, while version selection and feedback remain. Active listeners can request reupload; the owner sees the link and optional saved name and can dismiss the request. Restoration uses the same version/duration rule, or the owner may upload a new version. Inactive links stay neutral throughout.

Owners can permanently delete a whole demo from the bottom of the Edit track dialog, confirming by typing the exact title. This removes all versions, source/pending/playback audio, cached exports, cover, share links, feedback, statistics, and reupload requests. Deleting an individual version is not offered. Owners can delete a share link from its row after a named confirmation; all feedback (including owner replies), statistics, and reupload requests for that link are deleted, and excluded from every total. Other links and the demo remain. Disabling a link remains a reversible alternative preserving history. Deleted tracks and links show a neutral unavailable page to listeners without protected metadata.

## Public artists and releases

### Ownership, publication, and discovery

An account can create or co-own multiple artist profiles. Each single, EP, or album belongs to one primary profile and has an ordered track list; guests remain metadata. Release masters and metadata are independent of demos. Editing/removing demo audio never changes a release; conversion from demo to release is deferred.

Artist profiles are public, including before any release is published. They show name, optional image, biography, external links, and published releases newest first by release date (creation date fallback). Releases start as private drafts with owner previews. Publication requires artwork and at least one named track, but audio and other credits are optional. Published edits take effect on save; unpublishing hides release pages/media from visitors and removes listing entries. Republishing keeps the address.

Artist slugs are unique across the installation; release slugs are unique within the artist. Suggest lowercase hyphenated addresses such as `/artists/martin-dice/pressure`, validate collisions, and require a meaningful alternative. Slugs are set at creation; display-name/title edits do not change URLs. Explicit slug edits/redirects are deferred. Release pages include descriptive metadata, cover previews, canonical URLs, and structured music data; draft previews use `noindex`.

Songwriter credits link to generated `/songwriter/:songwriter` pages. Split complete names on comma, semicolon, or newline; normalize whitespace/case/diacritics/punctuation for matching. List each matching published release once across artists, headed `Artist - Release title`. Credit edits/unpublishing update listings immediately; no published matches returns 404. Songwriters have no separate administration or verified identity; normalized name collisions can combine credits.

Owners can permanently delete a draft from its editor after confirmation. Published releases must be unpublished first. Deletion removes the release, tracks, artwork, audio, cached exports, and activity records; the artist profile remains.

### Metadata and layout

Release metadata includes title, type, primary artist, description, artwork, release date, label, catalog number, UPC/EAN, genre, credits, and copyright/phonographic notices. Track fields include title, order, artist, guests, version designation, ISRC, songwriters, producers, credits, explicit marking, and measured duration/format. A single-track heading keeps the linked primary artist first, appends distinct additional artists as plain text, and uses `featuring` for guests; multi-track releases keep track credits in their track context.

Public releases use a blurred, darkened artwork background, prominent cover/title/artist, player/track list, service links, and expandable credits. Desktop places cover and content side by side; mobile stacks them. Keep demo feedback/version management out of these pages.

Owner-supplied HTTP(S) service/shop links show their labels. Release links to Spotify, Deezer, SoundCloud, Amazon Music, Qobuz, YouTube, Apple Music, Tidal, and TikTok use local service icons determined by hostname; Amazon storefronts require a `/music/player/` path. Other destinations remain text links.

### Audio and continuous playback

Audio is optional for all or some tracks. Always show the full list and disclose which tracks have audio. One release-level setting controls playback and downloads together, including direct requests. Disabling it leaves the public metadata, artwork, and links available. Streaming needs no email.

Accept mono/stereo PCM WAV masters, preferring 24 bit/48 kHz but preserving other supported resolutions and original bytes/tags for download. Generate LAME MP3 playback at constant 320 kbps, algorithm quality 2, directly from the original, sharing that file with MP3 downloads. Report actual master format rather than claiming the preferred resolution. Normalize player volume using measurements of the decoded MP3. The worker upgrades existing AAC playback in the background, reusing any cached MP3; keep old playback available until the MP3 and measurements are ready, then remove the superseded playback file. While measurements are missing, show Preparing playback and keep eligible downloads available. Failed upgrades preserve the current playback and original.

Release, artist, and songwriter routes share one React Router layout and one audio element:

- Selecting a different track replaces the queue with that track and the remaining playable, measured tracks in its release, in order. Browsing—including back/forward—does not change the queue or position.
- Track controls and the mini player share state. Pause/resume retains position/queue. Advance automatically; after the final track ends retain its metadata, then Play restarts the original queue from the first selected track. A playback error stops instead of silently skipping.
- After music is selected, the mini player appears across public music pages. Artwork/title link to the queued release; artist is plain text, using track artist then release artist fallback. Media Session uses that artist and release title as album; release artwork is a fitted/padded 512 × 512 JPEG derived from the current authorized cover.
- With music loaded, Space toggles the shared player even with another button or the position slider focused. Holding it toggles once without scrolling. Editing, other form inputs, selects, dialogs, composition, modifiers, and Enter retain native behavior; an empty player preserves normal Space behavior.
- Leaving for management, accounts, library, or demos disposes playback and its media session. A full reload starts empty. Newly learned unavailability stops affected playback; server authorization always applies. Future public music views join this layout without moving management/demo routes into it.

### Release downloads and statistics

Downloads use a modal and POST, offering complete-release or individual-track ZIPs. Every request—including the owner's—requires a syntactically valid email. Explain owner access/storage; do not verify, email, subscribe, or retain addresses in browser storage. Downloads require a published release with audio enabled, artwork, and ready audio, even for owners.

Offer mutually exclusive WAV (default), FLAC, MP3 and Original choices for full releases and individual tracks, including existing uploads. WAV and FLAC use the same cached 16-bit/44.1-kHz export and triangular-dither rules as demos. Original downloads preserve uploaded WAV bytes, tags and resolution. MP3 reuses the 320 kbps playback file (or prepares it on demand for older uploads awaiting playback migration). Recheck publication, audio permissions and source identity after preparation; replacement/removal clears cached exports.

Each streamed ZIP contains the selected WAV/FLAC/MP3 exports or unchanged original WAV masters, normalized `artwork.png` (up to 2000 pixels per side), and `release-info.txt` with release/selected-track metadata and actual formats. Full ZIP/directory names use `Artist - Release title`; individual packages use `Artist - Track title`. Audio entries use `NN - Artist - Track title.wav`, `.flac`, or `.mp3`, preserving release track numbers and track-specific artist fallback. Preserve Unicode and bound/sanitize names without changing original WAV bytes. Partial packages clearly disclose the included tracks/count before download and in the info file.

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

Web and worker share persistent file storage. PostgreSQL holds accounts, metadata, ownership, share settings, comments, analytics, waveform peaks, and durable jobs. Peaks live with version metadata so publication is atomic without coordinating another waveform file. Files include demo originals and playback masters, WAV/FLAC/MP3 exports, release WAV originals and shared MP3 playback/exports, artwork, and pending uploads. Preserve both database and files outside container writable layers.

Routes enforce ownership and current visibility/download policy, including direct, partial, and conditional media requests. Protected storage is never static public content. Demo audio caches revalidate; release audio uses no-store. Replacing a file changes media cache identity without adding a visible revision/history. When the client learns of revocation, stop playback/discard affected caches; delivered bytes cannot be recalled. Same-origin mutation checks and production rate limits complement authorization. External navigation must not leak private URLs through referrers.

Use exact dependency pins and commit lockfiles/migrations with changes. [Operations](operations.md) defines configuration, startup/migration sequencing, image publishing, recovery, and backup boundaries. Hardware, connectivity, domains/proxies, backup execution, and deployments remain operator responsibilities.

## Visual direction and scope

Use a black background, near-black surfaces, clear high-contrast typography/borders, restrained mint playback accents, and accessible controls. Demo pages prioritize track, compact version selector, waveform, then feedback; owner management and detailed analytics have their own sections/views. Use available width with modest padding; stack content on narrow screens. The historical [mockup](design/wavecase-design.html) records the initial concept, not exact current controls. Supplied visual references were Visona/Demmo for demos and Anjunachill/Amuse for releases; final device polish remains acceptance work.

Out of scope: web push, folders/projects, comment editing/resolution, selected-range looping, Atmos, demo-to-release conversion, slug redirects, mailing lists, and the release analytics extensions listed above. Preserve access control and data integrity when simplifying other low-impact edge cases. Verify the important observable outcomes in [the testing guide](testing.md) rather than maintaining duplicate acceptance checklists here.
