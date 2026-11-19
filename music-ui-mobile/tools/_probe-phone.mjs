/**
 * 手机版式体检：量页签栏/迷你条/底部留白是否被裁。
 *   node tools/_probe-phone.mjs [width] [height]
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const W = Number(process.argv[2] || 411)
const H = Number(process.argv[3] || 914)
const THEME = process.argv[4] || 'dark'
const SKIN = process.argv[5] || 'ink'
const ACC = process.argv[6] || '#3ECFB2'
const PORT = 9336
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://127.0.0.1:8781/tools/preview.html?theme=' + THEME + '&skin=' + SKIN
  + '&accent=' + encodeURIComponent(ACC) + '&noboot=1'

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\edgeprof-probe-phone-' + Date.now(),
  '--window-size=900,1000',
  'about:blank',
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find(t => t.type === 'page')
      if (p) return p
    } catch {}
    await sleep(300)
  }
  throw new Error('CDP 没起来')
}
const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(res => {
  const i = ++id
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const evalJs = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: URL })
await sleep(3200)

console.log(JSON.stringify(await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  const w = document.querySelector('#app').contentWindow
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const cs = el => w.getComputedStyle(el)
  const tab = d.querySelector('.tab')
  const label = tab.querySelector('span')
  const bar = d.querySelector('.tabbar')
  const mini = d.querySelector('#mini')
  const home = d.querySelector('#scr-home .scroll')
  return {
    vw: w.innerWidth, vh: w.innerHeight,
    tabbar: box(bar), tabBarBottomGap: Math.round(w.innerHeight - (bar.getBoundingClientRect().bottom)),
    tab: box(tab), label: box(label),
    labelBottomGap: Math.round(w.innerHeight - label.getBoundingClientRect().bottom),
    tabPad: cs(tab).padding, tabGap: cs(tab).gap, tabFont: cs(label).fontSize,
    mini: mini.hidden ? null : box(mini),
    homePadBottom: cs(home).paddingBottom,
    homeScrollH: home.scrollHeight, homeClientH: home.clientHeight,
    accent: cs(d.documentElement).getPropertyValue('--accent').trim(),
    accentInk: cs(d.documentElement).getPropertyValue('--accent-ink').trim(),
    bodyOverflowX: d.documentElement.scrollWidth > w.innerWidth,
    quickIcoColor: cs(d.querySelector('.quick__ico')).color,
    tabOnColor: cs(d.querySelector('.tab.is-on')).color,
    titleColor: cs(d.querySelector('.hero-head__title')).color,
  }
})()`), null, 2))

ws.close()
child.kill()
