import type { Page } from '@playwright/test';

export type PanelName = 'Fluxos' | 'Modelo' | 'Perspectivas' | 'Precisão' | 'Comentários' | 'Versões' | 'Linha do tempo' | 'GitHub';

/** The top bar's "Painéis" trigger (its name gains ": <panel>" while one is open). */
export const panelsTrigger = (page: Page) => page.getByRole('button', { name: /^Painéis/ });

/** Opens a right-hand panel from the Painéis menu, or closes it when it is the one open. */
export async function togglePanel(page: Page, name: PanelName): Promise<void> {
  await panelsTrigger(page).click();
  await page.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }).click();
}
