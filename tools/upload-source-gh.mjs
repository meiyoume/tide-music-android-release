// 把工程源码传到 GitHub 仓库（本机没装 git，走 Git Data API 批量提交）
// 用法：node tools/upload-source-gh.mjs [--dry]
//   --dry  只列出将要上传的文件与体积，不发起写请求

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const OWNER = 'meiyoume'
const REPO = 'tide-music-android-release'
const BRANCH = 'main'
const API = 'https://api.github.com'
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'tide-source-upload',
}
const DRY = process.argv.includes('--dry')
const CACHE_FILE = path.join(ROOT, 'tools', '.upload-source-cache.json')
let blobCache = {}
try { blobCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch { /* 首次上传 */ }

// 整目录排除：构建产物、模拟器截图、旧 APK、依赖、签名材料
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.gradle', 'build', 'build-staging',
  'shots', 'apk-release', '.idea', '.vscode', 'release',
  // 上游 CI 工作流不该进这个 release-only 仓库（会触发构建），
  // 而且 GitHub API 改 `.github/workflows/*` 需要 workflow scope，否则 create-tree 直接 404
  '.github/workflows',
])
// 单文件排除：签名密钥、机器相关配置、日志、二进制产物
const SKIP_FILE = [
  /(^|\/)(local\.properties|keystore\.properties|\.env.*|.*credentials.*|.*secret.*)$/i,
  /\.(keystore|jks|p12|pem|key|apk|apks|aab|log|tmp|swp)$/i,
  /^(hs_err_pid|replay_pid)/i,
  /(^|\/)\.DS_Store$/,
  /^\$null$/i,
  /^\.gitignore$/i, // EXTRA 里提供更新过的版本
  /^README\.md$/i,  // README 内容在下面现拼，避免重复路径（重复路径会让 create-tree 404）
  /^tools\/\.upload-source-cache\.json$/i,
]

const files = []
function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(r)) continue
      walk(p, r)
    } else if (e.isFile() && !SKIP_FILE.some(re => re.test(r))) {
      files.push({ rel: r, abs: p, size: fs.statSync(p).size })
    }
  }
}
walk(ROOT)

