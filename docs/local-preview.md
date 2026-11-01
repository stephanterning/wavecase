# Local production-based test data

The Mac's `wavecase-ui-preview` Compose project serves the working tree at
http://localhost:3000, bound to loopback. It uses its own named database and audio
volumes, independent of production and staging. Its saved Compose configuration
and environment are in `data/local-preview/` (gitignored).

The stable baseline is in `data/local-preview/baseline/`: a PostgreSQL dump,
`audio.tar`, and a manifest with capture time and SHA-256 checksums. It contains
production tracks, versions, artist profiles, releases, and media. The captured
owner identity is replaced with a placeholder. Production passkeys, sessions,
registration/recovery tokens, private share links, comments, reupload requests,
and listener/download analytics are excluded. Job queues are not copied.
The files still contain real music and metadata; keep this directory local.

## Reset the preview

From the repository root, with Docker running and the preview database started:

```sh
python3 scripts/local-test-data.py reset
```

Reset requires exactly one existing local account. It stops only the preview web
and worker, saves the current database and media under a timestamped
`data/local-preview/before-reset-*` directory, and replaces preview content with
the baseline. The existing local account, passkey and sessions are preserved;
copied content belongs to that account. The web runs pending application
migrations before the worker restarts. Refresh the browser after completion.
Each reset keeps a backup, including media; old backups can be removed manually
when no longer needed. If restoration fails, the preview stays stopped and the
backup path is reported. Never apply these dumps to production.

Start or rebuild the preview after a reboot or code change:

```sh
docker compose -p wavecase-ui-preview --project-directory data/local-preview up --build -d
```

Stop it without removing test data:

```sh
docker compose -p wavecase-ui-preview --project-directory data/local-preview down
```

## Capture a new baseline

The current baseline remains unchanged by resets. To deliberately refresh it,
archive/rename the existing `baseline` directory, then run:

```sh
python3 scripts/local-test-data.py capture
```

Capture reads only from `wavecase-prod-db-1` and `wavecase-prod-web-1`. It does not
stop production. It requires one production account and no pending audio jobs,
checks for content changes during capture, and verifies referenced media exist.
If production content changes, retry after activity finishes. Sanitization uses a
temporary `wavecase_seed` database inside the preview database container, never
production. Partial captures are kept under `capture-*` for inspection; they are
not usable baselines. The tool intentionally supports this Mac's named containers
and one-owner preview, rather than arbitrary environments or multiple accounts.
