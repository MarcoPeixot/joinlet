import { expect, it } from 'vitest';
import { DIAGRAM_DESIGN_GUIDANCE } from './diagramDesign';
import { DIAGRAM_SYSTEM_PROMPT } from './prompt';
import { replyToEditableChat } from './chatEdit';
import { MODELS } from './anthropic';
import { fakeClient, message } from './testing';

it('shares cloud boundaries, icon presentation and preservation rules across generation and chat', async () => {
  expect(DIAGRAM_SYSTEM_PROMPT).toContain(DIAGRAM_DESIGN_GUIDANCE);
  for (const kind of ['diagram', 'workspace'] as const) {
    const fake = fakeClient(message([{ type: 'text', text: 'Ready.' }]));
    await replyToEditableChat(fake.client, { context: '', messages: [{ role: 'user', content: 'Explain this architecture' }] }, { kind, slug: 'test', content: kind === 'diagram' ? '{"version":1,"nodes":[],"connections":[]}' : '{"version":1,"name":"Test","diagrams":[],"docs":[],"sketches":[]}' }, new AbortController().signal, MODELS);
    expect(fake.calls[0]?.system).toContain(DIAGRAM_DESIGN_GUIDANCE);
  }
  expect(DIAGRAM_DESIGN_GUIDANCE).toContain('presentation icon');
  expect(DIAGRAM_DESIGN_GUIDANCE).toContain('não converta ícones em cartões');
  expect(DIAGRAM_DESIGN_GUIDANCE).toContain('Não coloque CloudFront');
});
