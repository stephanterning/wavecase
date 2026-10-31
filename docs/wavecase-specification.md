# Wavecase Product and Technical Specification

Wavecase lets musicians share work in progress, collect feedback on particular versions, and understand listening activity through individually named private links. Uploaders have passkey accounts. Listeners follow a link without creating an account.

The initial personal installation serves one uploader and approximately ten listeners per month. The public open-source project must also support independent installations with multiple uploaders. Application limits must be configurable rather than tied to the initial installation.

This specification captures the product interview through October 30, 2026. Product requirements and the selected stack are recorded below. Proposed implementation defaults and remaining details are explicitly separated from agreed requirements. Implementation is being validated locally; see [implementation status](implementation-status.md).

Wavecase also includes a separate Releases feature for finished, released music: public artist and release pages, streaming and shop links, optional full-track playback, and email-gated downloads of original masters with artwork and credits. These requirements describe agreed scope, not implementation completion.

## Project scope

The project includes the application, Docker packaging, first-run setup, persistent storage integration, and documentation needed to run the application. The selected license is GNU AGPL version 3. All committed content is in English, including interface text.

Host hardware selection, internet connectivity, domain and reverse proxy or tunnel setup, and backup operation are outside the project scope. Files and database data must nevertheless persist outside container writable layers so the operator can back them up independently.

## Accounts and installation

### First run

Before setup is complete, anyone who reaches the installation can use the setup form to create its first administrator account with a passkey. The first completed setup closes the bootstrap flow. Concurrent attempts must not create additional bootstrap administrators.

Setup selects either open registration or registration through an administrator invitation link. The administrator can change this setting later.

Account invitation links are single-use, expire seven days after creation, and can be revoked by an installation administrator. Consume an invitation only when account creation succeeds.

### Roles and access

| Role | Capabilities |
| --- | --- |
| Installation administrator | Manage accounts, registration policy, invitations, and installation settings. The role does not grant access to other uploaders' tracks, comments, or analytics. |
| Uploader | Manage a private library of owned tracks, versions, share links, comments, and analytics. Each track has one owner. |
| Listener | Access the content allowed by a share link, listen, comment under a chosen name, and download permitted audio. No account is required. |

An administrator can also own tracks as an uploader. Other account holders can participate through share links but cannot jointly administer a track in the first release.

### Identity and recovery

An uploader account requires a display name and email address. The email address is not verified and is not an authentication method. Passkeys are the only account authentication method; multiple passkeys can be registered to an account.

The application must provide an administrator-assisted process to enroll a replacement passkey after a user loses all existing passkeys. Recovery of the installation administrator requires access to the server. The exact recovery protocol remains a technical design item; it must not introduce ordinary password or email login.

## Work-in-progress library and feedback

The library, version, share-link, playback, analytics, and visual requirements in the following sections describe the work-in-progress and feedback workflow. Public releases have their own requirements under Public artists and releases, including different playback formats, download access, and analytics scope.

## Library and metadata

The initial library has search and sorting, without folders or shared projects.

| Track field | Requirement |
| --- | --- |
| Title | Required; suggest a title from the upload filename. |
| Artist name | Optional free text or a linked artist profile owned by the same account. |
| Cover image | Optional. |
| Description | Optional; shared across versions. |

The artist field offers the account's own artist profiles while retaining free-text entry. Selecting a profile stores its ID. Saving a free-text name automatically links exactly one matching profile in the same account, ignoring letter case and surrounding whitespace. Ambiguous and unmatched names remain unlinked until the owner chooses a profile. Existing demos receive the same unambiguous matching in the migration; already linked demos are not reassigned.

On both the owner's demo page and authorized share pages, a linked artist displays the profile's current name as a link to its public artist page, including when that page has no published releases. If the profile has an image, show a small thumbnail to the left of the name within the same link. Renaming a profile preserves the relationship and URL. Free-text names stay plain text. The link does not publish the demo or list it on the artist page, and private share-link access rules remain unchanged. Listener responses must not include the owner's other artist-profile choices.

Each version has its own name, description, upload timestamp, download permission, and status. Version names are user-defined, such as `v1`, `v1.1`, or `v3.2`. Suggest a version name from the filename when recognizable and allow the uploader to correct it. Labels do not determine ordering.

The version status is one of:

- `early idea`
- `work in progress`
- `almost finished`
- `finished`

## Audio and publication

### Upload and playback files

Accept a broad range of audio formats through server-side decoding. The concrete supported set is determined by the shipped FFmpeg build and verified fixtures; an unsupported or invalid file must produce a clear error.

