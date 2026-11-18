/**
 * 验证 pickSpread 不会再死循环。
 *
 * 为什么要单独测它：v1.9.19 发现原来那句 `idx = (idx + 7) % n` 在
 * **n 是 7 的倍数**时只会在 n/7 个位置上打转 —— `seen` 涨不到 n、`out` 涨不到 k，
 * `while (out.length < k && seen.size < n)` 永远成立，**整个 JS 线程卡死**
 * （表现是 App 假死）。榜单两页拼出来的池子常常就是 35/42/49/56/63 这些数。
 *
 * 这里不是抄一份函数来测，而是**从 bridge.ts 里把那段源码抽出来**、
 * 用项目自己的 typescript 把类型注解去掉再跑 —— 测的就是真身。
 *
 * 用法: node tools/check-pick-spread.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'src/tide/bridge.ts'), 'utf8')

/* 从源码里抽出 pickSpread（含它上面的注释块不管，只取函数本体，按花括号配对） */
const at = src.indexOf('function pickSpread')
if (at < 0) {
  console.error('FAIL  在 bridge.ts 里找不到 pickSpread')
  process.exit(1)
}
let depth = 0
let end = -1
for (let i = src.indexOf('{', at); i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') {
    depth--
    if (depth === 0) { end = i + 1; break }
  }
}
const fnSrc = src.slice(at, end)
const js = ts.transpileModule(fnSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText
// eslint-disable-next-line no-new-func
const pickSpread = new Function(`${js}; return pickSpread`)()

let bad = 0
const check = (label, cond, extra) => {
  if (!cond) bad++
  console.log('%s  %s%s', cond ? 'PASS' : 'FAIL', label, extra ? '  [' + extra + ']' : '')
}

/* 1. 原来会卡死的那些长度：现在必须能返回，而且**恰好 k 个不重复的** */
for (const n of [35, 42, 49, 56, 63, 70, 77, 84, 91, 98, 105, 112, 119]) {
  const list = Array.from({ length: n }, (_, i) => i)
  const t0 = Date.now()
  const out = pickSpread(list, 30, 12345)
  const ms = Date.now() - t0
  const uniq = new Set(out).size
  check(`n=${n}（7 的倍数）取 30 首能返回`, out.length === 30 && uniq === 30 && ms < 100,
        `${out.length} 个 / 不重复 ${uniq} / ${ms}ms`)
}

/* 2. 常规长度：数量对、不重复、都在原数组里 */
for (const n of [31, 40, 60, 100, 141]) {
  const list = Array.from({ length: n }, (_, i) => i)
  const out = pickSpread(list, 30, 7)
  const uniq = new Set(out).size
  const inRange = out.every(v => Number.isInteger(v) && v >= 0 && v < n)
  check(`n=${n} 取 30 首：数量/去重/范围都对`, out.length === 30 && uniq === 30 && inRange,
        `${out.length} 个 / 不重复 ${uniq}`)
}

/* 3. 池子不比要的多么：原样返回 */
const small = [1, 2, 3]
check('池子不够时原样返回', pickSpread(small, 30, 9).length === 3)

/* 4. 同种子同结果、换种子换一批（「换一批」靠这个） */
const l = Array.from({ length: 80 }, (_, i) => i)
const a1 = pickSpread(l, 30, 100).join()
const a2 = pickSpread(l, 30, 100).join()
const b = pickSpread(l, 30, 101).join()
check('同种子结果完全一样（同一天进来是同一批）', a1 === a2)
check('换种子换一批', a1 !== b)

console.log(bad ? `\n==== ${bad} 项不通过` : '\n==== 全部通过')
process.exit(bad ? 1 : 0)
