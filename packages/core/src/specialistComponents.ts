import content from "./specialistContent.json" with { type: "json" };
import type { ComponentPreset } from "./components";

export interface ComponentLibraryDefinition {
  id: string;
  label: string;
  description: string;
}
/** Curated conceptual building blocks. These presets describe systems; they do not execute algorithms. */
export const COMPONENT_LIBRARIES: readonly ComponentLibraryDefinition[] =
  content.libraries;
export const SPECIALIST_COMPONENT_PRESETS: readonly ComponentPreset[] =
  content.components as ComponentPreset[];
