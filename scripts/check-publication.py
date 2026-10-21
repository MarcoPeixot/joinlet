#!/usr/bin/env python3
"""Reject runtime/private files from the public Git index. Does not inspect secret contents."""
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

EXAMPLES = {'apps/server/.env.example', 'apps/remote/.env.example', 'deploy/.env.production.example'}
PRIVATE_ROOTS = {'internal', 'operations', 'commercial', 'private', 'backups', 'runtime'}
PRIVATE_PARTS = {'.vscode', '.claude', '.codex', '.cursor', '.superpowers', '.ssh', '.aws', '.azure', '.gcloud', '.config', '.idea', 'node_modules', 'dist', '.vite', 'coverage', 'test-results', 'playwright-report', '__pycache__', 'secrets', 'backups', 'dumps', 'runtime'}
PRIVATE_NAMES = {'.mcp.json', 'jo-hover.md', 'jo-prompts.md', 'jo-corrections.md', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'authorized_keys', 'known_hosts', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.gitconfig', '.gitleaks.toml', '.gitleaksignore'}
PRIVATE_SUFFIXES = {'.pem', '.key', '.p8', '.p12', '.pfx', '.jks', '.keystore', '.sqlite', '.sqlite3', '.db', '.db3', '.dump', '.bak', '.backup', '.zip', '.tar', '.tgz', '.gz', '.7z', '.log', '.tsbuildinfo'}


def forbidden(path, mode='100644'):
    p = PurePosixPath(path)
    # These are privacy boundaries, including on case-sensitive GitHub runners.
    parts = tuple(part.casefold() for part in p.parts)
    name = p.name.casefold()
    return (
        mode not in {'100644', '100755'} or p.is_absolute() or '..' in p.parts
        or not parts or '\\' in path or parts[0] in PRIVATE_ROOTS
        or any(ord(c) < 32 for c in path)
        or any(part in PRIVATE_PARTS for part in parts)
        or name in PRIVATE_NAMES or p.suffix.casefold() in PRIVATE_SUFFIXES
        or any(ext + '-' in name for ext in ('.sqlite', '.sqlite3', '.db', '.db3'))
        or (name.startswith('.env') and path not in EXAMPLES)
        or path.casefold().startswith(('docs/superpowers/', 'docs/research/', 'apps/remote/data/'))
        or (path.casefold().startswith('apps/web/public/') and p.suffix.casefold() in {'.md', '.txt', '.html'})
    )


def main():
    root = Path(__file__).resolve().parents[1]
    rows = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--stage', '-z']).decode().split('\0')
    if not any(rows):
        print('Publication check requires a non-empty Git index.', file=sys.stderr)
        return 1
    rejected = []
    for row in filter(None, rows):
        metadata, path = row.split('\t', 1)
        mode = metadata.split()[0]
        if forbidden(path, mode): rejected.append(path)
    if rejected:
        for path in rejected: print('Private or runtime path in public index: ' + json.dumps(path), file=sys.stderr)
        return 1
    print('Publication boundary passed: no forbidden paths or symlinks in the Git index.')
    return 0


if __name__ == '__main__': sys.exit(main())
