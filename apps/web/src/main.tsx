import { beforeLocaleChange, uiText } from './i18n';
import { workspace } from './workspace/appWorkspace';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/fonts';
import './styles/app.css';
import './styles/diagram.css';
import { App } from './App';
import { diagramStore } from './state/appStore';
import { createRouteRunner } from './state/routeRunner';
import { startRouting } from './state/routing';
import { bootWorkspace, guardUnsavedChanges, getBootPhase, collaborationSession, createBrowserWorkspace } from './workspace/boot';
import { showToast } from './ui/uiStore';
import { startAnalytics, analyticsEditorReady, analyticsEdit, trackAnalytics } from './analytics/client';

beforeLocaleChange(async () => {
  const { flushCodeEdits, hasUnappliedCodeEdits } = await import('./code/registry');
  const { flushSketchEdits } = await import('./sketch/registry');
  await flushCodeEdits();
  if (hasUnappliedCodeEdits()) throw new Error(uiText('Corrija o código antes de trocar o idioma.'));
  flushSketchEdits();
  const { chatStore } = await import('./chat/session');
  chatStore.getState().stop();
  await workspace.flush();
});

startRouting(diagramStore, createRouteRunner());
startAnalytics();
diagramStore.subscribe((next, previous) => {
  if (next.model !== previous.model && next.past !== previous.past && next.past.length > 0) analyticsEdit('diagram', next.model.order.length > 0);
});
guardUnsavedChanges();
void bootWorkspace().then(async () => {
  if (getBootPhase().kind === 'ready') analyticsEditorReady();
  else if (getBootPhase().kind === 'failed') trackAnalytics('editor_failed', true);
  const url = new URL(location.href);
  if (url.searchParams.get('settings') === 'ai' && getBootPhase().kind === 'ready') {
    (await import('./settings/store')).openSettings('ai');
    url.searchParams.delete('settings'); history.replaceState(null, '', url);
  }
  if (url.searchParams.get('example') !== 'orders' || getBootPhase().kind !== 'ready' || collaborationSession()) return;
  const { modelFor, POSITIONS } = await import('./landing/model');
  const applied = url.searchParams.get('stage') === 'applied';
  const source = modelFor(applied ? 'applied' : 'idle');
  const elements = Object.fromEntries(Object.entries(source.elements).map(([id, element]) => [id, { ...element, label: uiText(element.label ?? id) }]));
  await createBrowserWorkspace(uiText('Exemplo do Joinlet'));
  await workspace.create('diagram', uiText('Pedidos'), { model: { ...source, elements }, layout: { nodes: Object.fromEntries(Object.entries(POSITIONS).filter(([id]) => id in elements)), edges: {} } });
  await workspace.flush();
  url.searchParams.delete('example'); url.searchParams.delete('stage');
  history.replaceState(null, '', url);
  showToast(uiText('Exemplo aberto em um novo workspace.'));
}).catch(error => showToast(error instanceof Error ? error.message : uiText('Não foi possível abrir o exemplo.')));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
