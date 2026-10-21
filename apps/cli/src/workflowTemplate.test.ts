import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const raw = readFileSync(resolve(__dirname, '../../../templates/github/strukt.yml'), 'utf8');
interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: { id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, { steps: { id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }[] }>;
}
const wf = parse(raw) as Workflow;

/** Every `steps.<id>` mentioned in an expression. */
const stepRefs = (expr: string) => [...expr.matchAll(/\bsteps\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!);

/** For each `if:` expression: every referenced step id must be the id of an EARLIER step of the same job (a typo evaluates to '' and silently disables the step). */
function gateProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const earlier = new Set<string>();
    for (const step of job.steps) {
      for (const id of stepRefs(step.if ?? '')) if (!earlier.has(id)) problems.push(`${jobName}: if: refers to steps.${id}, which is not an earlier step id`);
      if (step.id) earlier.add(step.id);
    }
  }
  return problems;
}
const steps = Object.values(wf.jobs).flatMap((j) => j.steps);

describe('templates/github/strukt.yml', () => {
  it('triggers on pull_request (never pull_request_target) with minimal permissions', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('never interpolates ${{ }} expressions inside run scripts', () => {
    const runs = steps.map((s) => s.run).filter((r): r is string => typeof r === 'string');
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run).not.toMatch(/\$\{\{/);
  });

  it('routes the base ref through env', () => {
    const withBase = steps.filter((s) => s.run?.includes('origin/$BASE_REF'));
    expect(withBase.length).toBeGreaterThanOrEqual(2);
    for (const s of withBase) expect(s.env?.BASE_REF).toBe('${{ github.base_ref }}');
  });

  it('posts the comment only when not cancelled and setup succeeded', () => {
    const comment = steps.find((s) => s.run?.includes('pr-comment'))!;
    expect(comment.if).not.toMatch(/always\(\)/);
    expect(comment.if).toContain('!cancelled()');
    expect(stepRefs(comment.if ?? '')).toEqual(expect.arrayContaining(['setup_bun', 'install']));
  });

  it('checks out without persisted credentials and keeps the visual diff out of the PR checkout', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with?.['persist-credentials']).toBe(false);
    const svg = steps.find((s) => s.id === 'svg')!;
    expect(svg.run).toContain('--svg "$RUNNER_TEMP/strukt-diff"');
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'))!;
    expect(upload.with?.path).toBe('${{ runner.temp }}/strukt-diff');
    expect(raw).not.toContain('--svg strukt-diff');
  });

  it('every steps.<id> referenced in an if: expression is an id of an earlier step in the same job', () => {
    expect(gateProblems(wf)).toEqual([]);
  });

  it('the checker catches a typo in a step id (in-memory mutation)', () => {
    const mutated = parse(raw.replace('steps.install.conclusion', 'steps.instal.conclusion')) as Workflow;
    expect(gateProblems(mutated).join('\n')).toContain('instal');
    const gate = Object.values(mutated.jobs).flatMap((j) => j.steps).find((st) => st.run?.includes('pr-comment'))!.if ?? '';
    expect(stepRefs(gate)).not.toContain('install');
  });

  it('the checker catches a reference to a later step', () => {
    const mutated = parse(raw) as Workflow;
    const job = Object.values(mutated.jobs)[0]!;
    const first = job.steps.find((s) => s.id === 'setup_bun')!;
    first.if = "steps.upload.outcome == 'success'";
    expect(gateProblems(mutated).join('\n')).toContain('upload');
  });
});

const { sync, 'commit-sync': commit } = wf.jobs as unknown as Record<string, Job>;
const stepOf = (job: Job, id: string) => job.steps.find((step) => step.id === id)!;

/** Jobs that can write repository contents: the workflow default, or an explicit job-level grant. */
const writers = (workflow: Workflow): string[] =>
  Object.entries(workflow.jobs as unknown as Record<string, Job>)
    .filter(([, job]) => (job.permissions ? job.permissions.contents === 'write' : workflow.permissions.contents === 'write'))
    .map(([name]) => name);

