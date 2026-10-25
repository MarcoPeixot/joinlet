import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {syntaxFixtures} from '../packages/workspace/src/repository/syntaxFixtures';

const image = process.argv[2] || 'joinlet-remote:check';
const name = `joinlet-smoke-${randomUUID()}`;
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 }).trim();
let created = false;
try {
  docker('volume', 'create', name);
  docker('run', '-d', '--name', name, '--read-only', '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-p', '127.0.0.1::8788', '--mount', `type=volume,source=${name},target=/data`,
    '-e', 'STRUKT_PUBLIC_URL=https://joinlet.example', '-e', 'STRUKT_GITHUB_APP_CLIENT_ID=smoke-only',
    '-e', 'STRUKT_GITHUB_APP_CLIENT_SECRET=smoke-only', '-e', `STRUKT_REMOTE_ENCRYPTION_KEY=${'a'.repeat(64)}`, image);
  created = true;
  let origin = `http://${docker('port', name, '8788/tcp')}`;
  const ready = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await fetch(`${origin}/ready`).then(r => r.ok, () => false)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Container did not become ready.');
  };
  await ready();
  for (const path of ['/', '/app/', '/docs/en/deployment/', '/docs/en/cloud/', '/docs/pt-BR/cloud/', '/health']) assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
  assert.equal((await fetch(`${origin}/api/remote/session`)).status, 401);
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  assert.notEqual(docker('exec', name, 'bun', '-e', 'console.log(process.getuid())'), '0');
  docker('exec', name, 'bun', '-e', `import {existsSync} from 'node:fs'; for(const p of ['/app/.env','/app/.arch','/app/.codex']) if(existsSync(p)) throw Error('Private build input shipped: '+p);`);
  docker('exec',name,'bun','-e',`import {parseSource} from './packages/workspace/src/repository/syntax'; for(const [extension,text,expected,line] of ${JSON.stringify(syntaxFixtures)}) {const result=await parseSource('probe.'+extension,text);if(!result.imports.some(ref=>ref.name===expected&&ref.line===line))throw Error('Distributed parser failed: '+extension);}console.log('All distributed syntax parsers passed.');`);
  const probe = `import {Database} from 'bun:sqlite'; const db=new Database('/data/remote.sqlite'); db.exec('CREATE TABLE deployment_probe (value TEXT)'); db.query('INSERT INTO deployment_probe VALUES (?)').run('persisted'); db.close();`;
  docker('exec', name, 'bun', '-e', probe);
  docker('exec', name, 'bun', 'apps/remote/src/backup.ts', '/data/remote.sqlite', '/data/backup.sqlite');
  docker('stop', '--time', '30', name);
  assert.equal(docker('inspect', '-f', '{{.State.ExitCode}}', name), '0');
  docker('start', name);
  origin = `http://${docker('port', name, '8788/tcp')}`;
  await ready();
  docker('exec', name, 'bun', '-e', `import {Database} from 'bun:sqlite'; import {statSync} from 'node:fs'; for(const file of ['remote.sqlite','backup.sqlite']) { const db=new Database('/data/'+file,{readonly:true}); if(db.query('SELECT value FROM deployment_probe').get().value!=='persisted') throw Error('Persistence failed'); db.close(); } if((statSync('/data/backup.sqlite').mode&0o777)!==0o600) throw Error('Backup permissions');`);
  console.log('Joinlet container smoke passed: non-root, readiness, private inputs excluded, SIGTERM, restart persistence and SQLite backup.');
} catch (error) {
  if (created) console.error(docker('logs', '--tail', '30', name));
  throw error;
} finally {
  if (created) docker('rm', '-f', name);
  docker('volume', 'rm', name);
}
