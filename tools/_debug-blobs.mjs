import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const ROOT = path.resolve(import.meta.dirname, '..')
const T = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const H = { Authorization: 'Bearer ' + T, Accept: 'application/vnd.github+json', 'User-Agent': 'x' }
const api = 'https://api.github.com/repos/meiyoume/tide-music-android-release'
const cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '.upload-source-cache.json'), 'utf8'))
const entries = Object.entries(cache).filter(([, sha]) => /^[0-9a-f]{40}$/.test(sha))
console.log('cached shas', entries.length)
let i = 0, bad = []
async function worker() {
  while (i < entries.length) {
    const [key, sha] = entries[i++]
    try {
      const r = await fetch(`${api}/git/blobs/${sha}`, { headers: H })
      if (r.status !== 200) bad.push([key, sha, r.status])
    } catch (e) { bad.push([key, sha, 'ERR ' + e.message]) }
  }
}
await Promise.all(Array.from({ length: 12 }, worker))
console.log('missing total', bad.length)
bad.slice(0, 30).forEach(x => console.log('MISSING', x[2], x[0], x[1]))
