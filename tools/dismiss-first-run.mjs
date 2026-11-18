/**
 * 关掉洛雪首次启动的三个弹窗（谨防被骗提示 / 许可协议 / 免费开源提示）
 *
 * 弹窗是 RN Modal，**用系统返回键关不掉**，只能点它的按钮。
 * 用 uiautomator 找按钮节点（比猜坐标可靠；坐标在不同设备上不一样）。
 *
 * 两个必须注意的坑：
 *  1. 「不接受」里也含「接受」，**必须先排除**，否则会点到「不接受」（= 退出并清数据）。
 *  2. 许可协议正文段落里也含「接受」字样，所以要先找**精确匹配**的节点，
 *     退而求其次才找「包含」的，并且取**文本最短**的那个（按钮总是最短的）。
 *
 * 用法：循环调用直到输出 NO_DIALOG
 *   node tools/dismiss-first-run.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? 'D:\\android-tools\\sdk\\platform-tools\\adb.exe'
const adb = a => execFileSync(ADB, a, { encoding: 'buffer' })

/** 可以点的确认按钮文案（按精确匹配用） */
const ACCEPT = ['我知道了', '接受', '好的', 'OK', 'CLOSE', '知道了']
/** 绝不能点的（含「接受」二字，会退出并清数据） */
const NEGATIVE = ['不接受', '不接收', '退出']

adb(['shell', 'uiautomator', 'dump', '/sdcard/_ui_probe.xml'])
const xml = adb(['exec-out', 'cat', '/sdcard/_ui_probe.xml']).toString('utf8')

const nodes = []
for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
  const tag = m[0]
  const text = (/text="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&#10;/g, '\n')
  const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)
  if (!b) continue
  const [x1, y1, x2, y2] = b.slice(1).map(Number)
  nodes.push({ text, x1, y1, x2, y2 })
}

const usable = nodes.filter(n => n.text && !NEGATIVE.some(b => n.text.includes(b)))

let hit = usable.find(n => ACCEPT.includes(n.text))
let how = 'exact'
if (!hit) {
  const cands = usable.filter(n => ACCEPT.some(a => n.text.includes(a)))
  cands.sort((a, b) => a.text.length - b.text.length)
  hit = cands[0]
  how = 'shortest'
}

if (!hit) {
  console.log('NO_DIALOG')
  process.exit(0)
}

const cx = Math.round((hit.x1 + hit.x2) / 2)
const cy = Math.round((hit.y1 + hit.y2) / 2)
console.log(`TAP(${how}) ${JSON.stringify(hit.text.slice(0, 30))} at ${cx},${cy}`)
adb(['shell', 'input', 'tap', String(cx), String(cy)])