For new uploads and file replacements, cap the stored audio at 24 bit and 48 kHz, limiting each property independently without increasing a lower source bit depth or sample rate. Reduce bit depths above 24 with triangular dithering. Convert uncompressed PCM and recognized lossless sources (including WAV, AIFF, CAF PCM, FLAC, ALAC and APE) to a PCM WAV master when necessary. The same stored master serves playback and WAV downloads; do not retain a separate lower-quality playback copy. Keep an already suitable WAV unchanged. Delete a superseded source upload only after processing, validation and publication succeed. Reject decoder errors and floating-point sources with non-finite samples or peaks outside the PCM range rather than publishing shortened or silently clipped replacements.

Preserve compatible lossy uploads for playback without re-encoding. Other supported sources receive a compatible WAV master within the same ceiling, but decoding a lossy source does not make it eligible for WAV download. Existing published uploads keep their stored files, playback and original-download behavior until their audio is replaced.

For newly processed audio, the download form offers mutually exclusive WAV and MP3 options, with WAV selected by default when available. WAV is available only for recognized uncompressed or lossless sources; lossy sources offer MP3 only. MP3 uses LAME at constant 320 kbps with algorithm quality 2, encoded from the master on the first request and cached for subsequent downloads. Keep 44.1/48 kHz sources at their sample rate; use 32 kHz for lower-rate MP3 exports because 320 kbps requires MPEG-1. This export-only resampling does not restore lost quality or alter the stored master. Remove cached exports when their audio is replaced or removed.

The first release supports mono and stereo. Represent channel information without a schema restriction to two channels. Dolby Atmos is a possible future feature requiring separate format, metadata, and playback design; it is not part of the first release.

### Processing and visibility

A new version becomes available automatically after upload and required audio processing succeed. There is no manual draft or publish step. Until then, existing share links continue to open the previous playable version.

Version ordering follows the order in which new versions were uploaded. Replacing the file of an existing version does not change that version's position. A slower processing job must not make an older upload appear newer than a later upload.

### Audio measurements

The listener page shows measurements for the playback file:

- LUFS, with integrated loudness as the proposed initial interpretation.
- Peak level in dBFS.
- True peak in dBTP.
- Loudness range.
- Duration.

Do not display sample rate or bit depth on the listener page. Internal processing metadata may retain both.

## Share links

A share link belongs to one track and has a private label chosen by the uploader, such as a recipient name or group. Both individual and group links are supported. Possession of the link grants access according to its current settings; it does not verify the identity of its visitor.

### Version visibility

Each link has one of two policies:

| Policy | Visible versions |
| --- | --- |
| All versions | All existing and future versions of the track. |
| From a version onward | The latest version at link creation and all versions uploaded after it. Earlier versions are hidden. |

New share links default to Latest and future versions (the second policy). The second policy stores a fixed starting version. The uploader can later edit the policy and its starting point, as well as the link label and download setting, without changing the share URL.

An active link opens its newest visible version with an available, ready audio file. If the newest visible version has no audio, use the next newest playable version allowed by that link. Never fall back to a version outside the link's allowed range. If none are playable, show the retained information without playback.

### Download permissions

Audio download requires all of the following:

- The share link is active and allows access to the selected version.
- The link allows downloads.
- The selected version allows downloads.
- Its stored master (or legacy original) is available, and the requested format is permitted for that source.

The listener sees an inactive download button for a version that cannot be downloaded. These restrictions must also be enforced by the server on direct file requests.

### Deactivation

The uploader can deactivate a share link. An inactive link shows neutral information without revealing track details. Its previous comments and statistics remain available to the owner. Re-enabling a link restores access according to its current settings.

## Comments and listener identity

### Context and threads

A comment thread belongs to exactly one version and one share link. Listeners only see the threads for the link through which they entered. A listener must also have access to the relevant version. The uploader can view all of their track's threads with the originating version and link identified.

A thread can refer to a single timestamp, a selected time range, or the whole version. Listeners and the uploader can reply repeatedly in the same thread. Owner replies stay within that thread's link and version context.

The uploader's track page includes a Feedback section below the player. By default it shows threads for the selected version across all share links. The uploader can choose all versions and can independently filter by share link. Each thread identifies its listener, originating link, version, and timestamp or range, where present. These owner-only filters never broaden a listener's access.

Selecting a thread's timestamp selects its version and seeks to that point. Threads remain readable and replyable when their audio is missing; seeking is then unavailable. Replies are always sent within the selected thread's original link and version, regardless of the active filters.

### Names and ownership

