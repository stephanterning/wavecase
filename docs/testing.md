# Local testing

No implementation changes should be pushed before the owner has tested them.

## Automated checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The default tests exercise audio conversion, exact duration comparison, interval coverage, and cross-origin rejection. Database-dependent tests are explicitly skipped without an isolated test database.

With the Compose database running, create the test database once:

```sh
docker compose exec db createdb -U wavecase wavecase_test
```

Build the current image and run its integration tests:

```sh
docker compose build
docker compose run --rm --no-deps web sh -c 'export DATABASE_URL="${DATABASE_URL%/wavecase}/wavecase_test"; npm run db:migrate && npm test'
```

The integration suite creates synthetic accounts and media in `wavecase_test`. It verifies signed WebAuthn registration/authentication, setup closure, challenge replay rejection, invitation consumption, owner isolation, version visibility, comment isolation, and background audio replacement. It never uses the normal installation database. Test audio is created in temporary directories and removed after testing.

## Owner walkthrough

1. Open `http://localhost:3000`, create your first administrator account with a passkey, and select invitation-only registration. Sign out and back in.
2. Create a track from a WAV file. Confirm the suggested title, version label, processing state, player, waveform, and measurements. Try a high-resolution WAV and a lower-quality MP3.
3. Upload a second version. Change labels, descriptions, status, and download permissions. Switch versions while playing and paused. Try repeat, Space to play/pause, wheel zoom, and right-button range selection in both directions.
4. Create two differently named links. Use a private browser window for listener testing so owner playback is not excluded. Check each link's version range and original download permissions.
5. Comment under a chosen name, add replies from both sides, filter owner feedback by version and link, navigate from a timestamp, and delete your own comments. Confirm other links cannot see those threads.
6. Listen, seek forward/back, and repeat a passage. Inspect listening activity, session details, coverage, and heatmaps. Location requires an optional configured MMDB file; unavailable information should remain unknown.
7. Disable a link and verify its public page becomes neutral and direct media access fails. Re-enable it and verify its previous comments remain.
8. Replace a commented version with an unequal-duration file and confirm rejection preserves the existing playable file. Replace it with an equal-duration file and confirm comments remain. Remove audio, request reupload as a listener, and restore the version.
9. Add a second passkey. Create an invitation, register a second account, and verify private library separation. Test account disablement and recovery with a disposable second account before relying on recovery for your main account.
10. Restart the containers and verify metadata, comments and audio remain. Test a worker restart during processing.

Use HTTPS with the configured `APP_URL` for phone testing. Check upload, playback, comments, background audio, lock-screen controls, and narrow-screen layout in Safari on the iPhone. Native passkey prompts, actual audio output, and mobile background behavior need this manual device verification even when server tests pass.

## Review regressions to include in the owner walkthrough

- Create an onward link after the newest version loses its audio. Older versions must remain hidden. Creating that policy before any version is published must show a clear error.
- Switch between versions with different statuses and download settings. The settings form must reflect the selected version, including after changing an unsaved field on the previous version.
- Listen before entering a name, then comment. Earlier activity through that link must acquire the name. Changing versions must not add another visit; revisiting the page should.
- Inspect link/browser summaries, session timelines, visitor context and download details. An unused link should show zero activity. Unknown location or referrer must remain unknown.
- Request reupload after commenting under a name. Check the listener confirmation and the name in the owner's request item.
- Upload a CAF source and choose a musical status. Check the inferred version label, automatic publication, correct status and playable WAV derivative. The same WAV master must serve playback and WAV download, and the CAF upload must be removed only after publication succeeds.

The follow-up browser checks used an isolated local test service with synthetic audio and temporary authenticated test sessions. They did not exercise native passkey enrollment or simulate an iPhone operating system. Do not substitute the narrow desktop viewport check for real phone testing.

## Player and comment interaction checks

- Space toggles playback even when a non-input control has focus; typing spaces in the comment modal must not affect playback.
- Add comment opens a modal with no time inputs. Right-clicking the waveform opens a point comment with a start time. Drag the right mouse button in either direction to create a range with ordered start/end times, including after zooming and panning.
- On a phone, pinch to zoom. A touch hold selects a point; hold then drag to select a range. Pinch or a cancelled pointer must not accidentally open a comment. Check these gestures on a real device, not just a narrow desktop viewport.
- Escape/cancel dismisses the modal and restores focus. Successful submission closes it and displays the new thread. Replies also use a modal and keep their original link/version context.
- Confirm the player has custom play/pause and elapsed/total time, a repeat icon toggle and tooltip, and a separate download icon. No native audio controls, restart button, or zoom slider should remain.


## Audio ceiling and download formats

