/**
 * 界面探针 —— 用 uiautomator 读当前界面，或按「文本」定位并点击
 *
 * 为什么要它：本机 shell 是 cmd.exe，中文经命令行传递/控制台输出会被按 GBK 解码而乱码，
 * 靠肉眼比坐标又容易错（页签栏的实际高度取决于 app 窗口，而不是屏幕高度）。
 * 所以统一走「节点文本 → 节点 bounds → 点中心」，并允许用 UTF-8 的十六进制传中文参数。
 *
 * 用法（在工程根目录跑）：
 *   node tools/ui-probe.mjs               打印当前所有可见文本及 bounds
 *   node tools/ui-probe.mjs tap <x> <y>   点一下再打印
 *   node tools/ui-probe.mjs taphex <hex>  点「文本等于 hex 解码结果」的节点中心，再打印
 *
 * 例：点「我的」页签（'我的' 的 UTF-8 是 E6 88 91 E7 9A 84）
 *   node tools/ui-probe.mjs taphex e68891e79a84
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB_PATH ?? 'D:\\android-tools\\sdk\\platform-tools\\adb.exe'
const adb = a => execFileSync(ADB, a, { encoding: 'buffer' })

function dumpXml() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_ui_probe.xml'])
  return adb(['exec-out', 'cat', '/sdcard/_ui_probe.xml']).toString('utf8')
}

function nodes(xml) {
  const out = []
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0]
    const text = (/text="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&#10;/g, '\n')
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)
    if (!b) continue
    const [x1, y1, x2, y2] = b.slice(1).map(Number)
    out.push({ text, x1, y1, x2, y2 })
  }
  return out
}

function printTexts(xml) {
  console.log('--- visible texts (with bounds) ---')
  for (const n of nodes(xml)) {
    if (!n.text) continue
    console.log(`  [${n.x1},${n.y1}][${n.x2},${n.y2}] ${n.text.replace(/\n/g, ' | ').slice(0, 90)}`)
  }
}

const argv = process.argv.slice(2)
const mode = argv[0] ?? 'dump'

if (mode === 'tap') {
  adb(['shell', 'input', 'tap', argv[1], argv[2]])
  console.log(`(tapped ${argv[1]},${argv[2]})`)
  await new Promise(r => setTimeout(r, 6000))
  printTexts(dumpXml())
} else if (mode === 'taphex') {
  const want = Buffer.from(argv[1], 'hex').toString('utf8')
  const ns = nodes(dumpXml())
  const hit = ns.find(n => n.text === want)
  if (!hit) {
    console.log(`NOT FOUND text=${JSON.stringify(want)}`)
    printTexts(dumpXml())
  } else {
    const cx = Math.round((hit.x1 + hit.x2) / 2)
    const cy = Math.round((hit.y1 + hit.y2) / 2)
    console.log(`(found ${JSON.stringify(want)} at [${hit.x1},${hit.y1}][${hit.x2},${hit.y2}] -> tap ${cx},${cy})`)
    adb(['shell', 'input', 'tap', String(cx), String(cy)])
    await new Promise(r => setTimeout(r, 7000))
    printTexts(dumpXml())
  }
} else {
  printTexts(dumpXml())
}
