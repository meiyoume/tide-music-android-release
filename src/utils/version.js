import { downloadFile, stopDownload, temporaryDirectoryPath } from '@/utils/fs'
import { installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import { NativeModules } from 'react-native'

/**
 * 应用内更新：从**本移植版自己的** GitHub Release 取版本与 APK。
 *
 * 上游原来拿 `package.json` 的 author/name 去对 `lyswhut/lx-music-mobile`，
 * 版本号永远落后、下载到的还是原版洛雪的 APK —— 这就是移植早期关掉启动检查的原因。
 * 2026-11-18 起改成自己的仓库，检查、下载、安装这条链就都说得通了：
 *
 *   GET  /repos/{owner}/{repo}/releases          最新版 + 历史更新说明
 *   GET  assets[].browser_download_url           手机版 / 平板版各自的 arm64 APK
 *        ↓ downloadFile() 落到缓存目录
 *        ↓ installApk()  → FileProvider + 系统安装器（manifest 已声明 REQUEST_INSTALL_PACKAGES）
 *
 * 资产命名约定（发布时按这个传）：
 *   TideMusic-v<version>-arm64.apk        手机版
 *   TideMusic-Pad-v<version>-arm64.apk    平板版
 * 挑选时不看版本号，只看有没有 `Pad`：这台设备装的是哪个 flavor 由 applicationId 决定。
 */
const REPO_OWNER = 'meiyoume'
const REPO_NAME = 'tide-music-android-release'
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`

const stripV = version => String(version ?? '').trim().replace(/^v/i, '')

/** 平板 flavor 的 applicationId 以 `.tablet` 结尾（见 android/app/build.gradle） */
const isTabletForm = () => String(NativeModules?.UtilsModule?.appId ?? '').endsWith('.tablet')

/** 最近一次拉到的 release 列表，下载时直接复用，免得再打一次 API */
let releaseCache = null

const fetchReleases = async() => {
  const res = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TideMusic-Android',
    },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const list = await res.json()
  if (!Array.isArray(list) || !list.length) throw new Error('empty release list')
  return list.filter(release => release && !release.draft && !release.prerelease)
}

export const getVersionInfo = async() => {
  const list = await fetchReleases()
  releaseCache = list
  const latest = list[0]
  return {
    version: stripV(latest.tag_name),
    desc: String(latest.body ?? ''),
    /* 更新弹窗里的「历史版本」列表：取最近的几版 */
    history: list.slice(1, 9).map(release => ({
      version: stripV(release.tag_name),
      desc: String(release.body ?? ''),
    })),
  }
}

let downloadJobId = null
const noop = () => {}
let apkSavePath

export const downloadNewVersion = async(version, onDownload = noop) => {
  const target = stripV(version)
  let list = releaseCache
  if (!list) {
    list = await fetchReleases()
    releaseCache = list
  }
  const release = list.find(item => stripV(item.tag_name) === target) ?? list[0]
  const wantPad = isTabletForm()
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const asset = assets.find(item => {
    const name = String(item.name ?? '')
    if (!/\.apk$/i.test(name)) return false
    // 平板包名里带 Pad；手机包不能带 Pad
    return wantPad ? /pad/i.test(name) : !/pad/i.test(name)
  })

  const url = asset?.browser_download_url ??
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${target}/` +
    (wantPad ? `TideMusic-Pad-v${target}-arm64.apk` : `TideMusic-v${target}-arm64.apk`)
  const savePath = temporaryDirectoryPath + (wantPad ? '/tide-music-pad.apk' : '/tide-music.apk')

  if (downloadJobId) stopDownload(downloadJobId)

  const { jobId, promise } = downloadFile(url, savePath, {
    progressInterval: 500,
    connectionTimeout: 20000,
    readTimeout: 30000,
    begin({ contentLength }) {
      onDownload(contentLength, 0)
    },
    progress({ contentLength, bytesWritten }) {
      onDownload(contentLength, bytesWritten)
    },
  })
  downloadJobId = jobId
  return promise.then(() => {
    apkSavePath = savePath
    return updateApp()
  })
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
