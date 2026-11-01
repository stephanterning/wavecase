"""Exercise reset failure boundaries without Docker or installation data."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'preview', Path(__file__).resolve().parents[1] / 'scripts/local-test-data.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class ResetSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.base = self.data / 'baseline'
        self.base.mkdir()
        manifest = {'files': {}}
        for name in ['database.dump', 'audio.tar']:
            (self.base / name).write_bytes(b'test-only fixture')
            with (self.base / name).open('rb') as handle:
                manifest['files'][name] = preview.checksum(handle)
        (self.base / 'manifest.json').write_text(json.dumps(manifest))
        for name, value in [('DATA', self.data), ('BASE', self.base)]:
            mock = patch.object(preview, name, value)
            mock.start()
            self.addCleanup(mock.stop)

    def test_corrupt_baseline_never_contacts_docker(self):
        (self.base / 'audio.tar').write_bytes(b'corrupted')
        with patch.object(preview, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'checksum mismatch'):
                preview.reset()
            run.assert_not_called()

    def test_missing_checksum_never_contacts_docker(self):
        (self.base / 'manifest.json').write_text('{"files": {}}')
        with patch.object(preview, 'run') as run:
            with self.assertRaises(KeyError):
                preview.reset()
            run.assert_not_called()

    def test_multiple_owners_never_stop_or_modify_preview(self):
        with patch.object(preview, 'sql', return_value='owner1\nowner2'), patch.object(preview, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'exactly one'):
                preview.reset()
            run.assert_not_called()

    def test_failed_backup_does_not_replace_data_or_claim_complete_backup(self):
        output = io.StringIO()
        with patch.object(preview, 'sql', return_value='00000000-0000-4000-8000-000000000001') as sql, patch.object(preview, 'run') as run, patch.object(preview, 'dump', side_effect=subprocess.CalledProcessError(1, 'pg_dump')), contextlib.redirect_stdout(output):
            with self.assertRaises(subprocess.CalledProcessError):
                preview.reset()
            self.assertEqual(sql.call_count, 1)  # Owner check only; no DROP/restore.
            run.assert_called_once_with('docker', 'stop', preview.WEB, preview.WORKER, stdout=subprocess.DEVNULL)
        self.assertIn('Existing preview data is unchanged', output.getvalue())
        self.assertNotIn('previous complete data', output.getvalue())


if __name__ == '__main__':
    unittest.main()