A listener provides a freely chosen display name when commenting. Store that name in local storage for the installation, so it can be reused on other share pages. It is a self-reported name, not verified identity.

Comment ownership uses a separate generated secret held by the browser and verified by the server. A display name or publicly visible analytics identifier must never grant deletion permission. Losing the browser secret or using another browser does not automatically recover ownership of old comments.

The uploader is authenticated through their account and can delete any comment on their own tracks. Installation administrator privileges alone do not grant this capability over other owners' tracks.

### Deletion behavior

Listeners can delete their own comments. If a deleted comment has later replies in its thread, preserve its position with the text `deleted` so the conversation remains readable. A final comment with no later replies disappears, as does a standalone opening comment with no replies.

Comment editing and resolved or completed thread states are not included in the first release.

### Notifications

The initial approach is to revisit the share page and see new replies, with unread indications as a proposed interface default. Web push is deferred. Push support may be added later, accounting for browser permission and platform installation requirements.

## Playback experience

Normalize all in-app playback toward -16 LUFS integrated using a constant gain in the player. Attenuate louder audio and boost quieter audio only as far as both sample peak and true peak allow, with ceilings of 0 dBFS and 0 dBTP. Apply no compression or limiting. This changes playback volume only: stored audio, original downloads, waveform data, and displayed file measurements remain unchanged. Use existing measurements for existing uploads as well as new uploads. Leave 0.01 dB of true-peak headroom for measurement rounding; do not boost when either peak measurement is unavailable. Silence or audio below the loudness measurement gate receives no loudness boost. Keep normalization independent of any future manual volume control, which would attenuate the normalized signal from 100% down to silence.

Both uploader and listener views must work on desktop and mobile, including mobile uploads. Use application-styled player controls: play/pause, elapsed/total time, and a repeat icon toggle with a tooltip. Do not expose native browser audio controls, a restart button, a volume control, or a zoom slider. Audio download is an icon with a tooltip outside the playback controls. For newly processed audio it opens the format-selection dialog. Space toggles playback throughout the track page, except in text-entry fields, selects, modal dialogs, or modified keyboard shortcuts so typing and native input behavior remain usable.

Render the waveform at 220 pixels high. Its visual amplitude may be normalized for legibility without changing the audio. A regular click/tap seeks. Wheel scrolling over the waveform zooms around the pointer; two-finger pinch zooms around the touch midpoint. Dragging pans a zoomed waveform. Arrow keys seek and plus/minus keys zoom when the waveform has focus. There is no tool for looping a selected interval.

Comment creation and replies use a modal, with no inline feedback form on the listening page. The listener's Add comment button opens a whole-version comment with no time inputs. Right-click or touch-and-hold on the waveform selects a point; releasing opens the modal with its start time filled. Holding the right button (or dragging after a touch hold) selects a range in either direction; releasing opens the modal with ordered start/end times. Pinching cancels a pending long press. Keyboard users can open a point comment with the context-menu key or Shift+F10. The modal retains its original version/thread context, traps focus, supports Escape/cancel, and closes after a successful submission.

Support background playback and lock-screen media controls where supported by the platform. Repeat is controlled from the web player; a repeat command is not available in the standard Media Session action set.

For both demos and releases, provide the playing track's title, artist and available cover artwork to the platform's media session. Releases use the track-specific artist when supplied, otherwise the release artist, and include the release title as the album. Update the metadata when tracks change and clear it when leaving the player or learning that access was revoked. Private demo artwork retains the same access checks as on the listening page.

When switching versions, preserve the playback position when it exists in the destination version and preserve the play or pause state. Starting from zero when the position is outside the new duration is the proposed fallback. Cache already opened versions where practical to make subsequent switches fast. This is an interaction performance requirement, not an offline listening feature.

## Listening and download analytics

### Attribution

Organize analytics by the named share link, unique browser, and optional self-reported listener name. When a visitor comments, associate available listening activity from the same browser with their name. The uploader must only see activity associated with their own content.

Use a generated browser identifier persisted locally. Browser changes, private browsing, cleared storage, and shared devices mean this is not a reliable count of physical devices or people. Additional browsers on a personal link can suggest forwarding but do not prove it.

Capture available visitor information including IP address, country, approximate locality when available, device category, operating system, browser, referring website when supplied, and timestamps. Missing information remains unknown rather than being guessed. Geographic lookup is approximate and needs a concrete data source before implementation.

### Events and views

A play requires started playback of delivered audio. A page visit, preload, or audio request alone must not count as a play. Instrument playback so cached listening can be measured as well as network-delivered listening. Exclude the authenticated track owner's own playback from recipient analytics.

