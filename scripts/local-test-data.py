#!/usr/bin/env python3
"""Capture production content read-only, or reset the isolated local UI preview."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'local-preview'
BASE = DATA / 'baseline'
DB = 'wavecase-ui-preview-db-1'
WEB = 'wavecase-ui-preview-web-1'
WORKER = 'wavecase-ui-preview-worker-1'
PROD = 'wavecase-prod-db-1'
CONTENT = ['tracks', 'versions', 'artists', 'releases', 'release_tracks']
EXCLUDE = ['sessions', 'passkeys', 'challenges', 'invitations', 'recoveries',
           'links', 'comments', 'events', 'reupload_requests', 'release_events']


def checksum(handle):
    digest = hashlib.sha256()
    for block in iter(lambda: handle.read(1024 * 1024), b''):
        digest.update(block)
    return digest.hexdigest()


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def sql(container, database, query):
    return run('docker', 'exec', '-i', container, 'psql', '-X', '-U', 'wavecase',
               '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', input=query.encode(),
               stdout=subprocess.PIPE).stdout.decode().strip()


def dump(container, database, *extra):
    return run('docker', 'exec', container, 'pg_dump', '-U', 'wavecase',
               '--no-owner', '--no-privileges', *extra, database,
               stdout=subprocess.PIPE).stdout


def restore(database, contents):
    run('docker', 'exec', '-i', DB, 'pg_restore', '-U', 'wavecase', '-d', database,
        '--no-owner', '--no-privileges', '--exit-on-error', input=contents)


def fingerprint():
    return sql(PROD, 'wavecase', '\n'.join(
        f'SELECT md5(coalesce(json_agg(t ORDER BY id)::text, \'[]\')) FROM {table} t;'
        for table in CONTENT))


def capture():
    if BASE.exists():
        raise SystemExit('Baseline already exists; keep it stable. Archive/rename it before capturing a new one.')
    pending = sql(PROD, 'wavecase', 'SELECT (SELECT count(*) FROM versions WHERE "pendingOriginal" IS NOT NULL) + (SELECT count(*) FROM release_tracks WHERE "pendingOriginal" IS NOT NULL);')
    if pending != '0':
        raise SystemExit('Production is processing audio. Retry after uploads finish.')
    if sql(PROD, 'wavecase', 'SELECT count(*) FROM users;') != '1':
        raise SystemExit('This local preview seed supports one owner; review ownership before copying multiple accounts.')
    work = DATA / ('capture-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    work.mkdir(mode=0o700)
    before = fingerprint()
    raw = dump(PROD, 'wavecase', '-Fc', '-n', 'public', '-n', 'drizzle',
               *[f'--exclude-table-data=public.{table}' for table in EXCLUDE])
    sql(DB, 'postgres', 'CREATE DATABASE wavecase_seed;')
    try:
        sql(DB, 'wavecase_seed', 'DROP SCHEMA public;')
        restore('wavecase_seed', raw)
        sql(DB, 'wavecase_seed', "UPDATE users SET name='Preview owner', email='preview@example.test', admin=true, disabled=false; UPDATE settings SET \"openRegistration\"=false;")
        (work / 'database.dump').write_bytes(dump(DB, 'wavecase_seed', '-Fc', '-n', 'public', '-n', 'drizzle'))
        with (work / 'audio.tar').open('wb') as out:
            run('docker', 'exec', 'wavecase-prod-web-1', 'tar', '-cf', '-', '-C', '/data/audio', '.', stdout=out)
        if fingerprint() != before:
            raise SystemExit(f'Production content changed during capture. Partial copy kept at {work}; retry capture.')
        references = sql(DB, 'wavecase_seed', ' UNION '.join([
            'SELECT cover AS path FROM tracks', 'SELECT original FROM versions',
            'SELECT playback FROM versions', 'SELECT image FROM artists',
            'SELECT cover FROM releases', 'SELECT original FROM release_tracks',
            'SELECT playback FROM release_tracks']) + ';').splitlines()
        with tarfile.open(work / 'audio.tar') as archive:
            names = {m.name.removeprefix('./') for m in archive if m.isfile()}
        if any(path and path not in names for path in references):
            raise SystemExit('Snapshot is missing referenced media; do not use this copy.')
        manifest = {'captured_utc': datetime.now(timezone.utc).isoformat(),
                    'excluded_table_data': EXCLUDE, 'source': 'wavecase-prod',
                    'content_fingerprint': before, 'files': {}}
        for name in ['database.dump', 'audio.tar']:
            with (work / name).open('rb') as handle:
                manifest['files'][name] = checksum(handle)
        (work / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        work.rename(BASE)
        print(f'Baseline saved: {BASE}')
    finally:
        sql(DB, 'postgres', 'DROP DATABASE wavecase_seed WITH (FORCE);')


def reset():
    manifest = json.loads((BASE / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        with (BASE / name).open('rb') as handle:
            if checksum(handle) != expected:
                raise SystemExit('Baseline checksum mismatch; refusing reset.')
    user = sql(DB, 'wavecase', 'SELECT id FROM users;')
    uuid.UUID(user)  # Exactly one existing local account, never a guessed owner.
    run('docker', 'stop', WEB, WORKER, stdout=subprocess.DEVNULL)
    backup = DATA / ('before-reset-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    try:
        (backup / 'database.dump').write_bytes(dump(DB, 'wavecase', '-Fc'))
        auth = dump(DB, 'wavecase', '--data-only', '-t', 'users', '-t', 'passkeys', '-t', 'sessions')
        with (backup / 'audio.tar').open('wb') as out:
            run('docker', 'run', '--rm', '--network', 'none', '-v',
                'wavecase-ui-preview_preview-audio:/data/audio:ro', '--entrypoint', 'tar',
                'wavecase-ui-preview-web', '-cf', '-', '-C', '/data/audio', '.', stdout=out)
        sql(DB, 'wavecase', 'SET client_min_messages=warning; DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE;')
        restore('wavecase', (BASE / 'database.dump').read_bytes())
        run('docker', 'exec', '-i', DB, 'psql', '-X', '-U', 'wavecase', '-d', 'wavecase',
            '-v', 'ON_ERROR_STOP=1', input=auth, stdout=subprocess.DEVNULL)
        sql(DB, 'wavecase', f'''BEGIN;
UPDATE tracks SET "ownerId"='{user}';
UPDATE artists SET "ownerId"='{user}';
DELETE FROM users WHERE id <> '{user}';
COMMIT;''')
        with (BASE / 'audio.tar').open('rb') as inp:
            run('docker', 'run', '--rm', '-i', '--network', 'none', '-v',
                'wavecase-ui-preview_preview-audio:/data/audio', '--entrypoint', 'sh',
                'wavecase-ui-preview-web', '-c',
                'find /data/audio -mindepth 1 -delete && tar -xf - -C /data/audio', stdin=inp)
    except BaseException:
        print(f'Reset failed. Preview stays stopped; previous complete data is saved at {backup}.')
        raise
    run('docker', 'start', WEB, stdout=subprocess.DEVNULL)
    for _ in range(45):
        status = run('docker', 'inspect', '--format', '{{.State.Health.Status}}', WEB, stdout=subprocess.PIPE).stdout.strip()
        if status == b'healthy':
            break
        time.sleep(1)
    else:
        raise SystemExit(f'Web did not become healthy. Worker stays stopped; backup: {backup}')
    run('docker', 'start', WORKER, stdout=subprocess.DEVNULL)
    print(f'Preview reset. Local account preserved. Previous state: {backup}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['capture', 'reset'])
    args = parser.parse_args()
    os.umask(0o077)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    {'capture': capture, 'reset': reset}[args.action]()
