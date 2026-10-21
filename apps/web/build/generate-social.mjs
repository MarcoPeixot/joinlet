/** Reproduce the social card from existing brand assets: node build/generate-social.mjs */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const asset = await readFile(new URL('../public/brand/jo-connected-v2.webp', import.meta.url));
const font = await readFile(new URL('../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2', import.meta.url));
const browser = await chromium.launch();
try {
 const page = await browser.newPage({ viewport:{width:1200,height:630},deviceScaleFactor:1 });
 await page.setContent(`<style>@font-face{font-family:Sora;src:url(data:font/woff2;base64,${font.toString('base64')})}*{box-sizing:border-box}body{margin:0;background:#0f1417;color:#faf9f4;font-family:Sora, sans-serif;padding:58px}.logo{display:flex;align-items:center;gap:14px;font-size:36px;font-weight:700}h1{font-size:62px;letter-spacing:-3px;line-height:1.12;max-width:640px;margin:65px 0 24px}em{color:#a3ff3d;font-style:normal}p{font-size:20px;color:#b1bdc3;max-width:530px;line-height:1.7}img{position:absolute;width:570px;right:4px;top:150px}footer{position:absolute;bottom:42px;color:#a3ff3d;font-size:18px}</style><div class=logo><svg width=54 height=38 viewBox="0 0 42 29"><rect x=1 y=2 width=19 height=25 rx=6.5 fill="#faf9f4"/><rect x=23 y=2 width=18 height=25 rx=6.5 fill="#a3ff3d"/><circle cx=21.5 cy=14.5 r=6.3 fill="#0f1417"/></svg>Joinlet</div><h1>Connect ideas.<br><em>Build systems.</em></h1><p>Your architecture, diagrams and decisions.<br>One connected workspace.</p><img src="data:image/webp;base64,${asset.toString('base64')}" alt=""><footer>joinlet.co</footer>`);
 await page.evaluate(()=>document.fonts.ready);await page.locator('img').evaluate(el=>el.decode());
 await page.screenshot({path:new URL('../public/brand/joinlet-social.png',import.meta.url).pathname});
}finally{await browser.close();}
