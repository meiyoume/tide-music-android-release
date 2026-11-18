/**
 * 内置音源（首次启动自动装好）
 *
 * 需求是「找几个能用的音源写进去，打包成 app 直接装手机上用」——
 * 所以这里在**首次启动**时把内置脚本写进「音源管理」，用户装完就能直接用，
 * 不用自己去网上找脚本、手动导入。
 *
 * ## 内置了哪几个、为什么是这几个
 *
 * 2026-10-07 把本机能找到的 **47 个音源脚本全部串行实测了一遍**（每个脚本真发网络请求，
 * 走「拿真实歌曲 id → 调脚本要播放地址 → 真去 GET 那个地址确认拿到音频字节」的完整链路），
 * 29 个（按名字去重后）里只有 5 个值得内置，见 `tools/builtin-sources.manifest.json`。
 *
 * 实测方法上有两个**很容易得出错误结论**的坑，记在这里：
 *
 * 1. **脚本收到的 musicInfo 是「旧格式」**：应用会先过 `utils/index.ts` 的 `toOldMusicInfo()`，
 *    字段是 `songmid / hash / strMediaMid / songId / copyrightId`，**不是** `meta.songId`。
 *    不按旧格式造夹具的话，脚本拿到一堆 undefined，测出来全是失败 —— 与真机行为不符。
 * 2. **「能拿到音频字节」不等于「拿到了对的那首歌」**：好几个源（含之前内置的 Huibq）
 *    在解析失败时会**返回一段固定的占位音频**，HTTP 206 + audio/mpeg，看起来完全正常。
 *    识别办法：把歌曲 id 换成假值再调一次，**地址没变**就是占位音频。
 *    所以内置列表里**没有 Huibq**（它 kg/tx/mg 三个平台都返回占位音频）。
 *    另外还要看体积：320k 的 4 分半的歌应该是 10MB 上下，
 *    实测里几个源给 tx 返回 0.9MB（约 24 秒的试听片段）→ 也不收。
 *
 * ## 怎么换 / 怎么加
 *
 * 把脚本放到 `tools/builtin-sources-src/`，在 `tools/builtin-sources.manifest.json` 里加一条，
 * 跑 `node tools/gen-builtin-sources.mjs` 生成 `builtinSources/scripts/*.ts`，
 * 再在下面 `BUILTIN` 里加一行 import。**脚本必须是洛雪音源格式**（文件开头是一段
 * 含 `@name` / `@version` 的块注释，`parseMeta()` 靠它取名字）。
 * 也可以在 App 里「设置 - 音源管理」手动导入覆盖。
 */
import hywBeta from './scripts/hyw_beta'
import xinghai from './scripts/xinghai'
import lxynx from './scripts/lxynx'
import helloworld from './scripts/helloworld'
import yuxi from './scripts/yuxi'
import { getData, saveData, saveDataMultiple } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { bootLog } from '@/utils/bootLog'

/**
 * 内置音源清单。
 *
 * `prefer` 的那个是「没有选中任何音源时自动选上的」—— 选它是因为**五个平台全覆盖**，
 * 且 tx 走 QQ 官方 CDN、拿到的是完整曲目（其他几个源要么 tx 直接失败，
 * 要么给的是 24 秒试听片段）。
 */
const BUILTIN: Array<{ key: string, script: string, prefer?: boolean }> = [
  { key: 'hyw_beta', script: hywBeta, prefer: true },
  { key: 'xinghai', script: xinghai },
  { key: 'lxynx', script: lxynx },
  { key: 'helloworld', script: helloworld },
  { key: 'yuxi', script: yuxi },
]

const userApiPrefix = storageDataPrefix.userApi
/** 记录已装过哪些内置音源，避免每次启动重复安装 / 覆盖用户的改动 */
const INSTALLED_KEY = `${userApiPrefix}__builtin_installed`
/** 记录「上次是我们自动选中的哪个源」，用来区分「用户自己选的」与「我们替他选的」 */
const AUTO_SELECTED_KEY = `${userApiPrefix}__builtin_auto_selected`

interface ScriptMeta {
  name?: string
  description?: string
  version?: string
  author?: string
  homepage?: string
}

