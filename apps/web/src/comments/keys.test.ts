import { describe, expect, it } from 'vitest';
import { commentKey } from './keys';

const press = (key: string, target: object | null = null, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target, ...mods }) as Parameters<typeof commentKey>[0];
const body = { tagName: 'DIV', isContentEditable: false, closest: () => null };
const box = { tagName: 'TEXTAREA', isContentEditable: false, closest: () => null };

describe('commentKey', () => {
  it('C toggles the tool, from the canvas or the page', () => {
    expect(commentKey(press('c', body), false)).toBe('toggle');
    expect(commentKey(press('C', null), true)).toBe('toggle');
  });
  it('leaves C alone while typing, on a control, with a modifier (⌘C is copy) or with Shift', () => {
    expect(commentKey(press('c', box), false)).toBeNull();
    expect(commentKey(press('c', { tagName: 'DIV', isContentEditable: true }), false)).toBeNull();
    expect(commentKey(press('c', { tagName: 'BUTTON', isContentEditable: false, closest: () => ({}) }), false)).toBeNull();
    expect(commentKey(press('c', { tagName: 'DIV', isContentEditable: false, closest: () => ({}) }), false)).toBeNull();
    expect(commentKey(press('c', body, { metaKey: true }), false)).toBeNull();
    expect(commentKey(press('c', body, { ctrlKey: true }), false)).toBeNull();
    expect(commentKey(press('c', body, { shiftKey: true }), false)).toBeNull();
  });
  it('Escape turns the tool off, and only while it is on', () => {
    expect(commentKey(press('Escape', body), true)).toBe('off');
    expect(commentKey(press('Escape', body), false)).toBeNull();
  });
  it('other keys are not its business', () => {
    expect(commentKey(press('n', body), true)).toBeNull();
    expect(commentKey(press('Enter', body), true)).toBeNull();
  });
});
