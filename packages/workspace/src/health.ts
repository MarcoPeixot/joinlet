import { open, readFile, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { own } from '@strukt/core';
import { MAX_DRIFT_BYTES, checkEvidenceDrift, exceedsDriftBytes, validEvidencePath, withSnippet } from './evidence';
import type { DriftFinding, EvidenceIndex } from './evidence';
import type { WorkspaceData } from './workspace';

export interface EvidenceIssue { diagram: string; id: string; path: string; message: string }

export async function checkEvidence(data: WorkspaceData, repositoryRoot: string): Promise<EvidenceIssue[]> {
  const issues: EvidenceIssue[] = [];
  const root = await realpath(repositoryRoot);
  for (const [diagram, elements] of Object.entries(data.evidence ?? {})) {
    const model = own(data.diagrams, diagram)?.model;
    for (const [id, refs] of Object.entries(elements)) {
      if (!own(model?.elements ?? {}, id) && !model?.edges.some((edge) => `edge:${edge.id}` === id)) {
        issues.push({ diagram, id, path: '', message: 'Elemento da evidência não existe no diagrama.' });
      }
      for (const ref of refs) {
        try {
          const target = await realpath(join(root, ref.path));
          if (!target.startsWith(root + sep)) throw new Error('Caminho fora do repositório.');
          if (!(await stat(target)).isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
          const content = await readFile(target, 'utf8');
          const selected = ref.line ? content.split(/\r?\n/)[ref.line - 1] : content;
          if (selected === undefined) throw new Error(`Linha ${ref.line} não existe.`);
          if (ref.contains && !selected.includes(ref.contains)) throw new Error('Trecho esperado não encontrado.');
        } catch (error) {
          issues.push({ diagram, id, path: ref.path, message: error instanceof Error && !('code' in error) ? error.message : 'Arquivo não encontrado.' });
        }
      }
    }
  }
  return issues;
}

/** Reads at most `MAX_DRIFT_BYTES + 1` bytes of a regular file as UTF-8 (invalid bytes become U+FFFD). */
async function readRepoFile(target: string): Promise<string> {
  const handle = await open(target, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
    const buffer = Buffer.alloc(MAX_DRIFT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally { await handle.close(); }
}

/** The text (first 2 MB) of `path` under the real `root`, or null when invalid, missing, not a regular file or escaping through a symlink. */
async function readContained(root: string, path: string): Promise<string | null> {
  if (!validEvidencePath(path)) return null;
  try {
    const target = await realpath(join(root, path));
    return target.startsWith(root + sep) ? await readRepoFile(target) : null;
  } catch { return null; }
}

/** The text (first 2 MB) of `path` under `repositoryRoot`, read the same contained way as `check --drift`; null when unreadable, invalid or escaping. */
export async function readRepositoryFile(repositoryRoot: string, path: string): Promise<string | null> {
  try { return await readContained(await realpath(repositoryRoot), path); } catch { return null; }
}

async function readAll(data: WorkspaceData, repositoryRoot: string): Promise<{ evidence: EvidenceIndex; read: (path: string) => string | null }> {
  const evidence = data.evidence ?? {};
  const root = await realpath(repositoryRoot);
  const contents = new Map<string, string | null>();
  for (const elements of Object.values(evidence)) {
    for (const refs of Object.values(elements)) {
      for (const ref of refs) if (!contents.has(ref.path)) contents.set(ref.path, await readContained(root, ref.path));
    }
  }
  return { evidence, read: (path) => contents.get(path) ?? null };
}

/**
 * Drift of the workspace evidence against the files under `repositoryRoot`. Each file is resolved with `realpath`
 * and must stay inside the root, so symlinks cannot leak files from outside; anything unreadable counts as missing.
 */
export async function checkWorkspaceDrift(data: WorkspaceData, repositoryRoot: string, options: { skipMissingFile?: boolean } = {}): Promise<DriftFinding[]> {
  const { evidence, read } = await readAll(data, repositoryRoot);
  return checkEvidenceDrift(evidence, read, options);
}

export interface SnapResult { evidence: EvidenceIndex; snapped: number; skipped: { path: string; line: number; reason: string }[] }

/** Fills `snippet` on every anchored reference lacking one, reading through the same contained reader as the drift check. */
export async function snapWorkspaceEvidence(data: WorkspaceData, repositoryRoot: string): Promise<SnapResult> {
  const { evidence, read } = await readAll(data, repositoryRoot);
  const out: EvidenceIndex = {};
  const skipped: SnapResult['skipped'] = [];
  let snapped = 0;
  for (const [diagram, elements] of Object.entries(evidence)) {
    out[diagram] = {};
    for (const [id, refs] of Object.entries(elements)) {
      out[diagram]![id] = refs.map((ref) => {
        if (!ref.line || ref.snippet) return ref;
        const text = read(ref.path);
        if (text === null) { skipped.push({ path: ref.path, line: ref.line, reason: 'arquivo não encontrado ou fora do repositório' }); return ref; }
        if (exceedsDriftBytes(text)) { skipped.push({ path: ref.path, line: ref.line, reason: 'arquivo grande demais' }); return ref; }
        const next = withSnippet(ref, text);
        if (next === ref) { skipped.push({ path: ref.path, line: ref.line, reason: 'a linha não existe' }); return ref; }
        snapped++;
        return next;
      });
    }
  }
  return { evidence: out, snapped, skipped };
}
