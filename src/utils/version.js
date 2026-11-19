import { downloadFile, stopDownload, temporaryDirectoryPath, hash, stat, unlink } from '@/utils/fs'
import { installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import { Linking, NativeModules } from 'react-native'

/**
 * 应用内更新：一切由**可配置的 manifest** 驱动（2026-11-18，照搬新闻配音重构那套）。
 *
 *   manifest = version.json，放在本仓库 main 根目录：
 *     { version, notes, history:[{version,notes}],
 *       apk: { phone:{url,mirrors,sha256,size}, tablet:{...} } }
 *
 *   App 里只写死 manifest 的地址（走 ghproxy 多镜像），**下载地址全在 manifest 里**。
 *   好处：以后换任何下载源（国内 CDN 也好、换仓库也好）只改 version.json，
 *   不用重新打包发版 —— 老用户照样能更新到新地址。
 *
 *   manifest 地址多镜像：ghproxy.net → gh-proxy.com → raw 直连（国内 raw 常被墙）。
 *   APK 下载地址也多镜像：按 manifest 的 url → mirrors 逐个试，
 *   每个都校验 size + sha256（防半包、防镜像篡改），全失败才报错。
 *
 *   manifest 拉不到时回退到 GitHub Releases API（老链路），保证不会因为
 *   version.json 一时抽风就完全检查不了更新。
 *
 * 上游原来拿 package.json 的 author/name 去对 `lyswhut/lx-music-mobile`，
 * 版本号永远落后、下载到的还是原版洛雪 APK —— 这是移植早期关掉启动检查的原因。
 * 现在指向自己的仓库，这条链才成立。
 */
const REPO_OWNER = 'meiyoume'
const REPO_NAME = 'tide-music-android-release'
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`
/** 更新弹窗「手动下载」打开的页 */
export const RELEASE_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`

const RAW_MANIFEST = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/version.json`
/** manifest 本身的多镜像（照搬新闻重构：国内 raw 直连不稳，先走 ghproxy） */
const MANIFEST_URLS = [
  'https://ghproxy.net/' + RAW_MANIFEST,
  'https://gh-proxy.com/' + RAW_MANIFEST,
  RAW_MANIFEST,
]

const stripV = version => String(version ?? '').trim().replace(/^v/i, '')
/** 平板 flavor 的 applicationId 以 `.tablet` 结尾（见 android/app/build.gradle） */
const isTabletForm = () => String(NativeModules?.UtilsModule?.appId ?? '').endsWith('.tablet')

let manifestCache = null
let manifestCacheAt = 0
const MANIFEST_TTL = 10 * 60 * 1000
let releaseCache = null

const fetchJson = async(url, timeout = 15000) => {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TideMusic-Android' },
    // RN 的 fetch 没有 AbortSignal.timeout 的稳定支持，靠原生层超时即可
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const fetchManifest = async() => {
  if (manifestCache && Date.now() - manifestCacheAt < MANIFEST_TTL) return manifestCache
  let lastErr = null
  // 破 CDN 缓存：raw / ghproxy 会按路径缓存 version.json，不改 URL 的话
  // 「换源只改 json」发上去后老用户可能几小时都拿不到新内容（真实踩过）。
  // 拼一个每次不同的查询参数，强制回源。
  const bust = 't=' + Date.now()
  for (const base of MANIFEST_URLS) {
    const url = base + (base.includes('?') ? '&' : '?') + bust
    try {
      const data = await fetchJson(url)
      if (!data || typeof data !== 'object' || !data.version) throw new Error('manifest 格式不对')
      manifestCache = data
      manifestCacheAt = Date.now()
      return data
    } catch (err) {
      lastErr = err
      console.log('[update] manifest 源失败：', url, err?.message ?? err)
    }
  }
  throw lastErr ?? new Error('manifest 全部源失败')
}

const fetchReleases = async() => {
  const list = await fetchJson(RELEASES_API)
  if (!Array.isArray(list) || !list.length) throw new Error('empty release list')
  return list.filter(release => release && !release.draft && !release.prerelease)
}

export const getVersionInfo = async() => {
  // 首选 manifest
  try {
    const m = await fetchManifest()
    releaseCache = null
    return {
      version: stripV(m.version),
      desc: String(m.notes ?? ''),
      history: (Array.isArray(m.history) ? m.history : []).map(h => ({
        version: stripV(h.version),
        desc: String(h.notes ?? h.desc ?? ''),
      })),
    }
  } catch (manifestErr) {
    console.log('[update] manifest 不可用，回退 Releases API：', manifestErr?.message ?? manifestErr)
  }
  // 回退：GitHub Releases API
  const list = await fetchReleases()
  releaseCache = list
  const latest = list[0]
  return {
    version: stripV(latest.tag_name),
    desc: String(latest.body ?? ''),
    history: list.slice(1, 9).map(release => ({
      version: stripV(release.tag_name),
      desc: String(release.body ?? ''),
    })),
  }
}

/** 候选下载地址：manifest 的 url → mirrors（去重）；manifest 不可用时回退 GitHub 规则 */
const buildCandidateUrls = (apkConfig, version, wantPad) => {
  const fileName = wantPad
    ? `TideMusic-Pad-v${version}-arm64.apk`
    : `TideMusic-v${version}-arm64.apk`
  const official = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/${fileName}`
  let urls = []
  if (apkConfig && typeof apkConfig === 'object') {
    urls = [apkConfig.url, ...(Array.isArray(apkConfig.mirrors) ? apkConfig.mirrors : [])]
      .filter(u => typeof u === 'string' && /^https?:\/\//i.test(u))
  }
  if (!urls.length) {
    // 回退：从缓存的 release 里找官方 asset，再挂公共镜像
    const list = releaseCache ?? []
    const release = list.find(item => stripV(item.tag_name) === version) ?? list[0]
    const asset = (Array.isArray(release?.assets) ? release.assets : []).find(item => {
      const name = String(item.name ?? '')
      return /\.apk$/i.test(name) && (wantPad ? /pad/i.test(name) : !/pad/i.test(name))
    })
    urls = [asset?.browser_download_url ?? official,
      'https://ghproxy.net/' + official,
      'https://gh-proxy.com/' + official]
  }
  return urls.filter((u, i, arr) => arr.indexOf(u) === i)
}

/**
 * 测速：对一个源下一个小 Range 段（最多 probeBytes），量出字节/秒。
 * 目的不是下完，而是**在真正下载前把最快的源排到前面** ——
 * 国内到 GitHub 官方可能只有 100KB/s，而某个 ghproxy 反而有 1MB/s，
 * 顺序试的话用户就卡在第一个慢源上（真机实测过 158KB/s 下 14MB 要多分钟）。
 * 测够 probeBytes 或到 probeMs 就停，取 bytes/elapsed 当速度。
 */
const probeSpeed = (url, probeBytes = 300 * 1024, probeMs = 5000, index = 0) => new Promise((resolve) => {
  // 每个源独立文件：并发写同一个路径会互相覆盖，测速就不准了
  const probePath = temporaryDirectoryPath + '/tide-probe-' + index + '.tmp'
  let jobId = null
  let startedAt = 0
  let bytes = 0
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try { if (jobId != null) stopDownload(jobId) } catch { /* ignore */ }
    const elapsed = Date.now() - startedAt
    resolve(startedAt && elapsed > 0 ? bytes / elapsed * 1000 : 0)
  }
  const timer = setTimeout(finish, probeMs)
  let dl
  try {
    dl = downloadFile(url, probePath, {
      headers: { Range: 'bytes=0-' + (probeBytes - 1) },
      progressInterval: 200,
      connectionTimeout: 8000,
      readTimeout: 10000,
      begin() { startedAt = Date.now() },
      progress({ bytesWritten }) {
        bytes = bytesWritten
        if (bytes >= probeBytes) finish()
      },
    })
  } catch {
    finish()
    return
  }
  jobId = dl.jobId
  dl.promise.catch(() => {}).then(finish)
})

