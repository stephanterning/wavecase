# Specification review and fixes — October 30, 2026

## Follow-up status

All nine reported implementation defects/gaps have been addressed, together with the invitation and version-status discrepancies. The waveform storage discrepancy was resolved by explicitly documenting PostgreSQL storage for peaks: this keeps publication atomic and includes peaks in the database backup without adding another file lifecycle. The original review below is retained as historical evidence, not the current task list.

| Finding | Resolution and verification |
| --- | --- |
| 1. Onward visibility | Creation anchors to the latest published ready-or-missing version. Without a published version, the restricted action returns an error rather than creating an all-versions link. Route integration covers missing audio, later versions, no-ready versions, and no versions. |
| 2. Version settings | The settings section remounts for each version. Browser verification switched from a finished/download-enabled version to an early-idea/download-disabled version and confirmed both correct values. |
| 3. Name association | The comment composer supplies the existing browser ID, independently of the deletion secret. Verified through the actual browser composer and database: earlier visits and listening intervals acquired the name. Cross-link isolation is covered by integration tests. Owner replies no longer overwrite the browser's saved listener name. |
| 4. Delayed telemetry | Accumulated intervals split into at most 30 seconds. Transient failures retry while the page remains alive, using stable event IDs and server deduplication. Tests cover a delayed 45-second interval, HTTP 503 retry, and duplicate submission. |
| 5. Format compatibility | Direct playback checks codec and container together and provides the correct MIME type. CAF receives a genuine WAV derivative. A lower-rate CAF fixture preserves its original and sample rate; an actual browser upload was processed and played successfully. |
| 6. Analytics views | Added link/browser filters and summaries, first/latest activity, visitor details, version heatmaps/coverage, ordered graphical session timelines, and original-download details. Timeline aggregation has a regression test; desktop and 390-pixel browser layouts were checked, including a link with zero activity. |
| 7. Referral attribution | Captures the available incoming document referrer, retaining only its website origin in the share session. Private paths and tokens are discarded; outgoing `no-referrer` protection remains. Sanitization is tested. |
| 8. Visits | Recorded once by the share-page component, independently of player mounts. A new link-level route and nullable event version ID support pages without any versions or audio. Integration covers owner exclusion, missing versions, inactive links, and deletion of link-level statistics. Browser version switching produced one visit, not one per version. |
| 9. Reupload requests | Store an optional saved listener name and acknowledge success. Verified in the browser and database using a missing-audio page. |
| Invitation consumption | Supplied invitations are validated and consumed even when registration is open. Signed-registration tests cover successful use, reuse rejection, failed enrollment retaining the invitation, expiration, and revocation. |
| Version status | Upload forms offer all four statuses and the listener selector displays musical status separately from missing/processing state. Browser CAF upload inferred `v3.1` and published with the selected `almost finished` status. |
| Waveform storage | Specification now explicitly records peaks in PostgreSQL and originals/derivatives in the mounted file directory. Both remain externally persistent. |

## Follow-up verification

- Lint, TypeScript, production build, and all 18 tests pass with the isolated database; no integration cases are skipped in that run.
- Setup test now submits competing signed registrations concurrently and verifies exactly one succeeds.
- Worker integration covers unequal-duration rejection, preserving valid audio, and a queued replacement processed after a worker process restart without creating another version.
- Browser checks used disposable accounts and synthetic audio in `wavecase_test` on a separate localhost port. They covered owner feedback filters, replying in a different version's original link context, version-form values, actual playback, position/play-state preservation, timestamp comments, name attribution, CAF upload/publication, repeat, missing-audio requests, analytics filters and a narrow layout.
- Actual repeat playback produced seven completed cycles and eight starts before pausing. Synthetic count/coverage tests also pass.
- The temporary browser service, account fixtures and audio were removed. The normal installation was not used for test accounts. Nothing has been committed or pushed.

Native passkey prompts and recovery on the owner's devices, iPhone uploads/background/lock-screen behavior, broader real-world audio fixtures, and the owner's complete acceptance walkthrough remain necessary. The process restart test covers queued work, not a forced machine crash during encoding. Browser termination can still lose unacknowledged telemetry; retries are intentionally page-local rather than an offline sync subsystem.

## Original review (before fixes)

The following findings and coverage table describe the pre-fix implementation.

## Priority findings

### 1. High: onward links can expose earlier versions

Location: `app/routes/track.tsx:71–80`.

Creating a “Latest and future versions” link finds the newest **ready** version, rather than preserving the latest published version as its fixed boundary. If v2 has had its audio removed while v1 remains ready, the new link includes v1. Missing audio is supposed to affect the default playable selection, not broaden visibility. If no ready version exists, the boundary becomes null and the link behaves as “All versions.”

Reproduced against the production server route modules and isolated database: create v1 ready and v2 missing, create an onward link, and load its public page. The returned version list is `v2, v1`.

