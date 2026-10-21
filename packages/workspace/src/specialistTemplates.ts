import templates from "./specialistTemplates.json" with { type: "json" };
import type { DiagramTemplate } from "./templates";
/** Authored positions and explicit relations keep scientific concepts editable and inspectable. */
export const SPECIALIST_TEMPLATES: readonly DiagramTemplate[] =
  templates as unknown as DiagramTemplate[];
