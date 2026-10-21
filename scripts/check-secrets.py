#!/usr/bin/env python3
"""Run the verified Gitleaks binary without trusting repository-provided suppressions."""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile


def scan(scanner, repo, mode):
    with tempfile.TemporaryDirectory(prefix='joinlet-trusted-scanner-') as directory:
        trusted = Path(directory)
        config = trusted / 'config.toml'
        config.write_text('[extend]\nuseDefault = true\n')
        # Explicit CLI options override GITLEAKS_CONFIG and target/.gitleaks.toml.
        # A fresh absent ignore path prevents target/.gitleaksignore from hiding findings.
        flags = ['--config', str(config), '--gitleaks-ignore-path', str(trusted / 'unused-ignore'),
                 '--redact', '--no-banner', '--no-color', '--ignore-gitleaks-allow']
        commands = []
        if mode in {'git', 'both'}:
            commands.append([str(scanner), 'git', '--log-opts=--all', *flags, str(repo)])
        if mode == 'staged':
            commands.append([str(scanner), 'git', '--staged', *flags, str(repo)])
        if mode in {'dir', 'both'}:
            commands.append([str(scanner), 'dir', *flags, str(repo)])
        for command in commands:
            result = subprocess.run(command, check=False)
            if result.returncode:
                return result.returncode
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scanner', type=Path, help='Path to the checksum-verified Gitleaks CLI')
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--mode', choices=['git', 'dir', 'staged', 'both'], default='both')
    args = parser.parse_args()
    sys.exit(scan(args.scanner.resolve(strict=True), args.repo.resolve(strict=True), args.mode))