- Upload 32-bit/96 kHz PCM: playback and WAV download must use one 24-bit/48 kHz master. Verify triangular dither at the 24-bit quantizer. Upload 32-bit/44.1 kHz and 16-bit/96 kHz to verify that the two ceiling limits work independently.
- Upload WAV, AIFF, FLAC and ALAC. Open Download audio: WAV is selected, selecting MP3 deselects WAV, and both outputs have the expected extension and content type. Lossy MP3/AAC sources offer MP3 only, including when a compatible playback WAV was necessary.
- The first MP3 request may wait for encoding; subsequent requests reuse the same 320 kbps file. Concurrent requests share one encoding. Range and HEAD requests work, and do not add duplicate start events for continuation/HEAD requests.
- Disable downloads or deactivate the link and check direct WAV/MP3 URLs, including cached MP3. Failed MP3 conversion must leave no partial download and allow retry.
- Replace or remove audio and verify removal of its cached MP3. A rejected replacement keeps the active master and cached export. Existing published audio keeps its previous playback and original download behavior.
- On desktop and phone, check dialog focus, Escape/close, Space activation of dialog buttons without triggering playback, mutually exclusive radios, and actual downloaded files. Real Safari/iPhone audio output remains a device acceptance check.

Validation for the audio ceiling change: all 34 tests passed in the Docker image against `wavecase_test`, including real FFmpeg conversion and worker tests. Lint, TypeScript and production builds passed. Browser checks confirmed the default WAV choice, mutually exclusive format radios, MP3-only choices for lossy sources, Escape/focus restoration, and an actual downloaded MP3 verified as 320 kbps at 48 kHz. The dialog was visually checked in a narrow browser viewport; this does not replace real iPhone playback testing.

## Release feature walkthrough

The `tests/releases.test.ts` suite checks readable addresses and safe external links, unchanged masters with AAC derivatives, private draft and owner isolation (including another administrator), publication, audio range delivery, coupled audio access, email syntax gating, full/individual ZIP contents, partial-track disclosures, recorded addresses, event deduplication, artist listings and unpublishing. ZIP tests compare extracted WAV bytes to the original upload and inspect artwork and `release-info.txt`. Database scenarios use only `wavecase_test`.

1. Open **Artists & releases** from the library. Create two artist profiles and a release under each. Confirm the pages use readable artist/release addresses and remain stable after title edits.
2. Create a draft EP with several named tracks. Add artwork, label, release date, credits, ISRCs and streaming/shop links. Preview while signed in; verify the draft is unavailable in a private browser.
3. Upload a 24-bit/48 kHz PCM WAV for only one track. Wait for processing and enable playback/downloads. Confirm the remaining tracks remain listed without audio. Try a different WAV resolution and verify the displayed format reflects the source.
4. Publish and open the public page signed out. Check the artist's public listing, artwork background, metadata, desktop and mobile layout, full playback and automatic progression between available tracks.
5. Try an invalid email, then a valid-looking unverified address. Download all available tracks and an individual track. Verify original WAV bytes, artwork and `release-info.txt`, including the partial track list. No verification email or account should be required.
6. Check owner statistics for visits, plays, external clicks and requested packages with the submitted addresses. Another account, including an installation administrator, must not access this view.
7. Replace a ready master with an invalid file. Confirm the error is shown and the existing audio remains usable. Remove audio and verify both playback and download stop for that track. Disable the release audio setting and verify direct audio/download requests fail while the public page remains available.
8. Unpublish: the public release URL and its media become inaccessible to visitors, and the artist listing excludes it. Republish to the same address.

Physical iPhone playback, actual sound quality and the owner's real artwork/masters still require device acceptance testing. Browser automation with a narrow viewport does not replace it.

## Demo artist profile links

`tests/track-artist.test.ts` covers own-account suggestions/matching, explicit selection, rejection of another account's profile ID, ambiguous names, case/whitespace normalization, rename stability, clearing/free text, private and inactive share links, actual rendered artist links, and the migration backfill without reassigning existing links. Public artist listings still contain only releases.

For a manual check, create a demo with a name matching an owned artist, open its share page, and follow the artist link. Rename that artist and reload the demo: the displayed name should update while the link stays stable. Choose **Match by name / free text** to replace or clear the association. Duplicate profile names can be distinguished by their displayed addresses in the profile selector.


## PR 3 review after merging main

The review reproduced and fixed silently shortened conversions from damaged input, destructive clipping of out-of-range floating-point uploads, and the player intercepting Space on dialog buttons. Audio and MP3 encoding now stop on decoder errors; floating-point non-finite or out-of-range samples produce an upload error before publication. Failed replacements retain the current master and MP3 cache. Tests also revoke a link while an authorized MP3 request waits on the encoding lock, verifying that the later permission check denies the transfer.

All 46 tests passed in Docker against `wavecase_test`, with no skipped database scenarios. Lint, type checking and the production image build passed. The merge preserves the separate public release audio/ZIP workflow and both sets of styles and documentation. In the built app, pressing Space on the focused download-dialog close button closes the modal, restores focus to the download trigger, and leaves playback paused at zero.