/** 下载单个源，落盘后校验 size + sha256 */
const downloadOne = (url, savePath, expected, onDownload) => new Promise((resolve, reject) => {
  const { jobId, promise } = downloadFile(url, savePath, {
    progressInterval: 500,
    connectionTimeout: 10000,
    readTimeout: 20000,
    begin({ contentLength }) { onDownload(contentLength, 0) },
    progress({ contentLength, bytesWritten }) { onDownload(contentLength, bytesWritten) },
  })
  downloadJobId = jobId
  promise.then(async() => {
    const st = await stat(savePath)
    if (!st?.isFile || !st.size) throw new Error('下载文件为空')
    if (expected.size && st.size !== expected.size) {
      throw new Error(`文件大小不符：${st.size} ≠ ${expected.size}`)
    }
    if (expected.sha256) {
      const actual = String(await hash(savePath, 'sha256') ?? '').toLowerCase()
      if (actual !== expected.sha256.toLowerCase()) {
        throw new Error('校验失败：内容与官方发布不一致，已丢弃')
      }
    }
    resolve()
  }).catch(reject)
})

let downloadJobId = null
const noop = () => {}
let apkSavePath

export const downloadNewVersion = async(version, onDownload = noop) => {
  const target = stripV(version)
  const wantPad = isTabletForm()

  // 下载地址优先从 manifest 取；manifest 不可用就回退 GitHub API
  let apkConfig = null
  try {
    const m = await fetchManifest()
    apkConfig = m?.apk?.[wantPad ? 'tablet' : 'phone'] ?? null
  } catch { /* 回退到 buildCandidateUrls 里的 GitHub 规则 */ }

  const expected = {
    size: Number(apkConfig?.size ?? 0) || null,
    sha256: String(apkConfig?.sha256 ?? '').replace(/^sha256:/i, '').trim().toLowerCase() || null,
  }
  const urls = buildCandidateUrls(apkConfig, target, wantPad)
  const savePath = temporaryDirectoryPath + (wantPad ? '/tide-music-pad.apk' : '/tide-music.apk')

  // 测速择优：并发给每个源下一个 300KB 探针，按速度从快到慢排。
  // 只有一个源就别浪费时间探；某个源探测返回 0 速度（不可达）会排到最后。
  let ordered = urls
  if (urls.length > 1) {
    const scored = await Promise.all(urls.map(async(url, index) => ({ url, speed: await probeSpeed(url, 300 * 1024, 5000, index) })))
    ordered = scored.sort((a, b) => b.speed - a.speed).map(x => x.url)
    console.log('[update] 源测速：', scored.map(x => `${x.speed ? Math.round(x.speed / 1024) + 'KB/s' : '不可达'} ${x.url.slice(0, 60)}`).join(' | '))
  }

  let lastErr = null
  for (const url of ordered) {
    try {
      try { await unlink(savePath) } catch { /* 残文件，忽略 */ }
      await downloadOne(url, savePath, expected, onDownload)
      apkSavePath = savePath
      return updateApp()
    } catch (err) {
      lastErr = err
      console.log('[update] 下载失败，换下一个源：', url, err?.message ?? err)
      try { stopDownload(downloadJobId) } catch { /* ignore */ }
      try { await unlink(savePath) } catch { /* ignore */ }
    }
  }
  throw lastErr ?? new Error('所有下载源均失败')
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}

/** 更新弹窗的「手动下载」兜底：系统浏览器打开 Release 页 */
export const openReleasePage = () => Linking.openURL(RELEASE_PAGE)
