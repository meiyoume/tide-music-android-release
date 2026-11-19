/* ═══════════════════════════════════════════════════════════
   用 CDP 量「主线程开销」—— 比数 DOM 变更更接近「流畅度」。

   为什么不用截图 / 模拟器：模拟器的空白时长量的是 swiftshader（见
   TIDE-ANDROID.md 的坑 35），量不出主线程重排。这里直接连 Edge 的
   DevTools 协议，读 Performance.getMetrics 里的 LayoutCount /
   RecalcStyleCount / LayoutDuration / RecalcStyleDuration —— 这几个数是
   渲染进程自己数的，骗不了人。

   四个工作负载，C 与 B 的差就是「播放中那几条进度动画」的净开销：

     A 空闲           没有歌，什么都不动
     B 迷你条·暂停     有歌、迷你条在屏幕上，但位置不动
     C 迷你条·播放中   进度事件 4Hz × 3 秒（迷你条宽度一直在过渡）
     D 播放页·播放中   同上，但播放页开着（进度条填充 + 圆点也在过渡）

   用法：node tools/_perf-cdp.mjs <标签>
   会生成 perf-cdp.html（index.html + cdp-bridge.js）并写 perf-cdp-<标签>.txt
   ═══════════════════════════════════════════════════════════ */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.argv[2] || 'run';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SECONDS = 3;
const HZ = 4;                     // 内核推进度的频率（真机就是每秒 4 次）

/* ── 1. 现造一个页面：index.html + cdp-bridge.js（必须插在 api.js 之前） ── */
const ANCHOR = '<script src="api.js';
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const at = html.indexOf(ANCHOR);
if (at < 0) throw new Error('找不到 api.js 的 script 标签，index.html 结构变了？');
await writeFile(join(ROOT, 'perf-cdp.html'),
  html.slice(0, at) + '<script src="tools/cdp-bridge.js"></script>\n' + html.slice(at), 'utf8');

/* ── 2. 起一个静态服务器（file:// 下 localStorage 会被拦，页面逻辑会变） ── */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(500).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ── 3. 起 Edge，拿 CDP 端口 ── */
const profile = join(tmpdir(), 'edgeprof-cdp-' + Date.now());
const proc = spawn(EDGE, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=460,900', '--force-device-scale-factor=1',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  `http://127.0.0.1:${PORT}/perf-cdp.html`,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtoolsPort() {
  for (let i = 0; i < 100; i++) {
    try {
      const txt = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const p = Number(txt.split('\n')[0]);
      if (p) return p;
    } catch {}
    await sleep(100);
  }
  throw new Error('等不到 DevToolsActivePort');
}

