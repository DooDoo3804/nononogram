// scripts/probe-framing.mjs — one-shot framing probe.
//
// Reads the framing a real page actually ends up with: canvas box, camera distance, and
// the projected extent of the board, for one viewport and one dims. The bench reports
// these per run; this prints them for a single configuration so a framing question can
// be answered in two seconds instead of a four-second measurement window per size.
//
//   node scripts/probe-framing.mjs <base> [WxH@dpr] [dims]

import { launchChrome } from './cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4373';
const [box, dims = '6x6x6'] = process.argv.slice(3);
const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(box ?? '915x412@2.625');
if (!m) throw new Error(`bad viewport ${box} — want WxH@dpr`);
const [width, height, dpr] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 2)];

const browser = await launchChrome({ offline: true });
const page = await browser.newPage();
await page.emulate({ width, height, deviceScaleFactor: dpr, mobile: true, cpuThrottle: 1 });
await page.goto(`${BASE}/bench/?suite=${dims}&sec=0.3&sync=0`);
await page.waitFor('window.__bench?.done === true', { timeoutMs: 60_000 });

const out = await page.evaluate(`JSON.stringify((() => {
  const c = document.getElementById('scene');
  const r = window.__bench.results[0];
  return {
    css: [c.clientWidth, c.clientHeight],
    aspect: c.clientWidth / c.clientHeight,
    buffer: [c.width, c.height],
    row: r,
  };
})())`).then(JSON.parse);

console.log(`viewport ${width}x${height}@${dpr}   dims ${dims}`);
console.log(`canvas   ${out.css[0]}x${out.css[1]} css  (aspect ${out.aspect.toFixed(3)})  buffer ${out.buffer[0]}x${out.buffer[1]}`);
console.log(`fit      ${out.row.fit} margin ${out.row.fitMargin}   distance ${out.row.fitDistance}`);
console.log(`extent   |x| ${out.row.extentX.toFixed(4)}  |y| ${out.row.extentY.toFixed(4)}  (NDC; >1 is off-canvas)`);
console.log(`coverage ${(out.row.coverage * 100).toFixed(1)}%${out.row.clipped ? '  CLIPPED' : ''}   boardPx ${out.row.boardPx.toLocaleString()} of ${out.row.bufferPx.toLocaleString()}`);
console.log(`pick     ${out.row.picked === null ? 'MISS' : out.row.picked}`);
console.log(`errors   ${page.errors().join(' | ') || 'none'}`);

await browser.close();