/** 从脚本头部的块注释解析元信息（与 addUserApi 同一套规则） */
const parseMeta = (script: string): ScriptMeta => {
  const block = /^\/\*[\S|\s]+?\*\//.exec(script)
  if (!block) return {}
  const meta: ScriptMeta = {}
  for (const line of block[0].split('\n')) {
    const m = /^\s*\*\s*@(\w+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const [, key, value] = m
    if (key === 'name') meta.name = value
    else if (key === 'description') meta.description = value
    else if (key === 'version') meta.version = value
    else if (key === 'author') meta.author = value
    else if (key === 'homepage') meta.homepage = value
  }
  return meta
}

export interface BuiltinInstallResult {
  /** 建议默认选中的内置源 id（清单里 prefer 那个的真实 id） */
  preferredId: string | null
  /**
   * 需要写进 `common.apiSource` 的 id；不需要改动时为 null。
   * 调用方拿到非 null 就 `setApiSource()`。
   */
  selectedId: string | null
  /** 这次新装了哪些（只用于日志） */
  installedNames: string[]
}

/**
 * 首次启动时把内置音源装进去，并决定「该选中哪个」。
 *
 * 幂等：装过就跳过（用户删了某个内置音源也不会被强行装回来 —— 那是用户的选择）。
 *
 * 为什么需要「决定选中哪个」：洛雪 1.9.1 的官方音源列表（`api-source-info`）是**空数组**，
 * 而 `common.apiSource` 默认是空字符串 —— 于是「装好了音源」与「正在用这个音源」
 * 是两件事：不自动选中，用户点歌只会得到 `Api is not found`（实测确认过）。
 *
 * 选择规则（三条，按顺序）：
 *   1. 当前没选任何源 → 选 prefer 那个；
 *   2. 当前选的是**我们上次自动选的**那个 → 换成 prefer 那个
 *      （这样升级后把用户从旧的/较差的默认源上带到新的默认源）；
 *   3. 其他情况**不动** —— 用户自己挑的源不该被改掉。
 *
 * 第 2 条为什么要看「上次自动选中的是谁」而不是「是不是内置源」：
 * 用户完全可能在设置里特意选了内置源 B 而不是 A，按「是不是内置源」判断的话
 * 每次启动都会把他改回 A。记录「上次自动选中的 id」之后，只要用户自己动过，
 * 这个记录就对不上了，规则 3 生效，之后不再干预。
 */
export default async(): Promise<BuiltinInstallResult> => {
  const result: BuiltinInstallResult = { preferredId: null, selectedId: null, installedNames: [] }
  try {
    const installed = (await getData<string[]>(INSTALLED_KEY)) ?? []
    const list = (await getData<LX.UserApi.UserApiInfo[]>(userApiPrefix)) ?? []
    const writes: Array<[string, unknown]> = []
    const nowInstalled = [...installed]

    for (const item of BUILTIN) {
      const meta = parseMeta(item.script)
      // 已经存在同名音源就直接认它（用户可能自己导入过同一份，或上次启动装过）
      const existed = meta.name ? list.find(api => api.name === meta.name) : undefined
      if (existed) {
        if (item.prefer) result.preferredId = existed.id
        if (!installed.includes(item.key)) nowInstalled.push(item.key)
        continue
      }
      // 用户删过这个内置音源：尊重用户选择，不再装回来
      if (installed.includes(item.key)) continue

      const apiInfo: LX.UserApi.UserApiInfo = {
        id: `user_api_builtin_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: meta.name ?? '内置音源',
        description: meta.description ?? '',
        version: meta.version ?? '1.0.0',
        author: meta.author ?? '',
        homepage: meta.homepage ?? '',
        allowShowUpdateAlert: false,
      }
      list.push(apiInfo)
      writes.push([`${userApiPrefix}${apiInfo.id}`, item.script])
      nowInstalled.push(item.key)
      result.installedNames.push(apiInfo.name)
      if (item.prefer) result.preferredId = apiInfo.id
      bootLog(`Builtin source installed: ${apiInfo.name}`)
    }

    // ---- 决定要不要（重新）选中 ----
    const setting = (await getData<Partial<LX.AppSetting>>(storageDataPrefix.setting)) ?? {}
    const current = String(setting['common.apiSource'] ?? '')
    const lastAuto = await getData<string>(AUTO_SELECTED_KEY)
    const builtinIds = list.filter(api => BUILTIN.some(b => parseMeta(b.script).name === api.name)).map(api => api.id)

    if (result.preferredId) {
      // 规则 2 里「上次自动选中的」缺失时（老版本没记过这个键），
      // 用「当前选的是不是内置源」兜底判断一次 —— 老版本的默认源正是内置源。
      const isAutoSelected = current === ''
        ? true
        : (lastAuto != null ? current === lastAuto : builtinIds.includes(current))
      if (isAutoSelected && current !== result.preferredId) result.selectedId = result.preferredId
    }

    // 只有真的动过才写回，避免每次启动都写存储
    if (writes.length || nowInstalled.length !== installed.length) {
      writes.push([userApiPrefix, list])
      writes.push([INSTALLED_KEY, nowInstalled])
      await saveDataMultiple(writes)
    }
    if (result.selectedId) await saveData(AUTO_SELECTED_KEY, result.selectedId)
  } catch (err) {
    // 装内置音源失败不该拦住启动
    bootLog(`Builtin source install failed: ${(err as Error).message}`)
  }
  return result
}
