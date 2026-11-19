/**
 * v3 视觉走查：一次跑完手机 / 平板两套版式的各页截图。
 *
 *   node tools/_shots-v3.mjs phone light dune
 *   node tools/_shots-v3.mjs tablet dark ink
 *   node tools/_shots-v3.mjs phone dark ink player   // 只跑名字含 player 的状态
 *
 * 走 CDP（Page.captureScreenshot）而不是 --screenshot：
 * 无头 Edge 的 --screenshot 合成路径会漏画带模糊/变换/滚动的层
 * （实测：队列抽屉整个白板、平板播放页右栏消失，DOM 里却都在）。
 * CDP 拿到的才是真正画出来的那一帧。
 *
 * 静态服务用 Python 的 http.server（Node 自己写的服务会让 Edge 卡住不退出）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = resolve(import.meta.dirname, '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = join(ROOT, 'shots')
const PORT = 8782
const CDP_PORT = 9335

const FORM = process.argv[2] || 'phone'
const THEME = process.argv[3] || 'light'
const SKIN = process.argv[4] || 'dune'
const ONLY = process.argv[5] || ''

const ACCENTS = {
  ink: '#3ECFB2', midnight: '#7C6BFF', abyss: '#4EA8FF',
  dune: '#FFB454', sakura: '#FF6BCB', cyber: '#4ADE80',
}
const ACCENT = ACCENTS[SKIN] || '#3ECFB2'

const LIB = '[data-tab-go="library"]'
const ROW = '#listLikes [data-token]'

const PHONE_STATES = {
  home: ['', [], 0],
  charts: ['tab=charts', [], 0],
  search: ['push=scr-search', [], 0],
  fav: ['tab=fav', [], 0],
  library: ['tab=library', [], 0],
  playlist: ['', ['#homePlaylists [data-playlist]'], 700],
  daily: ['', ['.dailypick'], 700],
  square: ['', ['[data-push="scr-square"]'], 700],
  player: ['', [ROW, '#miniTap'], 900],
  lyrics: ['', [ROW, '#miniTap', '#pArt'], 900],
  queue: ['', [ROW, '#miniTap', '#pQueue'], 900],
  theme: ['', [LIB, '[data-push="scr-set-theme"]'], 700],
}

const TABLET_STATES = {
  home: ['', [], 0],
  charts: ['tab=charts', [], 0],
  search: ['push=scr-search', [], 0],
  fav: ['tab=fav', [], 0],
  library: ['tab=library', [], 0],
  playlist: ['', ['#homePlaylists [data-playlist]'], 700],
  player: ['', [ROW, '#miniTap'], 900],
  queue: ['', [ROW, '#miniTap', '#pQueue'], 900],
  theme: ['', [LIB, '[data-push="scr-set-theme"]'], 700],
}

const isPhone = FORM === 'phone'
const metrics = isPhone
  ? { width: 411, height: 914, deviceScaleFactor: 2, mobile: false }
  : { width: 1120, height: 780, deviceScaleFactor: 1, mobile: false }
const states = isPhone ? PHONE_STATES : TABLET_STATES
const prefix = `v3-${isPhone ? 'p' : 't'}-${THEME}-`

const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', ROOT], {
  stdio: 'ignore', windowsHide: true,
})
await sleep(700)

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--disable-sync', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${CDP_PORT}`,
  '--user-data-dir=' + join(process.env.TEMP, `edgeprof-cdp-${FORM}-${THEME}-${Date.now()}`),
  '--window-size=1300,1000',
  'about:blank',
], { stdio: 'ignore' })

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(300)
  }
  throw new Error('CDP 没起来')
}

const target = await pageTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(res => {
  const i = ++seq
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', metrics)
mkdirSync(OUT, { recursive: true })

for (const [name, [query, clicks, gap]] of Object.entries(states)) {
  if (ONLY && !name.includes(ONLY)) continue
  let url = `http://127.0.0.1:${PORT}/tools/preview.html?theme=${THEME}&skin=${SKIN}`
            + `&accent=${encodeURIComponent(ACCENT)}&noboot=1`
  if (query) url += '&' + query
  if (clicks.length) {
    url += '&clicks=' + encodeURIComponent(clicks.join('|')) + `&gap=${gap}&delay=1200`
  }
  await send('Page.navigate', { url })
  await sleep(1500 + gap * clicks.length + 1400)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const dest = join(OUT, `${prefix}${name}.png`)
  const data = shot.result?.data
  if (data) {
    writeFileSync(dest, Buffer.from(data, 'base64'))
    console.log(`${(prefix + name).padEnd(22)} ok ${Math.round(Buffer.from(data, 'base64').length / 1024)} KB`)
  } else {
    console.log(`${prefix + name} FAILED`)
  }
}

ws.close()
browser.kill()
server.kill()
