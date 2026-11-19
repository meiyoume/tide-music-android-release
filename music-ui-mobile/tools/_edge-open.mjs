/**
 * 用 Node 拉起无头 Edge 打开一个页面，等它自己把结果 POST 回去。
 *
 *   node tools/_edge-open.mjs <url> [秒数=200] [宽=500] [高=960]
 *
 * 存在的理由：这台机器上从 Python 的 subprocess 里拉 msedge 会 0.1 秒退出
 * （rc 0，什么都不做），从 Node 的 spawn 拉就正常。ui-check.py 的服务器与
 * 结果收集留在 Python，浏览器这一半交给他。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const url = process.argv[2]
const hold = Number(process.argv[3] || 200) * 1000
const W = Number(process.argv[4] || 500)
const H = Number(process.argv[5] || 960)
const PORT = 9337
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

if (!url) {
  console.error('用法: node tools/_edge-open.mjs <url> [秒数] [宽] [高]')
  process.exit(2)
}

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\edgeprof-open-' + Date.now(),
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 50; i++) {
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
await send('Page.navigate', { url })
console.log('[edge-open] navigated', url)
await sleep(hold)
ws.close()
child.kill()
console.log('[edge-open] done')
