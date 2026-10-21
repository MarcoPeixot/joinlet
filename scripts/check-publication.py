#!/usr/bin/env python3
"""Reject runtime/private files from the public Git index. Does not inspect secret contents."""
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

EXAMPLES = {'apps/server/.env.example', 'apps/remote/.env.example', 'deploy/.env.production.example'}
PRIVATE_ROOTS = {'internal', 'operations', 'commercial', 'private', 'backups', 'runtime'}
PRIVATE_PARTS = {'.vscode', '.claude', '.codex', '.cursor', 'node_modules', 'dist', '.vite', 'coverage', 'test-results', 'playwright-report', '__pycache__', 'secrets'}
PRIVATE_NAMES = {'.mcp.json', 'JO-HOVER.md', 'JO-PROMPTS.md', 'JO-CORRECTIONS.md'}
PRIVATE_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.log', '.tsbuildinfo'}


def forbidden(path, mode='100644'):
    p = PurePosixPath(path)
    return (
        mode not in {'100644', '100755'} or p.is_absolute() or '..' in p.parts
        or not p.parts or '\\' in path or p.parts[0] in PRIVATE_ROOTS
        or any(part in PRIVATE_PARTS for part in p.parts)
        or p.name in PRIVATE_NAMES or p.suffix.lower() in PRIVATE_SUFFIXES
        or '.sqlite-' in p.name or p.name.endswith(('.db-wal', '.db-shm'))
        or (p.name.startswith('.env') and path not in EXAMPLES)
        or path.startswith(('docs/superpowers/', 'docs/research/', 'apps/remote/data/'))
        or (path.startswith('apps/web/public/') and p.suffix.lower() in {'.md', '.txt', '.html'})
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
