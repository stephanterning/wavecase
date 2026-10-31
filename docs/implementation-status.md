# Implementation status

This describes the implementation as of October 31, 2026. The repository includes both private demos and public releases, Docker packaging, and CI image publishing. Device acceptance remains separate from automated verification.

## Available

- Passkey setup/sign-in, invitations, multiple passkeys, account disablement, and administrator/server recovery.
- Private libraries with versions, linked artist profiles, named share links, waveform feedback, audio replacement/restoration, and owner-only listening analytics.
- Demo processing with a 24-bit/48 kHz ceiling, playback loudness normalization, and email-gated WAV/MP3 ZIP downloads for new and legacy uploads (WAV only for uncompressed/lossless sources).
- Multiple artist profiles, draft/published singles/EPs/albums, generated songwriter pages, credits, service links, original-WAV or cached 320 kbps MP3 ZIPs, and release statistics.
- One release player across public artist, songwriter, and release pages, including queue progression, Space controls, normalization, and media-session metadata.
- Durable processing jobs, database migrations, persistent files, and tested image publishing for amd64/arm64.

The [specification](wavecase-specification.md) defines the behavior; [operations](operations.md) and [testing](testing.md) explain how to run and verify it. Earlier review findings and per-change test logs remain in Git/PR history rather than being maintained as current instructions.

## Limits and remaining acceptance

- Native passkey enrollment/recovery, actual sound quality, iPhone uploads, repeated waveform gestures, background playback, interruptions, and lock-screen controls need real-device checks. A narrow desktop viewport or mocked Media Session test does not establish these.
- Complete the owner's workflow with representative music/artwork and a backup/restore exercise before relying on an installation. Worker tests cover queued work across a process restart, not arbitrary machine crashes during encoding.
- Demo telemetry retries temporary failures while its page is alive; closing the page can lose unacknowledged events. Browser IDs and names do not identify verified people, and downloads record requests rather than confirmed completion.
- Clearing browser storage loses local names, unread markers, and listener comment-deletion credentials. Download emails are self-reported; demo addresses are removed by clearing that track's analytics. Release analytics have no deletion/retention UI or automatic expiry.
- Optional location requires a local MMDB file. Filesystem cleanup failures may leave unreferenced files; access still depends on database authorization. Already delivered media cannot be recalled.
- Web push, folders, shared track administration, thread editing/resolution, range looping, Atmos, demo-to-release conversion, slug changes/redirects, artist-page analytics, and CSV export are outside the current scope.