// 虚拟文件：公开仓库不上传私钥，留一份占位说明
const EXTRA = [
  {
    rel: '.gitignore',
    content: `node_modules/\n.gradle/\nbuild/\nlocal.properties\nandroid/app/build/\nandroid/keystore.properties\n*.keystore\n*.jks\n*.apk\n*.apks\n*.aab\n*.log\nshots/\nbuild-staging/\n`,
  },
  {
    rel: 'android/keystore.properties.example',
    content: `storeFile=lxmusic.keystore\nstorePassword=CHANGE_ME\nkeyAlias=CHANGE_ME\nkeyPassword=CHANGE_ME\n`,
  },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function request(method, url, body) {
  let lastErr
  for (let attempt = 0; attempt < 6; attempt++) {
    let res
    try {
      res = await fetch(API + url, {
        method,
        headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      lastErr = e
      await sleep(1000 * (attempt + 1))
      continue
    }
    const text = await res.text()
    if (res.ok) return text ? JSON.parse(text) : null
    const retryable = res.status === 403 || res.status === 429 || res.status >= 500
    if (retryable) {
      lastErr = new Error(`${res.status} ${text.slice(0, 160)}`)
      // 二级限流（create blob 太密）要退避更久，否则一直 403
      const secondary = /secondary rate limit/i.test(text)
      const wait = secondary ? 20000 * (attempt + 1) : 1200 * (attempt + 1)
      if (secondary) console.log(`  触发二级限流，退避 ${Math.round(wait / 1000)}s ...`)
      await sleep(wait)
      continue
    }
    throw new Error(`${res.status} ${url}: ${text.slice(0, 300)}`)
  }
  throw lastErr ?? new Error('retries exhausted: ' + url)
}

async function main() {
  // README：保留仓库原有内容，末尾追加源码说明
  let readme = ''
  try {
    const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/README.md`, {
      headers: { ...HEADERS, Accept: 'application/vnd.github.raw+json' },
    })
    if (res.ok) readme = await res.text()
  } catch { /* 没有 README 就新建 */ }
  const NOTE = `\n\n## 源码\n\n本仓库同时存放潮汐音乐安卓版的完整源码（WebView 界面 + 洛雪内核移植），\n当前版本 v1.9.32。先读 \`TIDE-ANDROID.md\`，构建说明见其中「怎么用」一节。\n\n- 签名密钥 \`android/app/lxmusic.keystore\` 与 \`android/keystore.properties\` **不在仓库里**；\n  本地打包请把 \`android/keystore.properties.example\` 复制成 \`android/keystore.properties\` 并填自己的值。\n- 安装包仍在 Releases 页：每个版本手机 / 平板各一个 arm64 APK。\n`
  if (!readme.includes('## 源码')) readme = (readme.trimEnd() + NOTE).trimStart()

  const total = files.reduce((n, f) => n + f.size, 0) + EXTRA.reduce((n, f) => n + Buffer.byteLength(f.content), 0)
  const jobs = [
    ...files.map(f => ({ rel: f.rel, buf: fs.readFileSync(f.abs) })),
    ...EXTRA.map(f => ({ rel: f.rel, buf: Buffer.from(f.content) })),
    { rel: 'README.md', buf: Buffer.from(readme) },
  ]
  console.log(`文件 ${jobs.length} 个，共 ${(total / 1048576).toFixed(2)} MB`)
  if (DRY) {
    jobs.slice(0, 40).forEach(j => console.log(`  ${j.rel} (${j.buf.length})`))
    console.log('  ...')
    return
  }

  const ref = await request('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)
  const headSha = ref.object.sha
  // base_tree 必须是 **tree sha**，不能用 commit sha（传 commit sha 会 404）
  const headCommit = await request('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`)
  const baseTreeSha = headCommit.tree.sha

  // 内容寻址：同一内容在 GitHub 上 blob sha 相同，缓存下来避免重传
  const crypto = await import('node:crypto')
  for (const j of jobs) {
    j.key = j.rel + ':' + crypto.createHash('sha1').update(j.buf).digest('hex')
  }

  let done = 0
  let cursor = 0
  const poolSize = 2 // 并发太高会撞 GitHub 二级限流（create blob 太密）
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++
      const j = jobs[i]
      const cached = blobCache[j.key]
      if (cached) {
        j.sha = cached
      } else {
        const blob = await request('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
          content: j.buf.toString('base64'),
          encoding: 'base64',
        })
        j.sha = blob.sha
        blobCache[j.key] = blob.sha
        await sleep(120) // 轻微节流，避免二级限流
      }
      done++
      if (done % 50 === 0 || done === jobs.length) {
        console.log(`blobs ${done}/${jobs.length}`)
        fs.writeFileSync(CACHE_FILE, JSON.stringify(blobCache))
      }
    }
  }
  await Promise.all(Array.from({ length: poolSize }, worker))
  fs.writeFileSync(CACHE_FILE, JSON.stringify(blobCache))

  const bad = jobs.filter(j => !j.sha || !/^[0-9a-f]{40}$/.test(j.sha))
  if (bad.length) throw new Error('无效 blob sha: ' + bad.slice(0, 5).map(j => j.rel + '=' + j.sha).join(', '))
  const tree = jobs.map(j => ({ path: j.rel, mode: '100644', type: 'blob', sha: j.sha }))

  // create-tree 一次塞 ~870 个条目会让 GitHub 超时（422 "input too large"）。
  // 分批增量：每批把上一批返回的 tree sha 当 base_tree，最后一批的 sha 就是完整树。
  let currentTreeSha = baseTreeSha
  const BATCH = 80
  for (let off = 0; off < tree.length; off += BATCH) {
    const chunk = tree.slice(off, off + BATCH)
    const r = await request('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
      base_tree: currentTreeSha,
      tree: chunk,
    })
    currentTreeSha = r.sha
    console.log(`tree ${Math.min(off + BATCH, tree.length)}/${tree.length}`)
    await sleep(150)
  }

  const commit = await request('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: '上传潮汐音乐安卓版源码（v1.9.32，含应用内更新）',
    tree: currentTreeSha,
    parents: [headSha],
  })
  await request('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha })
  console.log('提交完成', commit.sha)
  console.log(`https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`)
  console.log(`https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`)
}

main().catch(e => { console.error('FAIL', e.message); process.exitCode = 1 })
