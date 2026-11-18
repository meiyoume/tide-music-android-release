/**
 * 生成内置音源模块。
 *
 * 用法：node tools/gen-builtin-sources.mjs
 *
 * 为什么用「TS 文件里放一个 JSON.stringify 过的字符串」这种别扭形式：
 * Metro 会把 .js 当**代码**打进 bundle（`import s from './x.js'` 得到的是模块导出，不是原文），
 * 而音源脚本必须**原样**交给沙箱执行。所以只能把它当字符串常量内联，
 * 并且必须 JSON.stringify 转义（脚本里有反引号与 ${}）。
 *
 * 清单在 tools/builtin-sources.manifest.json：slug -> 脚本绝对路径。
 * 生成物：
 *   src/harmony/builtinSources/scripts/<slug>.ts   每个源一个文件
 *   src/harmony/builtinSources/index.ts           清单 + 安装/选择逻辑（模板见 tools/builtin-sources.index.template.ts）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'src/harmony/builtinSources')
const manifestPath = path.join(root, 'tools/builtin-sources.manifest.json')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })

const parseMeta = (s) => {
  const block = /^\/\*[\S|\s]+?\*\//.exec(s)
  const info = {}
  if (!block) return info
  for (const line of block[0].split(/\r?\n/)) {
    const m = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line)
    if (m) info[m[1]] = m[2].trim()
  }
  return info
}

const entries = []
for (const item of manifest.sources) {
  const src = fs.readFileSync(item.path, 'utf8')
  const meta = parseMeta(src)
  if (!meta.name) throw new Error('脚本没有 @name 元信息块: ' + item.path)
  const file = path.join(dir, 'scripts', item.slug + '.ts')
  fs.writeFileSync(file, `/* 自动生成，勿手改 —— 由 tools/gen-builtin-sources.mjs 从\n * ${item.path}\n * 生成。改源请改清单里的路径后重跑生成器。\n */\n/* eslint-disable no-template-curly-in-string -- 脚本原文里本来就有 \${...} */\nexport default ${JSON.stringify(src)}\n`, 'utf8')
  entries.push({ slug: item.slug, meta, note: item.note || '', size: src.length, covered: item.covered || '' })
  console.log(`  ${item.slug.padEnd(14)} ${String(meta.name).padEnd(28)} v${meta.version || '?'}  ${(src.length / 1024).toFixed(1)}KB  ${item.covered || ''}`)
}

fs.writeFileSync(path.join(dir, 'generated-manifest.json'), JSON.stringify(entries, null, 2), 'utf8')
console.log(`\n生成 ${entries.length} 个源 → ${path.relative(root, path.join(dir, 'scripts'))}`)
console.log('现在请更新 index.ts 的 import 与 BUILTIN 清单（生成器不动 index.ts，避免覆盖手写逻辑）。')
