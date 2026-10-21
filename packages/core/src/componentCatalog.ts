import { BASIC_COMPONENT_PRESETS } from './components';
import { SPECIALIST_COMPONENT_PRESETS } from './specialistComponents';
export { COMPONENT_LIBRARIES, SPECIALIST_COMPONENT_PRESETS } from './specialistComponents';
/** Full built-in catalog for discovery tools. Web clients load specialist packs on demand. */
export const COMPONENT_PRESETS = [...BASIC_COMPONENT_PRESETS, ...SPECIALIST_COMPONENT_PRESETS];
