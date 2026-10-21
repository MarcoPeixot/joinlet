export const WATERCOLOR_FILTER_ID = 'strukt-watercolor';
export const SHADOW_FILTER_ID = 'strukt-shadow';
/** The "Sombra" style: a shade of the shape, blurred and dropped a few pixels. */
export const SHADOW_OFFSET = 5;

/** Shared by the live canvas and the SVG export so both paint the same wash and the same shadow. */
export const WATERCOLOR_DEFS =
  `<defs><filter id="${WATERCOLOR_FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%">` +
  '<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="noise"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G"/>' +
  '<feGaussianBlur stdDeviation="0.8"/></filter>' +
  `<filter id="${SHADOW_FILTER_ID}" x="-30%" y="-30%" width="160%" height="190%"><feGaussianBlur stdDeviation="6"/></filter></defs>`;
