import soraUrl from '@fontsource-variable/sora/files/sora-latin-wght-normal.woff2?url';
import monoUrl from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
import shantellUrl from '@fontsource-variable/shantell-sans/files/shantell-sans-latin-wght-normal.woff2?url';

const FACES = [
  { family: 'Sora Variable', url: soraUrl },
  { family: 'Shantell Sans Variable', url: shantellUrl },
  { family: 'Geist Mono Variable', url: monoUrl },
];

let cached: Promise<string> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Fonts as data URIs: an SVG drawn into a canvas cannot load external font files. */
export function embeddedFontCss(): Promise<string> {
  cached ??= Promise.all(
    FACES.map(async ({ family, url }) => {
      const buffer = await (await fetch(url)).arrayBuffer();
      return `@font-face{font-family:'${family}';font-weight:100 900;src:url(data:font/woff2;base64,${toBase64(buffer)}) format('woff2');}`;
    }),
  )
    .then((rules) => rules.join(''))
    .catch(() => {
      cached = null;
      return '';
    });
  return cached;
}