Retain sufficient events and played intervals to show:

- Link visits, plays, unique browsers, and associated names when known.
- First and latest activity.
- Total listening time and unique coverage of each version.
- Pauses, forward and backward seeks, replayed passages, and endings.
- Individual sessions with a timeline of what was played and skipped.
- Aggregated heatmaps of listening across the track timeline.
- Download events with format, version, time, and visitor context (legacy events may omit format).

Heatmaps measure observed playback rather than buffer downloads. Distinguish total listening time from unique coverage: playing the same minute twice is two minutes of listening and one minute of unique coverage. A download record should distinguish an initiated transfer from any completion evidence actually available to the application.

Keep detailed analytics until the uploader explicitly deletes them. Removing a track's audio does not remove its analytics. Replacing a version's audio keeps one combined history; do not split reports by file replacement or introduce a visible file-revision history.

Count a play when audio playback first starts. Pausing and resuming or seeking within an ongoing play does not increment the counter. Each new whole-track repeat cycle and starting playback of another version count as a new play. Every increment requires actual playback; changing versions while paused does not count. Seeking to the beginning alone remains a seek; there is no separate restart control.

Session boundaries remain an implementation detail to finalize. Preserve the underlying playback events so session grouping does not change the agreed play-counting rules.

## Replacing and removing audio

### Replacement

An uploader can replace a version's audio. If the version has comments through any share link, the replacement must have exactly the same duration. Do not accept a replacement merely because both files display the same rounded minutes and seconds. The exact comparison method across decoded formats remains an implementation detail to specify and test.

The version retains its identity, position, link relationships, comments, and combined statistics. Validate and process a replacement before making it active; a failed replacement leaves the existing file usable.

### Removal and restoration

An uploader can remove all audio for a track or remove the audio of one version. Remove all stored masters, legacy originals/playback files and cached MP3 exports while retaining track and version metadata, comments, analytics, and other non-audio information. The retained version is labeled `Audio file missing` in the English interface.

An active link to a removed track still shows the track information, existing conversations, and a message that the audio has been removed. Provide a button to request that the uploader upload it again. The proposed delivery is an item in the uploader's administration view, recording the track, link, and listener name if known.

The uploader can restore a missing file to its existing version, subject to the same comment-dependent duration rule, or upload a new version. Existing share URLs continue to work according to their visibility policies. An inactive link remains neutral even if its track has been removed or restored.

## Visual direction

Use a dark theme with clear typography, a prominent waveform, accessible controls, and easy version selection. Keep detailed analytics and administration in their own views so the listening page stays focused on the track and feedback.

The owner's visual references are [Visona](https://visona.org) and [Demmo](https://www.demmo.link). The approved initial mockup is the implementation's visual baseline; no detailed visual attributes of Visona have been assumed.

The current layout uses a pure black page background, near-black surfaces and buttons, high-contrast light text and borders, and a restrained mint accent for playback. Pages use the available screen width with modest side padding and smaller vertical spacing; the version selector uses only the space its content needs. The listener view gives the track, version selector, waveform, and feedback most of the space. The uploader view puts Feedback below the player, defaulting to the selected version across all links, with version and share-link filters. Compact version and share-link lists and a small activity summary follow. On narrow screens, feedback and management sections stack below the player. This initial visual direction is approved; final browser and mobile polish remains part of acceptance testing.

## Public artists and releases

### Scope and ownership

Account holders can manage multiple artist profiles within the same Wavecase account. Each release belongs to one primary artist profile; guest artists are recorded in metadata. Support singles, EPs, and albums from the first version of this feature, with an ordered track list.

Release creation initially uses a separate upload and metadata-entry workflow. Release masters and metadata are independent of work-in-progress tracks, versions, private share links, and feedback. Editing or removing work-in-progress audio must not change a published release. Creating a release from an existing work-in-progress track is deferred.

Each artist has a public page listing their published releases. Each release has its own public page with artwork, relevant metadata and credits, and owner-supplied links to streaming services and online shops such as Bandcamp. Visitors do not need a Wavecase account to view these pages.

On release pages, links to Spotify, Deezer, SoundCloud, Amazon Music, Qobuz, YouTube, Apple Music, Tidal, and TikTok display the supplied service icon beside the owner's link label. Identify the service from the destination hostname and serve the icons locally. On Amazon storefront hosts, only `/music/player/` links receive the Amazon Music icon. Other destinations keep their text links.

### Public addresses and presentation

