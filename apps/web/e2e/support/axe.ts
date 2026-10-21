import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const source = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

export interface AxeFinding {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/** Runs axe-core (WCAG A/AA tags) over the whole page and returns the violations as compact findings. */
export async function axeFindings(page: Page, options: { exclude?: string[] } = {}): Promise<AxeFinding[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(source);
  const results = await page.evaluate(async (exclude) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[]; failureSummary?: string }[] }[] }> } }).axe;
    const context = exclude.length ? { include: [document], exclude: exclude.map((selector) => [selector]) } : document;
    return axe.run(context, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  }, options.exclude ?? []);
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('').trim()}`) }));
}