Choose and validate the visibility boundary independently of playback availability. Never silently turn a requested restricted link into an unrestricted one. Add a focused test through link creation, rather than testing only a manually seeded boundary.

### 2. High: version settings can submit values from another version

Location: `app/routes/track.tsx:272–305`.

The version settings form stays mounted when the selected version changes. Its hidden version ID updates, but its inputs use `defaultValue` and `defaultChecked`. In particular, React does not update an already mounted uncontrolled select's selection when its default value changes. Edited input values can also remain from the previous version.

For example, open a finished version, switch to a work-in-progress version, and save its settings: the status control can still submit “finished.” A previously changed download checkbox can similarly be submitted for the wrong version. This can overwrite metadata or enable downloads unintentionally when the link also permits them.

This is a source-confirmed lifecycle problem, not a completed browser reproduction. Reset the settings form when its version ID changes, or control the editable state by version. Verify two versions with different statuses and download permissions in a browser.

### 3. Medium: commenting does not associate earlier listening with the name

Locations: `app/components/feedback.tsx:109–116`; `app/routes/feedback.ts:147–156`.

The server updates earlier events only when the comment request includes `browser`. The actual composer omits that field. Future playback events can carry the newly saved name, but previous activity stays unnamed; a listener who comments after finishing can therefore remain unnamed in analytics.

Reproduced by recording an unnamed play and submitting the same payload shape as the interface. The stored event name remains null. Include the existing browser identifier in the comment request; keep it separate from the comment deletion secret.

### 4. Medium: delayed telemetry can discard substantial listening time

Locations: `app/components/listening.ts:34–50, 100–118`; `app/routes/events.ts:28–34`.

The client periodically flushes one accumulated interval. If timers are delayed while playback progresses, that interval can exceed 30 seconds. The server rejects intervals longer than 30 seconds, while the client resets its interval and ignores HTTP failure statuses.

A controlled simulation with 45 seconds of playback and a delayed timer produced an interval from 0 to 45. Sending it to the actual server action returned `400 Invalid interval`. This demonstrates a client/server mismatch; it does not establish how often a particular phone throttles timers.

Handle accumulated intervals within the server's accepted bounds and retain/report failed submissions appropriately. Add a delayed-timer regression case. Actual iPhone background behavior still needs device testing.

### 5. Medium: playback compatibility ignores the source container

Locations: `app/server/audio-policy.ts:8–26`; `app/server/audio.ts:42–46, 135–147`.

The decision to serve an original directly considers codec and resolution but not its container. Some supported uploads are consequently published unchanged with an incorrect MIME type instead of receiving a compatible playback derivative.

Reproduced with a mono 16-bit, 44.1 kHz PCM CAF fixture: processing returned `source.caf` as playback with MIME type `audio/wav`; the file header remained `caff`. This is not a WAV file. The same general issue affects container/codec combinations treated as interchangeable by the current policy.

Make direct-play eligibility depend on both container and codec. Generate a compatible derivative for other supported inputs while preserving the original for download. Test representative supported combinations; do not infer browser support from FFmpeg decoding success.

### 6. Medium: analytics does not yet provide the specified views

Location: `app/routes/analytics.tsx:27–124`.

The page currently provides track-wide play/browser/listening totals, per-version aggregate heatmaps and coverage, and expandable sessions containing raw event lines. Session summaries include the link label, browser ID and an available name.

Missing presentation includes:

- Summaries organized by share link and browser, including visits, plays and listening time.
- First/latest activity summaries and a usable session timeline showing listened and skipped passages.
- Visitor context: IP, approximate location, operating system, browser and device details. Some of these fields are stored, but none are rendered.
- A download activity presentation with version, time and visitor context; download starts currently appear only as raw events.

Build these from the existing events where possible. No additional analytics infrastructure is necessary to close these interface gaps.

### 7. Medium: referral attribution reads the wrong request

Locations: `app/server/visitor.ts:26`; `app/root.tsx:17`; `scripts/serve.ts:11`; `app/components/listening.ts:38–45`.

Visitor context reads `Referer` from telemetry and media requests, not the incoming share-page navigation. The application uses `no-referrer`, so its browser requests do not supply that header. The client also does not send the incoming page referrer. As a result, a referring website available on arrival is not retained.

Capture available incoming attribution separately, without weakening the policy that prevents secret share URLs from leaking to external websites. Keep unavailable attribution unknown.

### 8. Medium: visits are tied to player creation

Locations: `app/components/listening.ts:119`; `app/components/player.tsx:63`; `app/routes/track.tsx:198–213`.

A visit event is sent whenever the player mounts. Switching versions remounts it and records another visit. A share page with no playable version mounts no player and records no visit at all. These events cannot accurately represent link visits as specified.

Record a visit at the share-page visit boundary, independently of playback and version changes. Keep playback events scoped to their version.

### 9. Low: reupload requests omit known listener names and acknowledgement

Locations: `app/routes/share.tsx:14–18`; `app/routes/track.tsx:143–161`.

