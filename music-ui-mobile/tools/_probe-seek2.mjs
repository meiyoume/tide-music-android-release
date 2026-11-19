/**
 * 真·拖拽探针：用 CDP 的 Input.dispatchMouseEvent 在进度条上按一条真实指针路径拖动
 * （不是页面里 dispatchEvent 的合成事件 —— 走的是命中测试 + setPointerCapture + rAF 批处理
 * 这条真链路）。
 *
 *   node tools/_probe-seek2.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9339
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://127.0.0.1:8781/tools/preview.html?theme=dark&skin=ink&accent=%233ECFB2&noboot=1'

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\edgeprof-seek2-' + Date.now(),
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
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text }
  return r.result?.result?.value
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 411, height: 914, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: URL })
await sleep(3200)

await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  d.querySelector('#listLikes [data-token]').click()
  return true
})()`)
await sleep(1000)
await evalJs(`document.querySelector('#app').contentDocument.querySelector('#miniTap').click()`)
await sleep(1200)

const geo = await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  const f = document.querySelector('#app')
  const fr = f.getBoundingClientRect()
  const r = d.querySelector('#pBar').getBoundingClientRect()
  return { fx: fr.left, fy: fr.top, x: r.left, y: r.top + r.height / 2, w: r.width, h: r.height }
})()`)
console.log('bar', JSON.stringify(geo))

const ratioOf = () => evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  const w = document.querySelector('#app').contentWindow
  const m = w.getComputedStyle(d.querySelector('#pFill')).transform
  const mm = /matrix\\(([^)]+)\\)/.exec(m)
  return { ratio: mm ? Number(mm[1].split(',')[0]) : null,
           cur: d.querySelector('#pCur').textContent,
           dragging: d.querySelector('#pBar').classList.contains('is-dragging') }
})()`)

const at = r => geo.fx + geo.x + geo.w * r
const y = geo.fy + geo.y
const mouse = (type, x, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra })

// 按下在 20%
await mouse('mousePressed', at(0.2))
await sleep(80)
const r1 = await ratioOf()

// 拖到 50%，中间分几步
for (const t of [0.3, 0.4, 0.5]) { await mouse('mouseMoved', at(t), { button: 'left' }); await sleep(30) }
await sleep(120)
const r2 = await ratioOf()

// 停手 900ms：内核会推 3~4 次进度，条子不能被拽回去
await sleep(900)
const r3 = await ratioOf()

// 继续拖到 80%，松手
for (const t of [0.6, 0.7, 0.8]) { await mouse('mouseMoved', at(t), { button: 'left' }); await sleep(30) }
await sleep(120)
await mouse('mouseReleased', at(0.8))
await sleep(80)
const r4 = await ratioOf()
await sleep(600)
const r5 = await ratioOf()

console.log(JSON.stringify({ down20: r1, move50: r2, idle900: r3, up80: r4, afterUp600: r5 }, null, 2))
ws.close()
child.kill()
