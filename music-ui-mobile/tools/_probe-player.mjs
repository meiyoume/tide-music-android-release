/**
 * 平板播放页布局探针：连 CDP，在 iframe 里点开播放页，读出右栏三块的几何与透明度。
 *
 * 用法：node tools/_probe-player.mjs <width> <height>
 *   node tools/_probe-player.mjs 1120 780
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const W = Number(process.argv[2] || 1120)
const H = Number(process.argv[3] || 780)
const PORT = 9333
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://127.0.0.1:8781/tools/preview.html?theme=light&skin=dune&accent=%23FFB454&noboot=1'

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP + '\\edgeprof-probe-' + Date.now()),
  `--window-size=${W},${H}`,
  URL,
], { stdio: 'ignore' })

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
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
// 在 iframe 里选一首歌、打开播放页
console.log(await evalJs(`(() => {
  const d = document.querySelector('#app').contentDocument
  const w = document.querySelector('#app').contentWindow
  const row = d.querySelector('#listLikes [data-token]')
  if (row) row.click()
  return { row: !!row, mini: !d.querySelector('#mini').hidden }
})()`))
await sleep(1200)
await evalJs(`document.querySelector('#app').contentDocument.querySelector('#miniTap').click()`)
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
      color: cs.color, zIndex: cs.zIndex,
    }
  }
  return {
    vw: w.innerWidth, vh: w.innerHeight,
    player: pick('#player'),
    top: pick('.player__top'),
    stage: pick('.player__stage'),
    hint: pick('.player__hint'),
    progress: pick('.player__progress'),
    controls: pick('.player__controls'),
    bottom: pick('.player__bottom'),
    cols: w.getComputedStyle(d.querySelector('#player')).gridTemplateColumns,
    rows: w.getComputedStyle(d.querySelector('#player')).gridTemplateRows,
    motion: d.documentElement.className,
  }
})()`)

console.log(JSON.stringify(out, null, 2))

/* --screenshot 走的是 headless 自己的合成路径，重模糊背景之上那几层会漏画；
   用 CDP 的 Page.captureScreenshot 取一张可信的。 */
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
const dest = 'shots/probe-player.png'
fs.writeFileSync(dest, Buffer.from(shot.result.data, 'base64'))
console.log('shot ->', dest)

ws.close()
child.kill()