let ws;
try {
  const dp = await devtoolsPort();
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json();
    target = list.find(t => t.type === 'page' && t.url.includes('perf-cdp.html'));
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('找不到页面 target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const waiting = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  function send(method, params) {
    const id = ++seq;
    return new Promise((res, rej) => {
      waiting.set(id, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error('页面里出错: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Performance.enable');

  /* 等界面起来（boot() 里 home 回来、迷你条就绪） */
  for (let i = 0; i < 100; i++) {
    const ok = await evaluate('!!(window.Tide && window.Tide.isNative && document.querySelector("#listLikes .song"))');
    if (ok) break;
    await sleep(200);
  }
  await evaluate('try{ if(window.Sfx){ Sfx.setEnabled(false); Sfx.play=function(){}; } }catch(e){}');

  const METRICS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'];
  async function metrics() {
    const { metrics: list } = await send('Performance.getMetrics');
    const o = {};
    for (const m of list) if (METRICS.includes(m.name)) o[m.name] = m.value;
    return o;
  }
  const diff = (a, b) => Object.fromEntries(METRICS.map(k => [k, +(b[k] - a[k]).toFixed(4)]));

  /* emit=false 的那两段是**对照**：同样把界面摆好，但一秒也不推进度。
     C 减 B 才是「播放中那几条进度动画」的净开销。 */
  async function run(name, setup, note, emit) {
    if (setup) await evaluate(setup);
    await sleep(700);                       // 让上一段彻底停下来
    const m0 = await metrics();
    const info = await evaluate(`(async () => {
      const t0 = performance.now();
      let anims = [], frames = 0;
      if (${emit}) {
        while (performance.now() - t0 < ${SECONDS * 1000}) {
          window.__emit('progress', { position: 10 + (performance.now() - t0) / 1000, duration: 231 });
          if (!anims.length) { const a = window.__anims(); if (a.length) anims = a; }
          frames++;
          await new Promise(r => setTimeout(r, ${Math.round(1000 / HZ)}));
        }
      } else {
        await new Promise(r => setTimeout(r, ${SECONDS * 1000}));
        anims = window.__anims();
      }
      return { anims, frames };
    })()`);
    const m1 = await metrics();
    return { name, note, ...diff(m0, m1), anims: info.anims, frames: info.frames };
  }

  const results = [];

  /* A 空闲：没有歌，什么都不动 */
  results.push(await run('A 空闲', null, '没有歌，屏幕上没有任何东西在动', false));

  /* B 迷你条·暂停：有歌、迷你条在屏幕上，但进度不动（对照） */
  results.push(await run('B 迷你条·暂停',
    `window.__emit('player', { song: { key:'k1', name:'压测歌曲 1', singer:'压测歌手 1', album:'压测专辑 1', interval:'3:55', source:'kw', pic:'' }, isPlay: false, position: 30, duration: 231, mode: 2, liked: false });`,
    '有歌、迷你条在屏幕上，进度不动（对照）', false));

  /* C 迷你条·播放中：进度 4Hz，迷你条宽度一直在过渡 */
  results.push(await run('C 迷你条·播放中',
    `window.__emit('player', { song: { key:'k1', name:'压测歌曲 1', singer:'压测歌手 1', album:'压测专辑 1', interval:'3:55', source:'kw', pic:'' }, isPlay: true, position: 30, duration: 231, mode: 2, liked: false });`,
    `进度 ${HZ}Hz × ${SECONDS}s —— 迷你条在播放条上`, true));

  /* D 播放页·播放中：播放页开着，进度条填充 + 圆点 + 迷你条三条一起动 */
  results.push(await run('D 播放页·播放中',
    `document.getElementById('miniTap').click();`,
    `进度 ${HZ}Hz × ${SECONDS}s —— 播放页开着（含歌词层）`, true));

  const lines = [`=== ${LABEL} ===`,
    `每段都是「静置 0.7s 后取一次指标 → 推 ${HZ}Hz 进度 ${SECONDS} 秒 → 再取一次」，下面是差值。`,
    `LayoutCount=重排次数  RecalcStyleCount=样式重算次数  LayoutDuration=重排耗时(s)  RecalcStyleDuration=样式重算耗时(s)  ScriptDuration=JS 耗时(s)  TaskDuration=主线程总耗时(s)`,
    ''];
  for (const r of results) {
    lines.push(`${r.name.padEnd(18)} ${r.note}`);
    lines.push(`  重排 ${String(r.LayoutCount).padStart(5)} 次 / 样式重算 ${String(r.RecalcStyleCount).padStart(5)} 次`
      + `  重排 ${r.LayoutDuration.toFixed(3)}s  样式 ${r.RecalcStyleDuration.toFixed(3)}s`
      + `  JS ${r.ScriptDuration.toFixed(3)}s  主线程 ${r.TaskDuration.toFixed(3)}s`);
    if (r.anims && r.anims.length) lines.push('  期间在跑的动画: ' + r.anims.join('  |  '));
    lines.push('');
  }
  const out = lines.join('\n');
  console.log(out);
  await writeFile(join(ROOT, `perf-cdp-${LABEL}.txt`), out + '\n', 'utf8');
} finally {
  try { ws && ws.close(); } catch {}
  try { proc.kill(); } catch {}
  server.close();
  await sleep(300);
  try { await rm(profile, { recursive: true, force: true }); } catch {}
}
