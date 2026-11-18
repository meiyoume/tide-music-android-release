#!/usr/bin/env node
/**
 * 把潮汐 Web UI 同步进安卓 assets（顺带压缩）
 *
 * 界面工程是独立的（能单独用浏览器打开预览），这里是把它拷进 APK。
 * 之所以不把界面源码放进 src/ 下，是因为它是纯 HTML/CSS/JS、不参与 Metro 打包，
 * 走 `android/app/src/main/assets/` 这条原生资源通道，WebView 用
 * `file:///android_asset/tide/index.html` 加载（与项目里 user-api-preload.js 同一套路子）。
 *
 * 为什么要压缩：冷启动时 WebView 从导航到 app.js 开始执行要 ~540ms（模拟器实测），
 * 这段时间几乎全是**解析/编译**这 386KB 的 HTML/CSS/JS。压缩后体积减 40% 左右，
 * 解析时间跟着降。源码仍然保持可读（预览、调试看到的都是原文件）。
 *
 * 压缩的边界（保守优先）：
 *   · JS 用 terser，但 **compress / mangle 全关**，只去注释和空白 ——
 *     代码里有些依赖具体写法的钩子，压缩器重写逻辑不值得为几十 KB 冒风险；
 *   · CSS 用下面那段扫描器去注释 + 折叠空白，字符串里的 `/*` 不会被误吃；
 *   · HTML 不动（内联 SVG sprite、空白敏感的地方多）。
 *
 * 用法：
 *   node tools/sync-tide-assets.mjs            # 压缩后同步
 *   node tools/sync-tide-assets.mjs --raw      # 原样拷贝（排查压缩问题时用）
 *   TIDE_UI_SRC=D:/path/to/ui node tools/sync-tide-assets.mjs
 *
 * 改了界面记得重跑一次，否则 APK 里还是旧的。
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { minify } = require('terser')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.TIDE_UI_SRC || 'C:/Users/meiyou/.zcode/workspace/default/music-ui-mobile'
const DEST = join(root, 'android', 'app', 'src', 'main', 'assets', 'tide')
const RAW = process.argv.includes('--raw')

/** 只拷运行时真正要用的五个文件；README/工具脚本不进包 */
const FILES = ['index.html', 'styles.css', 'sfx.js', 'api.js', 'app.js']

const kb = n => (n / 1024).toFixed(1) + ' KB'

/**
 * 去 CSS 注释 + 折叠空白。
 *
 * 逐字符扫描而不是正则替换：`content: "/*"` 这种字符串里的注释开头不能被吃掉。
 * 不删 `:` `+` `-` 周围的空格 —— `calc(a + b)` 和后代选择器 `a :hover` 都靠它们。
 */
function minifyCss(css) {
  let out = ''
  let quote = null
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (quote) {
      out += c
      if (c === '\\') { out += css[++i] ?? ''; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
      continue
    }
    out += c
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

async function main() {
  try {
    const s = await stat(SRC)
    if (!s.isDirectory()) throw new Error('不是目录')
  } catch (e) {
    console.error(`✗ 界面源目录不存在：${SRC}`)
    console.error('  用 TIDE_UI_SRC 指定，或确认路径是否正确。')
    process.exit(1)
  }

  await mkdir(DEST, { recursive: true })

  let before = 0
  let after = 0
  for (const name of FILES) {
    const from = join(SRC, name)
    let code
    try {
      code = await readFile(from, 'utf8')
    } catch (e) {
      console.error(`✗ 缺少文件：${from}`)
      process.exit(1)
    }
    const srcSize = Buffer.byteLength(code)
    before += srcSize
    let outCode = code
    if (!RAW) {
      if (name.endsWith('.js')) {
        const res = await minify(code, {
          compress: false,
          mangle: false,
          format: { comments: false },
        })
        if (typeof res.code !== 'string') throw new Error(`${name} 压缩失败`)
        outCode = res.code
      } else if (name.endsWith('.css')) {
        outCode = minifyCss(code)
      }
    }
    await writeFile(join(DEST, name), outCode)
    const outSize = Buffer.byteLength(outCode)
    after += outSize
    const pct = srcSize ? Math.round((outSize / srcSize) * 100) : 100
    console.log(`  ${name.padEnd(12)} ${kb(srcSize).padStart(9)} -> ${kb(outSize).padStart(9)}  (${pct}%)`)
  }

  console.log(`\n✓ 已同步到 ${DEST}`)
  console.log(`  ${FILES.length} 个文件，${kb(before)} -> ${kb(after)}${RAW ? '（原样）' : ''}`)
  console.log('  改完界面记得重新打包，assets 不会热更新。')
}

void main().catch(err => {
  console.error('✗ 同步失败：', err)
  process.exit(1)
})
