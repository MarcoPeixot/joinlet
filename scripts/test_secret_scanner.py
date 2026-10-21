"""Integration regression: repository config, ignore files and comments cannot hide a fake token."""
import argparse
import importlib.util
from pathlib import Path
import secrets
import subprocess
import tempfile
import unittest

SCANNER = None
spec = importlib.util.spec_from_file_location('secret_scan', Path(__file__).with_name('check-secrets.py'))
scanner_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner_module)


class ScannerBoundaryTests(unittest.TestCase):
    def setUp(self):
        if SCANNER is None:
            self.skipTest('Run this integration suite with the checksum-verified Gitleaks binary argument.')

    def test_repository_suppressions_cannot_hide_synthetic_credential(self):
        with tempfile.TemporaryDirectory(prefix='joinlet-scanner-test-') as temp:
            repo = Path(temp)
            (repo / 'token.txt').write_text('token = ghp_' + secrets.token_hex(18) + ' # gitleaks:allow\n')
            (repo / '.gitleaks.toml').write_text("[extend]\nuseDefault = true\n[allowlist]\npaths = ['''.*''']\n")
            (repo / '.gitleaksignore').write_text('token.txt:github-pat:1\n')
            self.assertEqual(scanner_module.scan(SCANNER, repo, 'dir'), 1)

    def test_clean_source_passes_and_git_history_is_checked(self):
        with tempfile.TemporaryDirectory(prefix='joinlet-scanner-history-') as temp:
            repo = Path(temp)
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            (repo / 'README.md').write_text('Synthetic scanner regression test.\n')
            self.assertEqual(scanner_module.scan(SCANNER, repo, 'dir'), 0)
            (repo / 'token.txt').write_text('token = ghp_' + secrets.token_hex(18) + '\n')
            subprocess.run(['git', '-C', str(repo), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Scanner Test', '-c', 'user.email=scanner@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic test input'], check=True)
            (repo / 'token.txt').unlink()
            subprocess.run(['git', '-C', str(repo), 'add', '-u'], check=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Scanner Test', '-c', 'user.email=scanner@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Remove test input'], check=True)
            self.assertEqual(scanner_module.scan(SCANNER, repo, 'git'), 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scanner', type=Path)
    args, remaining = parser.parse_known_args()
    SCANNER = args.scanner.resolve(strict=True)
    unittest.main(argv=[__file__, *remaining])
