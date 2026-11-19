/**
 * 抽屉探针：点开播放队列，用 CDP 看 .sheet 及其子节点的实际状态，并抓一张可信截图。
 *   node tools/_probe-sheet.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'

const PORT = 9334
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://127.0.0.1:8781/tools/preview.html?theme=dark&skin=ink&accent=%233ECFB2&noboot=1'

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\edgeprof-probe-sheet-' + Date.now(),
  '--window-size=1120,780',
  URL,
], { stdio: 'ignore' })

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(300)
  }
  throw new Error('CDP 没起来')
}
const page = await targets()
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

await sleep(2500)
await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  d.querySelector('#listLikes [data-token]').click()
  return 1
})()`)
await sleep(1000)
await evalJs(`document.querySelector('#app').contentDocument.querySelector('#miniTap').click()`)
await sleep(900)
await evalJs(`document.querySelector('#app').contentDocument.querySelector('#pQueue').click()`)
await sleep(1200)

const out = await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  const w = document.querySelector('#app').contentWindow
  const pick = sel => {
    const el = d.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = w.getComputedStyle(el)
    return {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
      color: cs.color, bg: cs.backgroundColor, transform: cs.transform,
    }
  }
  return {
    vw: w.innerWidth, vh: w.innerHeight,
    sheetOpen: d.querySelector('#queueSheet').className,
    sheet: pick('#queueSheet'),
    head: pick('#queueSheet .sheet__head'),
    title: pick('#queueSheet .sheet__title'),
    list: pick('#listQueue'),
    firstRow: pick('#listQueue .song'),
    rows: d.querySelectorAll('#listQueue .song').length,
    mask: pick('#sheetMask'),
  }
})()`)
console.log(JSON.stringify(out, null, 2))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('shots/probe-sheet.png', Buffer.from(shot.result.data, 'base64'))
console.log('shot -> shots/probe-sheet.png')
ws.close()
child.kill()