Artist and release URLs must be logical, human-readable, and suitable for search engines, using meaningful artist names and release titles rather than opaque generated identifiers.

The visual references supplied by the owner are [Anjunachill](https://anjunachill.co/abc01.gcn) and [Martin Dice — Pressure on Amuse](https://share.amuse.io/track/martin-dice-pressure). Screenshots were supplied during the product discussion. Use the release artwork to form the full-page background, alongside a clearly displayed cover, artist, title, and service links. The exact layout remains a proposed design below.

### Optional audio and coupled availability

Audio uploads are optional. A release may contain only artwork, metadata, and external links, or may have audio for only some tracks. Show the full track list and make audio availability clear.

Playback and download availability are controlled together by one release-level setting; there are no independent playback-only or download-only modes. When enabled, tracks with uploaded, ready audio can be played in full on the release page and downloaded. Playback does not require an email address. When disabled, the public artwork, metadata, and external links remain available, but Wavecase playback and downloads are unavailable. Enforce this setting on direct media and download requests as well as in the interface.

Accept WAV masters, preferring 24-bit, 48 kHz uploads. Other WAV bit depths and sample rates may be uploaded without conversion for download. Preserve the uploaded master unchanged, including existing tags; never claim a download is 24-bit, 48 kHz unless that is its actual format. Show the actual download format.

Separate playback derivatives may be generated. AAC at 256 kbit/s is the agreed minimum playback quality. This permission to create listening copies does not permit rewriting or converting the downloadable masters and is separate from the work-in-progress WAV playback policy.

### Download packages and email gate

Offer both a complete-release ZIP and individual-track ZIPs. Every ZIP includes:

- The unchanged original WAV file or files included in that download.
- Release artwork in PNG or JPG format.
- A readable `release-info.txt` containing relevant metadata and credits. An individual-track package includes release-level information and that track's information.

Download names remain readable outside Wavecase. A release ZIP and its enclosing directory are named `Artist - Release title`; an individual-track ZIP and directory are named `Artist - Track title`. WAV filenames use `NN - Artist - Track title.wav`, preserving the track's release number even in partial or individual downloads. Use a track-specific artist when supplied, otherwise the primary release artist. All files, including `artwork.png` and `release-info.txt`, go inside the named directory. Preserve spaces and Unicode letters, including Swedish characters; replace unsafe filesystem characters and bound filename length. Renaming package entries must not change WAV contents.

For a release with only some masters uploaded, the release ZIP contains only the available tracks. Before download, clearly identify the included tracks and the partial coverage, for example, `3 of 5 tracks included`. Include the package's track list in `release-info.txt` as well. Do not imply that unavailable audio is included.

A visitor must enter an email address with valid syntax before downloading. Do not require an account, mailbox verification, a confirmation email, or proof that the address exists. After accepting the address, start the requested download immediately and save the supplied address with the download event in the database. The gate must also apply to direct package requests; an entered address must not grant access to disabled or otherwise unavailable downloads.

The address is self-reported, not a verified identity. Associate each download event with the requested release or individual track, the package contents, and the time. A request or initiated transfer must not be presented as proof that the entire download completed.

### Metadata and credits

Include relevant release and track metadata and credits on the release page and in the download text file. Label and track-level ISRC are explicitly required fields to support; guest artists are metadata rather than additional primary profile ownership. The proposed field inventory below remains subject to refinement, including which fields are mandatory to publish.

For a release containing one track, the artist line below the release title also shows that track's additional artists and guests. Keep the primary profile name first and linked; show additional comma-separated artist names as plain text and guests after `featuring`. Omit repeated primary artist names. Releases with multiple tracks retain the primary profile in the heading, so a guest on one track is not credited across the whole release.

### Generated songwriter pages

Songwriter names in track metadata link to generated public pages at `/songwriter/stephan-terning`. Each page lists every published release containing at least one track credited to that songwriter, once per release and newest first. List titles use `Artist - Release title`. These pages have no separate profile, editable content, or administration; saved credit changes and publication changes are reflected immediately. Draft releases are excluded, including for signed-in owners. Unknown names and names credited only on drafts return 404.

Songwriter credits are separated by commas, semicolons, or line breaks. Names are matched by a lowercase, hyphenated form with accents and repeated whitespace normalized; distinct people whose names normalize to the same address share a listing. Spelling corrections change the derived address. Names are not linked to uploader accounts or artist profiles.

### Release analytics

The initial release analytics scope is:

- Page views.
- Plays per track.
- Clicks on external links, attributed to the selected link.
- Download events with the supplied email address, time, and requested release or track.

Display this information inside Wavecase for the owner. CSV export is deferred. Do not include heatmaps, detailed listening timelines, or the work-in-progress workflow's detailed listening analysis in this feature. Download addresses and non-public statistics follow account ownership boundaries; public pages must not expose them, and installation administrator status alone does not grant access to another owner's data.

### Proposed release defaults and remaining details

The following proposals were discussed but have not been individually finalized. They must not be mistaken for additional agreed requirements:

- Publication workflow: private draft, preview, manual publication, editing, and unpublishing. Only published releases appear on the artist page; republication retains the address. Exact editing and publication behavior remains to be finalized.
- Address pattern: `/artists/martin-dice` and `/artists/martin-dice/pressure`. Suggest lowercase, hyphenated slugs from names and titles, allow edits before publication, and resolve conflicts with meaningful suffixes. Keep published addresses stable when display names change; redirect old addresses after an explicit URL change. Namespace and collision rules remain to be finalized.
- Search and sharing: index published pages, provide descriptive page titles and descriptions, cover-image link previews, and structured music metadata.
- Artist page: artist name, optional profile image, short biography, external links, and published releases ordered by release date, newest first.
- Release layout: large cover beside the player and track list on desktop; a single column on mobile. Use a blurred, darkened artwork background, ordinary page scrolling, consistent service-link styling, and expandable detailed metadata. Keep feedback threads and work-in-progress version controls out of this page. Automatic progression through the track list is a proposed player behavior.
- Release metadata: title, primary artist, release type, release date, label, catalog number, UPC/EAN, artwork, description, genre, and phonographic/copyright notices. Track metadata: title, artist and guests, track number, version designation, ISRC, songwriters, producers, other credits, explicit marking, and measured duration.
- Email handling: explain at entry that the supplied address is shared with the release owner and stored with the download. Mailing-list subscription would require a separate choice and is not included in the agreed feature. Retention/deletion rules and whether repeat downloads reuse an earlier submission remain to be finalized.
- Counting: exclude the authenticated owner's own visits and test playback; count plays only after playback actually starts. Exact visit, replay, and duplicate-event counting rules, and whether artist-page views need a separate report, remain to be finalized.

### Release acceptance scenarios

1. One account manages multiple artist profiles. Each release belongs to one primary profile, while guest artists remain metadata. Public artist pages list the appropriate published releases using readable URLs.
2. A single, EP, or album can be published without audio. Its artwork, metadata, track list, and external links remain usable without a visitor account.
3. A release with audio for three of five tracks shows all five tracks, allows full playback of the three available tracks when enabled, and clearly identifies those three as the release ZIP contents.
4. Turning the release's audio setting off disables both playback and downloads, including direct requests, while preserving the public page and external links. Turning it on restores both for ready audio.
5. Invalid email syntax prevents a download. A syntactically valid but unverified address starts the requested download without account creation or an email-confirmation step and is recorded with the event.
6. Both release and individual-track ZIPs include artwork and `release-info.txt`. Each WAV matches its original upload, including when its resolution differs from the preferred 24-bit, 48 kHz format. Playback derivatives do not alter those originals.
7. Owners can inspect page views, per-track plays, external-link clicks, and download events with supplied addresses inside Wavecase. Public visitors and other account holders cannot inspect private download addresses or analytics.
8. Removing or replacing work-in-progress audio does not change a release's independently uploaded masters, metadata, or public availability.

## Selected technology

| Responsibility | Technology |
| --- | --- |
| Application language | TypeScript, using strict checking. |
| Web interface and server routes | React 19 and React Router in framework mode, built with Vite and served by Node.js. |
| React optimization | React Compiler enabled from the start, with recommended React Hooks and compiler lint rules. |
| Database and migrations | PostgreSQL and Drizzle. |
| Passkeys | SimpleWebAuthn server and browser packages. |
| Audio decoding and analysis | FFmpeg and ffprobe. |
| Waveform interface | wavesurfer.js integrated with browser audio playback. |
| Durable background jobs | pg-boss using PostgreSQL. |
| Packaging | Docker Compose. |

Use stable dependency releases and pin the exact chosen versions when initializing the implementation. Verify React Compiler is actually applied in build output or React DevTools. Manual memoization should be driven by measured need rather than applied routinely.

### Application structure

Keep web routes, shared validation, domain rules, database schema, and worker code in one repository. Routes should call server-side domain functions that consistently enforce ownership, link visibility, and download permissions. The waveform library should have a defined lifecycle so normal React updates do not recreate the audio player.

Docker Compose contains three services: the web application, an audio processing worker, and PostgreSQL. The web application and worker share the codebase and mounted audio storage. pg-boss stores jobs in PostgreSQL, so the architecture does not require a separate queue service.

Store audio masters and cached exports as files in a host-mounted data directory; retain legacy originals and playback derivatives for existing uploads. Store accounts, metadata, generated waveform peaks, ownership, link settings, comments, analytics, and job state in PostgreSQL. Waveform peaks are kept with version metadata to make publication atomic without coordinating a separate waveform file; they remain part of database backups. PostgreSQL also uses explicitly persistent storage outside its container writable layer.

### Audio processing and delivery

Process audio in durable background jobs. Derive waveform data on the server so rendering a waveform does not require decoding the complete audio file on a listener's phone. Publish a version only after its required artifacts are ready.

Audio delivery must support seeking and permission checks, including partial file requests. Originals and derivatives must not be exposed through an unprotected static directory. File replacement changes the media cache identity without creating a separate user-visible version or analytics history.

Recheck link policy for protected requests. When a client learns that a link was disabled or audio removed, stop offering playback and discard affected application caches. Bytes already delivered to a listener cannot be recalled.

## Proposed implementation defaults

These defaults fill smaller gaps without changing the agreed feature scope. They remain reviewable before the relevant implementation work.

- Preserve mono as mono and stereo as stereo. Apply no loudness normalization, compression, trimming, or automatic downmix during format conversion.
- Interpret the displayed LUFS measurement as integrated loudness over the playback file.
- Begin at zero when a version switch cannot retain the previous playback position.
- Show unread replies on return, and deliver reupload requests in the uploader view.
- Use automatic retries for recoverable processing failures and preserve the last valid audio until a replacement succeeds.
- Derive heatmaps and coverage from recorded played intervals rather than treating transferred bytes as listening.

## Initial implementation decisions

- Sessions use a browser-tab session identifier per share link, renewed after 30 minutes without recorded activity. A share-page visit is recorded independently of its player, including when no version has audio. Raw events are retained so grouping can be revised independently of play counts. Temporary telemetry failures retry with stable event IDs while the page remains alive; closing a page can still lose unacknowledged activity. Referring websites are stored as origins only, without paths, query strings or share tokens.
- Compare replacement duration using decoded source sample frames and sample rate, cross-multiplied as integers. This avoids rounded timestamps and permits exactly equal durations at different sample rates.
- Preserve compatible lossy sources; cap newly processed masters at 24 bit/48 kHz, reducing each property independently. Preserve compatible PCM WAV within the ceiling. Playback measurements describe the actual master used for playback. Retain decoded source sample counts and rates for exact replacement-duration validation even after deleting the source upload.
- Version visibility uses a monotonic upload order, independent of labels, processing completion, and timestamp precision.
- Administrator-assisted recovery uses a single-use, 15-minute enrollment link after the administrator verifies identity. Successful recovery replaces prior passkeys and sessions. Administrator recovery requires the server command. Neither path uses email authentication.
- Optional approximate geolocation uses a local GeoIP City MMDB file supplied by the installation operator. No external lookup is performed. Missing data remains unknown.
- HTTP media caching requires revalidation; ownership and current link permissions are checked before conditional responses. Already delivered audio cannot be recalled.
- Unread reply indications are remembered per browser. A cleared browser storage starts without previous read history.
- Default upload and duration limits are configurable. Supported audio containers are WAV, AIFF, FLAC, MP3, MP4/M4A/MOV, Matroska/WebM, Ogg, AAC, ASF/WMA, APE, WavPack, AU, and CAF, subject to the shipped FFmpeg decoders. Files outside this supported set fail clearly.
- Device passkey prompts, iPhone background playback, lock-screen controls, and the final desktop/mobile layout require the owner's acceptance testing before publication.

Web push, folders, collaborative track administration, thread resolution states, selected-range looping, and Atmos playback are outside the first release.

## Acceptance scenarios

Use focused behavior tests and a small set of end-to-end journeys. These scenarios define important observable outcomes without requiring tests that mirror every implementation detail.

1. An empty installation allows the first passkey administrator registration once, including under concurrent setup attempts. Subsequent registration follows the selected policy.
2. Two uploaders have separate libraries. Installation administrator status alone cannot read another uploader's protected media, comments, or statistics.
3. Two links to the same version show separate comment threads. The owner can view and reply within both contexts without exposing one to the other.
4. A link created at version three with the onward policy cannot see versions one or two, but can see version four when it becomes ready.
5. If version four loses its audio, the same link lands on version three. If version three also has no audio, it does not fall back to hidden version two.
6. Download works only when both link and version permit it and the file exists. Direct requests obey the same rule. New lossless uploads offer WAV from the playback master and cached 320 kbps MP3, with WAV selected by default. Lossy uploads offer MP3 only. Existing uploads retain their original download. Failed encoding must not expose a partial export.
7. A new version becomes visible after processing succeeds. A failed upload or replacement does not disrupt the last valid playable file.
8. Replacing an older version does not make it latest. A version with comments rejects unequal duration and keeps its threads and combined analytics after a valid replacement.
9. A listener can delete a comment only with its ownership credential. A matching display name or analytics identifier is insufficient. The track owner can moderate all of that track's comments.
10. Deleting a comment with later replies preserves `deleted`; deleting a final comment or an unanswered opening comment removes it from the visible conversation.
11. Removing track audio preserves metadata, comments, analytics, and link URLs. A request to upload again reaches the owner, and restoring audio revives eligible links.
12. An inactive link displays neutral information and denies protected media and comment access, including after metadata or audio restoration.
13. A session with forward and backward seeks yields the correct played intervals, listening time, and unique coverage. Visits and preloads do not count as plays. Authenticated owner playback is excluded.
14. The browser identifier and any provided name associate listening activity without being presented as verified people or physical devices. Download activity appears in the appropriate link and version context.
15. Mobile and desktop users can choose versions, seek and zoom the waveform, comment on points and ranges, use repeat, and control background playback where platform support permits.
16. Restarting or recreating containers preserves accounts, metadata, analytics, and files. A worker restart can recover queued work without publishing duplicate versions.
17. The production build uses React Compiler. Relevant lint, type checking, build, authorization, media processing, and browser checks pass before a release is considered usable.
18. A successful registration consumes its invitation. Expired, revoked, and already-used invitations cannot create accounts; unsuccessful registration does not consume an otherwise valid invitation.
19. First playback, whole-track repeat, and playback of another version each increment the play counter. Pause and resume, seeking, and a version change while paused do not.
20. Owner feedback defaults to the selected version across all links. Choosing all versions includes older threads, and filtering by link narrows either view. Replying preserves the thread's original context. Missing audio prevents seeking but not reading or replying.

## Technical references

- [React Router deployment](https://reactrouter.com/start/framework/deploying) includes Node, Docker, and PostgreSQL deployment patterns.
- [React Compiler installation](https://react.dev/learn/react-compiler/installation) describes React Router integration, linting, and setup verification.
- [Drizzle](https://orm.drizzle.team/docs/overview) provides TypeScript schema definitions and database migration tooling.
- [SimpleWebAuthn](https://simplewebauthn.dev/docs/) provides browser and server WebAuthn libraries.
- [pg-boss](https://github.com/timgit/pg-boss) provides PostgreSQL-backed background jobs for Node.js.
- [FFmpeg EBU R128 analysis](https://ffmpeg.org/ffmpeg-filters.html#ebur128) documents loudness measurements.
- [wavesurfer.js](https://wavesurfer.xyz/) provides waveform controls; its [streaming guidance](https://wavesurfer.pages.dev/docs/) describes precomputed peaks and duration.
- [Media Session actions](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler) define browser integration with media controls.
- [Apple Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) describe platform requirements for a future notification feature.
- [GNU AGPL version 3](https://choosealicense.com/licenses/agpl-3.0/) describes the selected source-availability obligations.

## Initial release-feature implementation decisions

The first implementation uses the proposed private draft, preview, manual publish/unpublish workflow. Publishing requires artwork and at least one named track; audio and the remaining metadata are optional. Published metadata edits take effect when saved. Artist and release slugs are set at creation, with explicit validation and readable alternatives required for collisions; changing names does not change URLs. Explicit URL renaming/redirect management remains deferred.

Release playback uses mono/stereo AAC at a target of 256 kbit/s in M4A files. WAV masters remain unchanged. Artwork is normalized to PNG at up to 2000 pixels per side and included in every ZIP. Downloads stream directly rather than assembling entire albums in memory. Each request requires an email submission and is recorded, including owner download requests; authenticated owner visits and plays are excluded from public statistics. Download addresses are not verified or subscribed to a mailing list.

The initial statistics view counts release-page visits, actual per-track playback starts, external-link clicks and download requests. Pause/resume is not a new play; replaying after the end is. Event IDs deduplicate duplicate submissions. Artist-page view counts, detailed listening telemetry, CSV export, address-retention tooling and explicit slug changes are outside this implementation. The existing work-in-progress analytics remain unchanged.