describe('templates/github/strukt.yml — sync por PR', () => {
  it('keeps the original architecture job first and adds the sync jobs', () => {
    expect(Object.keys(wf.jobs)).toEqual(['architecture', 'sync', 'commit-sync']);
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(raw).not.toMatch(/pull_request_target\s*:/);
    expect(raw).not.toMatch(/workflow_run\s*:/);
  });

  it('only PRs from the same repository reach the sync jobs (never forks)', () => {
    for (const job of [sync!, commit!]) expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(commit!.needs).toBe('sync');
    expect(commit!.if).toContain("needs.sync.outputs.changed == 'true'");
    expect(sync!.outputs?.changed).toBe('${{ steps.patch.outputs.changed }}');
  });

  it('grants contents: write to commit-sync only; the job that runs the CLI is read-only', () => {
    expect(writers(wf)).toEqual(['commit-sync']);
    expect(commit!.permissions).toEqual({ contents: 'write' });
    expect(sync!.permissions).toEqual({ contents: 'read' });
  });

  it('the write guard catches a grant on another job (in-memory mutation)', () => {
    const mutated = parse(raw) as Workflow;
    (mutated.jobs.sync as unknown as Job).permissions = { contents: 'write' };
    expect(writers(mutated)).toEqual(['sync', 'commit-sync']);
    const widened = parse(raw.replace('contents: read\n  pull-requests: write', 'contents: write\n  pull-requests: write')) as Workflow;
    expect(writers(widened)).toEqual(['architecture', 'commit-sync']);
  });

  it('runs the CLI over the exact PR commit, without persisted credentials or a token', () => {
    const checkout = sync!.steps.find((step) => step.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toEqual({ ref: '${{ github.event.pull_request.head.sha }}', 'persist-credentials': false });
    expect(JSON.stringify(sync)).not.toContain('secrets.');
    expect(JSON.stringify(sync)).not.toContain('GITHUB_TOKEN');
    expect(JSON.stringify(sync)).not.toContain('GH_TOKEN');
  });

  it('hands over only a patch of .arch/, built without external diff drivers', () => {
    const patch = stepOf(sync!, 'patch');
    expect(patch.run).toContain('git add -A -- .arch');
    expect(patch.run).toContain('--no-ext-diff');
    expect(patch.run).toContain('--no-textconv');
    expect(patch.run).toContain('--no-renames');
    expect(patch.run).toContain('-- .arch >');
    expect(patch.run).not.toContain('--binary');
    const upload = stepOf(sync!, 'upload_patch');
    expect(upload.if).toBe("steps.patch.outputs.changed == 'true'");
    expect(upload.with?.name).toBe('strukt-sync');
    expect(String(upload.with?.path)).toMatch(/sync\.patch$/);
  });

  it('commit-sync never installs or runs the CLI, bun or anything from the PR', () => {
    const text = JSON.stringify(commit);
    for (const forbidden of ['setup-bun', 'main.ts', 'bun ', 'bun install', 'git clone', 'STRUKT_REPO', 'npm ', 'node ']) expect(text, forbidden).not.toContain(forbidden);
    for (const step of commit!.steps) expect(step.uses ?? '').toMatch(/^$|^actions\/(checkout|download-artifact)@/);
  });

  it('commit-sync checks out the PR branch, validates the patch before applying it and pushes without force', () => {
    const checkout = commit!.steps.find((step) => step.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toEqual({ ref: '${{ github.event.pull_request.head.ref }}', token: '${{ secrets.STRUKT_SYNC_TOKEN || github.token }}' });
    const ids = commit!.steps.map((step) => step.id);
    expect(ids.indexOf('validate')).toBeGreaterThan(ids.indexOf('download'));
    expect(ids.indexOf('push')).toBeGreaterThan(ids.indexOf('validate'));
    const push = stepOf(commit!, 'push');
    expect(push.env).toEqual({ HEAD_REF: '${{ github.event.pull_request.head.ref }}' });
    expect(push.run).toContain('git push origin "HEAD:refs/heads/$HEAD_REF"');
    expect(push.run).not.toMatch(/--force|\s-f\s|--force-with-lease|--mirror|--delete/);
    expect(push.run).toContain("git apply --index --allow-empty --include='.arch/*'");
    expect(stepOf(commit!, 'validate').env).toEqual({ HEAD_SHA: '${{ github.event.pull_request.head.sha }}' });
  });

  it('serialises runs per PR', () => {
    expect(wf.concurrency).toEqual({ group: 'strukt-${{ github.event.pull_request.number }}', 'cancel-in-progress': true });
  });

  it('attacker-controlled values only reach scripts through env (head ref, sha, base ref)', () => {
    for (const job of Object.values(wf.jobs) as unknown as Job[]) {
      for (const step of job.steps) {
        if (!step.run) continue;
        for (const name of ['HEAD_REF', 'HEAD_SHA', 'BASE_REF']) if (step.run.includes(`$${name}`)) expect(step.env?.[name], `${step.id ?? step.run.slice(0, 30)} ${name}`).toMatch(/^\$\{\{ github\.(event\.pull_request\.head\.(ref|sha)|base_ref) \}\}$/);
      }
    }
  });
});

describe('commit-sync scripts, executed against real git repositories', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  /** A bare "origin" plus a clone on branch `feature` holding `.arch/diagrams/a.json`. */
  function setup() {
    const base = mkdtempSync(join(tmpdir(), 'strukt-wf-'));
    dirs.push(base);
    const origin = join(base, 'origin.git');
    const work = join(base, 'work');
    mkdirSync(origin);
    git(origin, 'init', '--bare', '-q', '-b', 'feature');
    mkdirSync(join(work, '.arch', 'diagrams'), { recursive: true });
    git(work, 'init', '-q', '-b', 'feature');
    writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":1}\n');
    writeFileSync(join(work, 'README.md'), '# x\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'init');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-q', 'origin', 'feature');
    return { base, origin, work, head: git(work, 'rev-parse', 'HEAD'), temp: join(base, 'tmp') };
  }

  /** Runs a step's script the way the runner does (`bash -e`), with the step's env. */
  const runStep = (job: Job, id: string, cwd: string, env: Record<string, string>) =>
    spawnSync('bash', ['-e', '-c', stepOf(job, id).run!], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

  /** Produces a patch with `mutate`, the way the `sync` job does, then restores the work tree. */
  function patchFor(ctx: ReturnType<typeof setup>, mutate: (work: string) => void): string {
    mkdirSync(join(ctx.temp, 'strukt-sync'), { recursive: true });
    mutate(ctx.work);
    git(ctx.work, 'add', '-A');
    const patch = spawnSync('git', ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames'], { cwd: ctx.work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
    git(ctx.work, 'reset', '-q', '--hard', 'HEAD');
    git(ctx.work, 'clean', '-fdq');
    writeFileSync(join(ctx.temp, 'strukt-sync', 'sync.patch'), patch);
    return patch;
  }

  const validate = (ctx: ReturnType<typeof setup>, head = ctx.head) => runStep(commit!, 'validate', ctx.work, { RUNNER_TEMP: ctx.temp, HEAD_SHA: head });

  it('accepts a patch that only edits and creates regular files under .arch/', () => {
    const ctx = setup();
    patchFor(ctx, (work) => {
      writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":2}\n');
      writeFileSync(join(work, '.arch', 'sync.json'), '{}\n');
    });
    const result = validate(ctx);
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });

  it('rejects paths outside .arch/', () => {
    const ctx = setup();
    patchFor(ctx, (work) => {
      mkdirSync(join(work, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(work, '.github', 'workflows', 'x.yml'), 'on: push\n');
    });
    const result = validate(ctx);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('fora de .arch/');
  });

  it('rejects a lookalike prefix such as .arch-evil/ and .archive', () => {
    for (const dir of ['.arch-evil', '.archive']) {
      const ctx = setup();
      patchFor(ctx, (work) => {
        mkdirSync(join(work, dir), { recursive: true });
        writeFileSync(join(work, dir, 'x'), 'x\n');
      });
      expect(validate(ctx).status, dir).toBe(1);
    }
  });

  it('rejects symlinks, permission changes and touching files outside in the same patch', () => {
    const ctx = setup();
    patchFor(ctx, (work) => symlinkSync('/etc/passwd', join(work, '.arch', 'link')));
    const link = validate(ctx);
    expect(link.status).toBe(1);
    expect(link.stdout).toContain('não é arquivo comum');
    const exec = setup();
    patchFor(exec, (work) => spawnSync('chmod', ['+x', join(work, '.arch', 'diagrams', 'a.json')]));
    expect(validate(exec).status).toBe(1);
    const mixed = setup();
    patchFor(mixed, (work) => {
      writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":3}\n');
      writeFileSync(join(work, 'README.md'), 'pwned\n');
    });
    expect(validate(mixed).status).toBe(1);
  });

  it('rejects a patch computed for another commit and an oversized patch', () => {
    const ctx = setup();
    patchFor(ctx, (work) => writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":2}\n'));
    expect(validate(ctx, 'deadbeef').stdout).toContain('avançou');
    const big = setup();
    patchFor(big, (work) => writeFileSync(join(work, '.arch', 'big.json'), `${'x'.repeat(5_100_000)}\n`));
    const result = validate(big);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('grande demais');
  });

  it('applies the patch, commits as the bot and pushes only to the PR branch', () => {
    const ctx = setup();
    patchFor(ctx, (work) => {
      writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":2}\n');
      writeFileSync(join(work, '.arch', 'sync.json'), '{}\n');
    });
    expect(validate(ctx).status).toBe(0);
    const result = runStep(commit!, 'push', ctx.work, { RUNNER_TEMP: ctx.temp, HEAD_REF: 'feature' });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(git(ctx.origin, 'log', '-1', '--format=%an%n%s', 'feature')).toBe('github-actions[bot]\nchore(arch): sincroniza .arch/ com as fontes (joinlet sync)');
    expect(git(ctx.origin, 'show', '--name-only', '--format=', 'feature').split('\n').sort()).toEqual(['.arch/diagrams/a.json', '.arch/sync.json']);
    expect(git(ctx.origin, 'branch', '--list').replace(/[* ]/g, '')).toBe('feature');
  });

  it('a hostile branch name stays data: it is quoted, never executed', () => {
    const ctx = setup();
    patchFor(ctx, (work) => writeFileSync(join(work, '.arch', 'diagrams', 'a.json'), '{"a":2}\n'));
    const marker = join(ctx.base, 'pwned');
    const result = runStep(commit!, 'push', ctx.work, { RUNNER_TEMP: ctx.temp, HEAD_REF: `x$(touch ${marker});\`touch ${marker}\`` });
    expect(result.status).not.toBe(0);
    expect(() => readFileSync(marker)).toThrow();
  });

  it('does nothing when the patch changes nothing', () => {
    const ctx = setup();
    mkdirSync(join(ctx.temp, 'strukt-sync'), { recursive: true });
    writeFileSync(join(ctx.temp, 'strukt-sync', 'sync.patch'), '');
    const result = runStep(commit!, 'push', ctx.work, { RUNNER_TEMP: ctx.temp, HEAD_REF: 'feature' });
    expect(result.status, result.stderr).toBe(0);
    expect(git(ctx.origin, 'rev-parse', 'feature')).toBe(ctx.head);
  });

  it('the sync job builds a patch with only what changed under .arch/', () => {
    const ctx = setup();
    mkdirSync(join(ctx.temp, 'strukt-sync'), { recursive: true });
    const output = join(ctx.base, 'github_output');
    writeFileSync(output, '');
    const quiet = runStep(sync!, 'patch', ctx.work, { RUNNER_TEMP: ctx.temp, GITHUB_OUTPUT: output });
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('changed=false\n');
    writeFileSync(join(ctx.work, '.arch', 'diagrams', 'a.json'), '{"a":2}\n');
    writeFileSync(join(ctx.work, '.arch', 'sync.json'), '{}\n');
    writeFileSync(join(ctx.work, 'README.md'), 'changed outside\n');
    writeFileSync(output, '');
    const result = runStep(sync!, 'patch', ctx.work, { RUNNER_TEMP: ctx.temp, GITHUB_OUTPUT: output });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('changed=true\n');
    const patch = readFileSync(join(ctx.temp, 'strukt-sync', 'sync.patch'), 'utf8');
    expect(patch).toContain('.arch/diagrams/a.json');
    expect(patch).toContain('.arch/sync.json');
    expect(patch).not.toContain('README.md');
    // The produced patch passes the validation of the write job.
    expect(validate(ctx).status).toBe(0);
  });
});

