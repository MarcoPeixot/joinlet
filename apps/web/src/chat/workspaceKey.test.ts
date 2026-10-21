import { describe, expect, it } from 'vitest';
import { chatBinding } from './workspaceKey';

describe('chatBinding', () => {
  it('keys a listed workspace by its id, so renaming it keeps the key', () => {
    const before = chatBinding({ name: 'Pagamentos', label: 'Navegador', catalogId: 'abc' });
    const after = chatBinding({ name: 'Pagamentos v2', label: 'Navegador', catalogId: 'abc' });
    expect(before.key).toBe('ws:abc');
    expect(after.key).toBe(before.key);
    expect(after.legacy).toBe('Navegador::Pagamentos v2');
  });

  it('tells two workspaces apart even with the same name and place', () => {
    expect(chatBinding({ name: 'App', label: 'Navegador', catalogId: 'a' }).key).not.toBe(chatBinding({ name: 'App', label: 'Navegador', catalogId: 'b' }).key);
  });

  it('keeps the old key without an id, and for remote sessions whatever id is left over', () => {
    expect(chatBinding({ name: 'App', label: 'Navegador', catalogId: null }).key).toBe('Navegador::App');
    expect(chatBinding({ name: 'repo', label: 'GitHub: o/r', catalogId: 'abc' }).key).toBe('GitHub: o/r::repo');
    expect(chatBinding({ name: 'repo', label: 'Rede local: o/r', catalogId: 'abc' }).key).toBe('Rede local: o/r::repo');
  });
});
