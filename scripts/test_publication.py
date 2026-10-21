import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('publication', Path(__file__).with_name('check-publication.py'))
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationBoundaryTests(unittest.TestCase):
    def test_blocks_private_and_runtime_paths_even_when_git_tracks_them(self):
        for path in ['.env', 'apps/server/.env', '.vscode/mcp.json', 'internal/notes.md',
                     'operations/production.json', 'apps/remote/data/customer.sqlite-wal',
                     'apps/web/public/brand/JO-HOVER.md', 'apps/web/public/private-note.md',
                     'docs/research/plan.md', 'apps/web/node_modules/code.js', 'apps/remote/server.pem']:
            with self.subTest(path=path): self.assertTrue(publication.forbidden(path))
        self.assertTrue(publication.forbidden('apps/web/src/linked.ts', '120000'))
        self.assertTrue(publication.forbidden('packages/submodule', '160000'))

    def test_blocks_nested_backups_private_keys_and_case_variants(self):
        for path in ['apps/remote/backups/customers.sql', 'apps/remote/Backups/customers.json',
                     'deploy/private.dump', 'apps/web/id_ed25519', 'apps/server/.netrc',
                     'Internal/financial.xlsx', 'apps/web/.ENV.production',
                     'apps/web/customer.sqlite3', 'apps/web/customer.SQLITE3-wal',
                     'deploy/customer.db3-journal', 'deploy/customer.tar.gz',
                     'apps/remote/.aws/credentials', '.gitleaks.toml', '.gitleaksignore']:
            with self.subTest(path=path): self.assertTrue(publication.forbidden(path))

    def test_allows_product_architecture_and_empty_environment_examples(self):
        for path in ['.arch/diagrams/arquitetura-do-joinlet.strukt.json', '.arch/evidence.json',
                     'apps/remote/src/secrets.ts', 'apps/server/.env.example',
                     'deploy/.env.production.example', 'apps/web/public/brand/jo-curious.png',
                     'packages/workspace/src/migrations/001-schema.sql']:
            with self.subTest(path=path): self.assertFalse(publication.forbidden(path))


if __name__ == '__main__': unittest.main()
