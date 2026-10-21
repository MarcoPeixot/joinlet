import { COLOR_MODES, STYLE_MODES, TYPEFACES } from '@strukt/core';
import { COLOR_MODE_LABELS, STYLE_MODE_LABELS, TYPEFACE_LABELS } from '../diagram/labels';

export const colorModes = COLOR_MODES.map((value) => ({ value, label: COLOR_MODE_LABELS[value] }));
export const styleModes = STYLE_MODES.map((value) => ({ value, label: STYLE_MODE_LABELS[value] }));
export const typefaces = TYPEFACES.map((value) => ({ value, label: TYPEFACE_LABELS[value] }));
