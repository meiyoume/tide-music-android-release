/**
 * `npm i` 之后自动跑一遍 node_modules 补丁。
 *
 * 目前只有一个：`patch-trackplayer-audiosession.mjs`（把播放器的 audio session id 暴露出来，
 * 「音效」功能依赖它）。补丁在 node_modules 里，**重装依赖就会丢**，所以挂在 postinstall 上。
 *
 * 这里**故意不把失败透出去**（一律 exit 0）：补丁打不上只影响「音效」一个功能，
 * 不该让 `npm i` 整个失败、连编译都做不了。但会把话说清楚，别让它静默变哑巴。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'patch-trackplayer-audiosession.mjs')

const r = spawnSync(process.execPath, [script], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('\n' + '='.repeat(60))
  console.error('[警告] 音效补丁没打上（退出码 ' + r.status + '）。')
  console.error('       这个包构建出来**不会带「音效」功能**（均衡器/低音增强/环绕声）。')
  console.error('       排查后手动补：node tools/patch-trackplayer-audiosession.mjs')
  console.error('='.repeat(60) + '\n')
}