The request is stored and appears for the owner, but the action never receives or stores the name saved in the listener's browser. Although it returns `requested: true`, the page does not consume that result to show confirmation. The owner sees the link label only.

Send the optional existing name and show a short success acknowledgement. Keep requests simple; a separate notification system is unnecessary.

## Additional specification discrepancies

- **Invitation consumption with open registration:** `app/server/auth.ts:171–185` consumes invitations only while invitation-only registration is enabled. Registering through an invitation while registration is open leaves it unused. The specification describes supplied invitations as single-use. Validate and consume a supplied invitation on successful account creation independently of whether one is required. This path was identified by source review; it is not covered by the current integration test.
- **Version status presentation:** the listener's version selector displays processing state such as `ready`, not the musical status such as `almost finished` (`app/routes/track.tsx:175`). Musical status is editable later in owner settings, but cannot be chosen during upload. The field exists; its listener-facing presentation and initial upload controls remain incomplete.
- **Waveform storage:** peaks are stored in PostgreSQL JSON, whereas the architecture section specifies waveform files in the mounted data directory. Persistence still exists through the database volume. Keeping the current simpler storage design may be reasonable, but the specification should explicitly record that decision rather than claim exact architectural conformance.

## Acceptance scenario coverage

“Implemented” below means the relevant path exists in source; it does not mean every combination has passed browser acceptance testing. Scenario numbers refer to `wavecase-specification.md`.

| Scenario | Review result |
| --- | --- |
| 1. First setup and registration policy | Implemented; signed registration and closure tested. Competing prepared challenges are verified sequentially in the test, so simultaneous verification remains untested. |
| 2. Owner isolation | Core authorization passes integration tests, including another administrator. Full UI journey remains untested. |
| 3. Link-scoped threads and owner replies | Implemented; server boundary checks tested. Owner/listener UI exchange still needs a browser test. |
| 4. Onward link visibility | Incomplete: link creation has finding 1. Tests currently seed a correct boundary directly. |
| 5. Missing-audio fallback | Loader respects a correctly stored boundary. Creation can store the wrong boundary; see finding 1. |
| 6. Original downloads and permissions | Core direct-request gating and range handling tested. Full browser download workflow remains untested. |
| 7. Publication and failed replacement | Worker integration passes for the tested WAV path. Format compatibility has finding 5. |
| 8. Replacement order, duration and retained history | Implemented; unequal replacement preserves valid audio in the worker test. Full restore/history journey remains untested. |
| 9. Comment ownership and moderation | Server ownership checks tested. Real local-storage loss and multi-browser interaction remain untested. |
| 10. Comment deletion | Placeholder and deletion paths exist; current tests cover a subset of thread shapes. |
| 11. Removal, requests and restoration | Implemented in source; request name/acknowledgement incomplete. Full journey remains untested. |
| 12. Inactive links | Server denial and revoked-link conditional media requests tested. Live player revocation remains a browser check. |
| 13. Listening intervals and owner exclusion | Normal-path interval/count tests pass. Delayed intervals and visits have findings 4 and 8; views have finding 6. |
| 14. Names and download attribution | Incomplete: findings 3, 6 and 7. |
| 15. Desktop/mobile playback and comments | Controls exist. Authenticated desktop, mobile upload, real audio, background and lock-screen journeys remain unverified. Version settings also have finding 2. |
| 16. Persistence and worker restart | Host mounts and durable jobs exist. Current worker test does not interrupt a worker mid-job or recreate the installation. |
| 17. Compiler and release checks | Compiler runtime present in production output; lint, type checking and build pass. Browser acceptance is outstanding, so release acceptance is not complete. |
| 18. Invitation lifecycle | Invitation consumption tested in closed registration. Open-registration behavior differs as noted above; expiration/revocation coverage is incomplete. |
| 19. Play counting | Synthetic media-event test passes normal start/resume/restart/repeat/seek cases. Actual browser version switching and repeat remain unverified. |
| 20. Owner feedback filters | Selected version default, all-version mode, link filter, thread context and missing-audio seek disabling exist. End-to-end UI verification remains outstanding. |

## Verification performed during this review

- `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- Local `npm test`: 9 passed; 3 database-dependent cases skipped as designed.
- Rebuilt the Docker web image and ran migrations/tests against `wavecase_test`: all 12 passed, none skipped.
- Additional temporary reproductions confirmed findings 1, 3, 4 and 5. The added database fixtures and temporary audio were removed.
- Findings 2 and 6–9 and the additional discrepancies are based on source review. No complete authenticated browser journey was performed during this review.

## Recommended order

Fix access boundaries and version-form state first. Then repair attribution and interval collection, correct format compatibility, and complete the requested analytics presentation. Close the smaller request/status/invitation gaps and run targeted regressions before the owner's full walkthrough. Native passkeys, actual listening and phone behavior remain necessary acceptance tests after those corrections.
