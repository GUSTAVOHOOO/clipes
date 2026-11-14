import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'download.py'


class DownloadTests(unittest.TestCase):
    def test_includes_and_verifies_clip_audio_once_for_multiple_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source.webm').write_bytes(b'source')
            (root / 'clip.webm').write_bytes(b'clip')
            clip = {'url': 'https://example.com/clip', 'file': 'clip.webm',
                    'format': '251', 'sha256': hashlib.sha256(b'clip').hexdigest()}
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'items': [
                {'url': 'https://example.com/source', 'file': 'source.webm',
                 'format': '251', 'sha256': hashlib.sha256(b'source').hexdigest(),
                 'clips': [clip, clip]}]}), encoding='utf-8')
            cmd = [sys.executable, str(SCRIPT), '--manifest', str(manifest),
                   '--directory', str(root), '--include-clips']
            result = subprocess.run(cmd, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(result.stdout.count(b'clip.webm'), 1)
            (root / 'clip.webm').write_bytes(b'changed')
            self.assertNotEqual(subprocess.run(cmd, capture_output=True).returncode, 0)

    def test_verifies_existing_file_and_rejects_modified_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            media = root / 'audio.webm'
            media.write_bytes(b'audio')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'items': [{'url': 'https://example.com/a', 'file': 'audio.webm', 'format': '251', 'sha256': hashlib.sha256(b'audio').hexdigest()}]}), encoding='utf-8')
            cmd = [sys.executable, str(SCRIPT), '--manifest', str(manifest), '--directory', str(root)]
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            media.write_bytes(b'alterado')
            self.assertNotEqual(subprocess.run(cmd, capture_output=True).returncode, 0)

    def test_downloads_missing_file_then_verifies_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake = root / 'yt_dlp'
            fake.mkdir()
            (fake / '__init__.py').write_text('', encoding='utf-8')
            (fake / '__main__.py').write_text("import pathlib,sys\npathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_bytes(b'audio')\n", encoding='utf-8')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'items': [{'url': 'https://example.com/a', 'file': 'audio.webm', 'format': '251', 'sha256': hashlib.sha256(b'audio').hexdigest()}]}), encoding='utf-8')
            env = {**os.environ, 'PYTHONPATH': str(root)}
            cmd = [sys.executable, str(SCRIPT), '--manifest', str(manifest), '--directory', str(root / 'media')]
            result = subprocess.run(cmd, capture_output=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual((root / 'media' / 'audio.webm').read_bytes(), b'audio')


if __name__ == '__main__':
    unittest.main()
