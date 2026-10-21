import { describe, expect, it } from 'vitest';
import { checkSvg, MAX_SVG } from './svgCheck';

const ok = (svg: unknown) => expect(checkSvg(svg), String(svg).slice(0, 80)).toBe(true);
const refused = (svg: unknown) => expect(checkSvg(svg), String(svg).slice(0, 80)).not.toBe(true);

describe('checkSvg', () => {
  it('accepts what the app exporter emits', () => {
    ok('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect x="1" y="1" width="8" height="8" rx="2" fill="#fff"/><text x="2" y="5">API &amp; DB</text></svg>');
    ok('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="s"><feDropShadow dx="1" dy="1"/></filter></defs><g filter="url(#s)"><path d="M0 0L1 1"/></g></svg>');
    ok(`<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{font-family:'Geist';src:url(data:font/woff2;base64,AAAA) format('woff2')}text{font-family:Geist}</style><use href="#a"/><image href="data:image/png;base64,AAAA"/></svg>`);
  });

  it('refuses non-SVG and non-text input', () => {
    refused('');
    refused('<html></html>');
    refused('hello');
    refused(42);
    refused(null);
    refused('<svgx></svgx>');
    refused('<div><svg></svg></div>');
  });

  it('refuses active content', () => {
    refused('<svg><script>alert(1)</script></svg>');
    refused('<svg><SCRIPT >x</SCRIPT></svg>');
    refused('<svg><foreignObject><div/></foreignObject></svg>');
    refused('<svg onload="alert(1)"></svg>');
    refused('<svg><rect onclick = "x"/></svg>');
    refused('<svg><a href="javascript:alert(1)"><rect/></a></svg>');
    refused('<svg><a xlink:href="javascript:alert(1)"><rect/></a></svg>');
    refused('<svg><a href="&#106;avascript:alert(1)"><rect/></a></svg>');
    refused('<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>');
    refused('<svg><set attributeName="onmouseover" to="alert(1)"/></svg>');
    refused('<svg><iframe src="https://evil.com"/></svg>');
    refused('<svg><embed src="https://evil.com"/></svg>');
    refused('<svg><object data="https://evil.com"/></svg>');
  });

  it('refuses external references and entity tricks', () => {
    refused('<svg><image href="https://evil.com/track.png"/></svg>');
    refused('<svg><image xlink:href="http://evil.com/x.png"/></svg>');
    refused('<svg><use href="https://evil.com/a.svg#x"/></svg>');
    refused('<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>');
    refused('<svg><image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4="/></svg>');
    refused('<svg><rect style="fill:url(https://evil.com/x)"/></svg>');
    refused('<svg><style>@import url(https://evil.com/x.css);</style></svg>');
    refused('<svg><style>rect{background:url("http://evil.com/x")}</style></svg>');
    refused('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>');
    refused('<!DOCTYPE svg><svg/>');
    refused('<svg><!ENTITY a "b"></svg>');
  });

  it('reads tags the way a parser would (quoted ">" cannot hide an attribute)', () => {
    refused('<svg><rect title=">" onclick="alert(1)"/></svg>');
    refused("<svg><rect title='>' onload='x'/></svg>");
    refused('<svg><rect\nonclick="x"/></svg>');
    refused('<svg><rect a="1"onclick="x"/></svg>');
    refused('<svg><a title=">" href="javascript:x"/></svg>');
  });

  it('does not reject harmless words in labels', () => {
    ok('<svg xmlns="http://www.w3.org/2000/svg"><text>online = 3 &amp; javascript: ok, @import, url(x)</text></svg>');
    ok('<svg xmlns="http://www.w3.org/2000/svg"><text title="a > b">onboarding</text></svg>');
  });

  it('stays linear on hostile input', () => {
    const started = performance.now();
    for (const body of ['<a "'.repeat(200_000), '<style>'.repeat(100_000), '<!--'.repeat(100_000), '<a b="'.repeat(100_000), '<'.repeat(500_000), '<style></style>'.repeat(50_000)]) checkSvg(`<svg>${body}`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('bounds the size', () => {
    ok(`<svg>${'a'.repeat(1_000)}</svg>`);
    refused(`<svg>${'a'.repeat(MAX_SVG)}</svg>`);
  });
});
