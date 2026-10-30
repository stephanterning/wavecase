# Wavecase Product and Technical Specification

Wavecase lets musicians share work in progress, collect feedback on particular versions, and understand listening activity through individually named private links. Uploaders have passkey accounts. Listeners follow a link without creating an account.

The initial personal installation serves one uploader and approximately ten listeners per month. The public open-source project must also support independent installations with multiple uploaders. Application limits must be configurable rather than tied to the initial installation.

This specification captures the product interview through October 30, 2026. Product requirements and the selected stack are recorded below. Proposed implementation defaults and remaining details are explicitly separated from agreed requirements. Implementation is being validated locally; see [implementation status](implementation-status.md).

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

## Library and metadata

The initial library has search and sorting, without folders or shared projects.

| Track field | Requirement |
| --- | --- |
| Title | Required; suggest a title from the upload filename. |
| Artist name | Optional. |
| Cover image | Optional. |
| Description | Optional; shared across versions. |

Each version has its own name, description, upload timestamp, download permission, and status. Version names are user-defined, such as `v1`, `v1.1`, or `v3.2`. Suggest a version name from the filename when recognizable and allow the uploader to correct it. Labels do not determine ordering.

The version status is one of:

- `early idea`
- `work in progress`
- `almost finished`
- `finished`

## Audio and publication

### Upload and playback files

Accept a broad range of audio formats through server-side decoding. The concrete supported set is determined by the shipped FFmpeg build and verified fixtures; an unsupported or invalid file must produce a clear error.

For new uploads and file replacements, cap the stored audio at 24 bit and 48 kHz, limiting each property independently without increasing a lower source bit depth or sample rate. Reduce bit depths above 24 with triangular dithering. Convert uncompressed PCM and recognized lossless sources (including WAV, AIFF, CAF PCM, FLAC, ALAC and APE) to a PCM WAV master when necessary. The same stored master serves playback and WAV downloads; do not retain a separate lower-quality playback copy. Keep an already suitable WAV unchanged. Delete a superseded source upload only after processing, validation and publication succeed.

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

Both uploader and listener views must work on desktop and mobile, including mobile uploads. Use application-styled player controls: play/pause, elapsed/total time, and a repeat icon toggle with a tooltip. Do not expose native browser audio controls, a restart button, a volume control, or a zoom slider. Audio download is an icon with a tooltip outside the playback controls. For newly processed audio it opens the format-selection dialog. Space toggles playback throughout the track page, except in text-entry fields, selects, or modified keyboard shortcuts so typing and native input behavior remain usable.

Render the waveform at 220 pixels high. Its visual amplitude may be normalized for legibility without changing the audio. A regular click/tap seeks. Wheel scrolling over the waveform zooms around the pointer; two-finger pinch zooms around the touch midpoint. Dragging pans a zoomed waveform. Arrow keys seek and plus/minus keys zoom when the waveform has focus. There is no tool for looping a selected interval.

Comment creation and replies use a modal, with no inline feedback form on the listening page. The listener's Add comment button opens a whole-version comment with no time inputs. Right-click or touch-and-hold on the waveform selects a point; releasing opens the modal with its start time filled. Holding the right button (or dragging after a touch hold) selects a range in either direction; releasing opens the modal with ordered start/end times. Pinching cancels a pending long press. Keyboard users can open a point comment with the context-menu key or Shift+F10. The modal retains its original version/thread context, traps focus, supports Escape/cancel, and closes after a successful submission.

Support background playback and lock-screen media controls where supported by the platform. Repeat is controlled from the web player; a repeat command is not available in the standard Media Session action set.

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
