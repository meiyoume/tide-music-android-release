/**
 * 潮汐界面 ↔ 洛雪内核 的桥
 *
 * 界面跑在 WebView 里（`assets/tide/`），播放/音源/榜单/歌单全部走内核现成的接口。
 * 这里只做三件事：
 *   1. 把界面发来的命令翻译成内核调用
 *   2. 把内核对象压成界面认的纯 JSON（歌、歌单、歌词）
 *   3. 订阅内核事件，推给界面
 *
 * 为什么不把界面改写成 RN 组件：界面工程是纯 HTML/CSS/JS、能独立预览，
 * 重写成 RN 等于把六套皮肤、全部动效再做一遍，且以后两边会各自漂移。
 */
import { NativeModules } from 'react-native'
import { LIST_IDS, MUSIC_TOGGLE_MODE, USER_API_SOURCE_FILE_EXT_RXP } from '@/config/constant'
import { setTempList, getListMusics, getUserLists, createUserList } from '@/core/list'
import { importUserApi, removeUserApi } from '@/core/userApi'
import {
  selectFile, readFile, unlink, downloadFile, mkdir, existsFile, readDir, stat,
  externalStorageDirectoryPath,
} from '@/utils/fs'
import { httpFetch } from '@/utils/request'
import {
  playList, togglePlay, playNext, playPrev, collectMusic, uncollectMusic,
} from '@/core/player/player'
import { setCurrentTime } from '@/plugins/player'
import { updateSetting } from '@/core/common'
import { setTheme } from '@/core/theme'
import { setTidePalette } from '@/harmony/tokens'
import {
  checkDesktopLyricOverlayPermission,
  hideDesktopLyric,
  openDesktopLyricOverlayPermissionActivity,
  showDesktopLyric,
} from '@/core/desktopLyric'
import { search as searchMusic } from '@/core/search/music'
import { search as searchSonglist } from '@/core/search/songlist'
import { getMusicUrl as getOnlineMusicUrl } from '@/core/music/online'
import { setApiSource as setApiSourceCore } from '@/core/apiSource'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { state as userApiState } from '@/store/userApi/state'
import { getSearchHistory, addHistoryWord, clearHistoryList } from '@/core/search/search'
import { getList as getHotSearch } from '@/core/hotSearch'
import { getBoardsList, getListDetail as getBoardDetail } from '@/core/leaderboard'
import { getList as getSonglists, getSortList, getListDetail as getSonglistDetail } from '@/core/songlist'
import {
  handlePlay as playBoard,
  handleCollect as collectBoard,
} from '@/screens/Home/Views/Leaderboard/listAction'
import {
  handlePlay as playPlaylist,
  handleCollect as collectSonglist,
} from '@/screens/SonglistDetail/listAction'
import { type Source as SonglistSource } from '@/store/songlist/state'
import { getListMusicSync } from '@/utils/listManage'
import { getLeaderboardSetting, getSongListSetting, getSearchSetting, saveLeaderboardSetting, saveSongListSetting, saveSearchSetting } from '@/utils/data'
import musicSdk from '@/utils/musicSdk'
import searchMusicState from '@/store/search/music/state'
import searchSonglistState from '@/store/search/songlist/state'
import { shareText } from '@/utils/nativeModules/utils'
import { shareMusic, toast as nativeToast, TEMP_FILE_PATH, formatMusicName, requestStoragePermission } from '@/utils/tools'
import playerState from '@/store/player/state'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'
import soundEffectState from '@/store/soundEffect/state'
import { applySoundEffect, refreshSoundEffectStatus } from '@/core/soundEffect'
import { devicePresetName, presetGroupsWithIndex } from '@/utils/soundEffectPresets'
import { kernelReady } from './ready'
import { runBackgroundInit } from './background'
import { version as appVersion } from '../../package.json'

/* ───────────────────── 界面侧要的形状 ───────────────────── */

interface TideSong {
  key: string
  name: string
  singer: string
  album: string
  interval: string
  source: string
  pic: string
}

interface TokenEntry {
  kind: 'board' | 'songlist' | 'songs'
  id?: string
  source?: LX.OnlineSource
  songs: TideSong[]
  /** 播放时回传给内核的原始对象（界面不需要，但 setTempList 需要） */
  raw: LX.Music.MusicInfo[]
}

/* 界面上没有封面图时用它算渐变底色，与界面的 coverKeyOf 同一套算法 */
const coverKeyOf = (str: string) => {
  let h = 0
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return 'abcdefgh'[Math.abs(h) % 8]
}
export const tideCoverKey = coverKeyOf

/** 内核的歌曲对象 → 界面认的扁平结构 */
function toSong(m: any): TideSong {
  if (!m) {
    return { key: '', name: '', singer: '', album: '', interval: '', source: '', pic: '' }
  }
  const meta = m.meta ?? {}
  return {
    key: String(m.id ?? ''),
    name: m.name ?? '',
    singer: m.singer ?? '',
    // 在线歌在 meta.albumName，播放态的 musicInfo 直接用 album
    album: m.album ?? meta.albumName ?? '',
    interval: m.interval ?? '',
    source: m.source ?? '',
    // 在线歌封面在 meta.picUrl；播放态是 pic
    pic: m.pic ?? meta.picUrl ?? '',
  }
}

/** 在线歌单条目 → 界面的卡片 */
function toPlaylistCard(it: any, source: LX.OnlineSource) {
  return {
    id: `sl:${source}:${it.id}`,
    name: it.name ?? '未命名歌单',
    cover: coverKeyOf(it.id ?? it.name ?? ''),
    /** 真实封面图；取不到时界面会退回渐变 */
    img: it.img ?? '',
    meta: it.play_count ? `${it.play_count} 次播放` : (it.author ?? ''),
  }
}

/**
 * 音源列表（「我的 · 音源」那一行用）。
 *
 * 洛雪 1.9.1 的官方音源清单（`api-source-info`）是**空数组**，
 * 真正能用的是「内置音源」（见 `src/harmony/builtinSources`）与用户自己导入的脚本 ——
 * 两者都躺在 `userApi` 的 list 里。所以正常情况下 `builtin` 是空的，
 * 界面把两个数组接起来显示即可。
 */
function apiSourcesPayload() {
  return {
    active: String(settingState.setting['common.apiSource'] ?? ''),
    builtin: (apiSourceInfo ?? []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name ?? a.id),
      disabled: !!a.disabled,
    })),
    user: (userApiState.list ?? []).map((a: any) => ({
      id: String(a.id),
      name: String(a.name ?? '未命名音源'),
      version: String(a.version ?? ''),
      desc: String(a.description ?? ''),
    })),
  }
}

/* ───────────────────── 搜索源 / 榜单平台 / 歌单平台 ───────────────────── */

/** 平台短名，与推荐页、歌单详情页用的是同一套（酷我/酷狗/QQ/网易云/咪咕） */
const SOURCE_LABELS: Record<string, string> = {
  kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易云', mg: '咪咕',
}
const PLATFORM_IDS = musicSdk.sources.map(s => s.id)

/**
 * 平台选项。搜索可以选「全部」，榜单/歌单广场必须落到某一个平台，
 * 所以 includeAll 由调用方决定。
 */
function sourceOptions(active: string, includeAll: boolean) {
  const list = musicSdk.sources.map(s => ({ id: s.id, name: SOURCE_LABELS[s.id] ?? s.name }))
  return {
    sources: includeAll ? [{ id: 'all', name: '全部' }, ...list] : list,
    active,
  }
}

/** 把界面传来的 source 收敛到「内核真有的平台」，非法值返回 null 让调用方用默认 */
function normalizeSource(value: unknown, includeAll: boolean): string | null {
  const id = String(value ?? '')
  if (includeAll && id === 'all') return 'all'
  return PLATFORM_IDS.includes(id) ? id : null
}

/* ───────────────────── 榜单封面 ───────────────────── */

/**
 * 各平台的榜单列表接口都只给 id 和名字，**没有封面图** ——
 * 榜单卡片原本因此只能是纯色块，用户看到的「榜单没有封面」就是这个原因。
 *
 * 这里取每个榜第一页的第一首歌的专辑图当榜单封面（各家榜单页也基本是这么展示的），
 * 顺便带上前三首歌名，让精选位那张大卡有内容可显示。
 *
 * 取一次就记住，缓存命中后进榜单页是瞬时的。
 * 走的是各平台内置接口（不是用户自定义音源），每次只开 2 路，不给接口压力。
 */
const boardCoverCache = new Map<string, { img: string, tops: string[] }>()
/** 正在取的榜单：同一张榜被问两次只发一个请求（滚动时重复触发很常见） */
const boardCoverPending = new Map<string, Promise<{ img: string, tops: string[] }>>()

async function fetchBoardCover(boardId: string): Promise<{ img: string, tops: string[] }> {
  const cached = boardCoverCache.get(boardId)
  if (cached) return cached
  const inflight = boardCoverPending.get(boardId)
  if (inflight) return inflight
  const job = (async () => {
    try {
      const r = await getBoardDetail(boardId, 1).catch(() => null)
      const list = ((r as any)?.list ?? []) as any[]
      const first = list[0]
      const value = {
        img: String(first?.meta?.picUrl ?? first?.pic ?? ''),
        tops: list.slice(0, 3).map(m => String(m?.name ?? '')).filter(Boolean),
      }
      boardCoverCache.set(boardId, value)
      return value
    } finally {
      boardCoverPending.delete(boardId)
    }
  })()
  boardCoverPending.set(boardId, job)
  return job
}

/* ───────────────────── 酷我歌单封面 ───────────────────── */

/** 酷我新接口要一个随机 reqId（内核里也是这么生成的） */
function kwReqId() {
  let s = ''
  for (let i = 0; i < 8; i++) s += (65536 * (1 + Math.random()) | 0).toString(16).substring(1)
  return s
}

const kwCoverCache = new Map<string, Map<string, string>>()

/**
 * 酷我歌单里的歌曲，内核映射时写死 `img: null`（`kw/songList.js` 的 filterListDetail），
 * 所以歌单详情每一行都是渐变块 —— 用户报的「图片不显示」有一半是这个。
 *
 * 酷我自己新接口 `bd-api.kuwo.cn/.../musicList` 是带 `albumPic` 的，用 source=4 再问一次，
 * 按歌曲 id 把封面贴回来。实测歌单广场里的歌单都能命中。
 *
 * 失败、超时、结构变了都只是「没有封面」，列表照常显示 —— 封面是锦上添花。
 */
async function fetchKwCovers(pid: string): Promise<Map<string, string> | null> {
  const cached = kwCoverCache.get(pid)
  if (cached) return cached
  try {
    const url = `https://bd-api.kuwo.cn/api/service/playlist/${pid}/musicList?reqId=${kwReqId()}&source=4&pn=1&rn=1000`
    const res = await fetch(url, { headers: { plat: 'h5' } })
    if (!res.ok) return null
    const body: any = await res.json()
    const rows = body?.data?.list
    if (!Array.isArray(rows)) return null
    const map = new Map<string, string>()
    for (const r of rows) {
      if (r?.id != null && r.albumPic) map.set(String(r.id), String(r.albumPic))
    }
    if (!map.size) return null
    kwCoverCache.set(pid, map)
    return map
  } catch (e) {
    return null
  }
}

/** 给封面请求封一个上限：接口慢的时候不能让整个歌单页面等着 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))])
}

/* ───────────────────── 排序 ───────────────────── */

const collator = (() => {
  try {
    return new Intl.Collator('zh-Hans-CN')
  } catch (e) {
    return null
  }
})()

function cmpText(a: string, b: string) {
  if (collator) return collator.compare(a, b)
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 列表排序。
 *
 * **必须在数据侧排，不能只排界面**：界面点歌是把下标交给原生（`play(token, index)`），
 * 原生按下标从自己的数组里取歌 —— 两边顺序不一致就会「点 A 放 B」。
 *
 * 也不原地排：`list` 有可能是内核缓存里的那个数组，改了会串到别的页面。
 */
function sortList<T extends Record<string, any>>(list: T[], sort: string): T[] {
  if (sort !== 'name' && sort !== 'singer') return list
  return list.slice().sort((a, b) => cmpText(String(a?.[sort] ?? ''), String(b?.[sort] ?? '')))
}

const PLAY_MODE_TO_UI: Record<string, number> = {
  [MUSIC_TOGGLE_MODE.list]: 0,
  [MUSIC_TOGGLE_MODE.none]: 0,
  [MUSIC_TOGGLE_MODE.listLoop]: 0,
  [MUSIC_TOGGLE_MODE.random]: 1,
  [MUSIC_TOGGLE_MODE.singleLoop]: 2,
}
const UI_MODE_TO_SETTING = ['list', 'random', 'singleLoop'] as const

/**
 * 从 n 首里按种子均匀取 k 首。
 *
 * 用固定步长跳着取而不是随机洗牌：同一个种子（= 同一天）结果完全一样，
 * 换种子就是「换一批」，不用把选好的结果存下来。
 *
 * ⚠️ **步长必须与 n 互质**（v1.9.19 发现的一个真死循环）：
 * 原来是写死的 `idx = (idx + 7) % n`。7 是质数，所以 n 只要是 7 的倍数
 * （35 / 42 / 49 / 56 / 63 / 70 …），`idx` 就只会在 n/7 个位置上打转 ——
 * `seen` 涨不到 n，`out` 也涨不到 k，`while (out.length < k && seen.size < n)`
 * **永远成立，整个 JS 线程卡死**（表现就是 App 假死、点什么都没反应）。
 * 榜单两页拼出来的池子正好常常是这些数，所以不是理论问题。
 * 现在：步长从 7 往上找一个与 n 互质的；再留一个 `guard` 兜底，
 * 就算以后有人改坏了步长也不会把线程挂住。
 */
function pickSpread<T>(list: T[], k: number, seed: number): T[] {
  const n = list.length
  if (n <= k) return list.slice()
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  let step = 7
  while (gcd(step, n) !== 1) step++
  const out: T[] = []
  const seen = new Set<number>()
  let idx = ((seed % n) + n) % n
  let guard = 0
  while (out.length < k && seen.size < n && guard++ < n * 2) {
    if (!seen.has(idx)) {
      seen.add(idx)
      out.push(list[idx])
    }
    idx = (idx + step) % n
  }
  return out
}

/* ───────────────────── 播放音效 ───────────────────── */

/**
 * 环境混响给界面选的档位。系统 PresetReverb 一共 7 档，省掉「中厅」那档。
 * 内核设置页有一份一样的（screens/.../SoundEffect.tsx），改这里记得一起改。
 */
const REVERB_OPTIONS = [0, 1, 2, 3, 5, 6]

/**
 * 播放音效的完整状态：设备能力 + 当前设置 + 可选预设（按来源分组）。
 *
 * 设置里存的是一个**下标**，它同时索引设备预设和开源曲线（见 core/soundEffect.ts），
 * 所以这里把两边拼成一个 groups 数组给界面画页签 —— 界面只管点，点到的 index 直接存。
 */
function soundEffectPayload() {
  const s = settingState.setting
  const st = soundEffectState
  return {
    loaded: st.loaded,
    available: st.available,
    reason: st.reason,
    enabled: s['player.soundEffectEnabled'],
    preset: s['player.soundEffectPreset'],
    bassBoost: s['player.soundEffectBassBoost'],
    virtualizer: s['player.soundEffectVirtualizer'],
    loudness: s['player.soundEffectLoudness'],
    reverb: s['player.soundEffectReverb'],
    reverbOptions: REVERB_OPTIONS,
    supports: {
      equalizer: st.devicePresetCount > 0 || st.bandCenters.length > 0,
      bassBoost: st.supportsBassBoost,
      virtualizer: st.supportsVirtualizer,
      loudness: st.supportsLoudness,
      reverb: st.supportsReverb,
    },
    groups: [
      {
        id: 'device',
        name: '设备预设',
        credit: '手机系统自带',
        presets: st.devicePresets.map(p => ({ index: p.index, name: devicePresetName(p.name) })),
      },
      ...presetGroupsWithIndex(st.devicePresetCount),
    ],
  }
}

/* ───────────────────── 桥本体 ───────────────────── */

export interface TideBridge {
  /** 界面发来一条命令，返回要回给界面的数据 */
  handle: (cmd: string, args: any) => Promise<any>
  /** 订阅内核事件；返回值用于解绑 */
  subscribe: (emit: (event: string, payload: any) => void) => () => void
}

export function createTideBridge(): TideBridge {
  /** token → 列表。界面只拿 token 和下标回来，不搬运原始对象 */
  const tokens = new Map<string, TokenEntry>()
  let seq = 0
  /** 界面订阅进来的推送口；后台任务（榜单封面）补齐数据后用它通知界面 */
  let emitRef: ((event: string, payload: any) => void) | null = null

  function mint(entry: TokenEntry): string {
    const tk = 't' + (++seq)
    tokens.set(tk, entry)
    // 界面上限：只留最近 40 个列表，避免长会话里无限增长
    if (tokens.size > 40) {
      const oldest = tokens.keys().next().value
      if (oldest !== undefined) tokens.delete(oldest)
    }
    return tk
  }

  /**
   * 歌曲数组 → 界面要的形状 + 一个 token
   *
   * 列表只映射一次：搜索一页 140 首时，这里原来 `list.map(toSong)` 写了两遍，
   * 白白多造 140 个对象和一份数组（返回的 raw 也没人用）。
   */
  function wrapSongs(raw: any[]): { songs: TideSong[]; token: string } {
    const list = raw ?? []
    const songs = list.map(toSong)
    return { songs, token: mint({ kind: 'songs', songs, raw: list }) }
  }

  /** 榜单/歌单详情：统一成界面要的结构 */
  async function detailOf(kind: 'board' | 'songlist', id: string, source?: LX.OnlineSource, sort = '') {
    let list: any[] = []
    let info: any = null
    let title = ''
    let author = ''
    let desc = ''
    let cover = coverKeyOf(id)
    let boardCover = ''

    if (kind === 'board') {
      const src = id.split('__')[0] as LX.OnlineSource
      const boards = await getBoardsList(src).catch(() => [] as any[])
      const board = (boards as any[]).find(b => b.id === id)
      title = board?.name ?? '在线榜单'
      const r = await getBoardDetail(id, 1)
      list = r.list ?? []
      author = '在线榜单'
      desc = `来源：${src}`
      /* 榜单接口只给 id 和名字，封面得从第一首歌的专辑图上取（见 fetchBoardCover）。
         命中缓存时这一步是瞬时的，取不到就保持渐变封面。 */
      boardCover = (await fetchBoardCover(id).catch(() => null))?.img ?? ''
      if (boardCover) cover = ''
    } else {
      const src = source as LX.OnlineSource
      /* 酷我的歌曲封面要额外问一次新接口，跟详情请求并着发，不叠加等待 */
      const coversP = src === 'kw'
        ? withTimeout(fetchKwCovers(id.replace(/^digest-\d+__/, '')), 2500)
        : Promise.resolve(null)
      const r = await getSonglistDetail(id, src, 1)
      list = r.list ?? []
      info = (r as any).info ?? null
      title = info?.name ?? '歌单'
      author = info?.author ?? ''
      desc = info?.desc ?? ''
      if (info?.img) cover = ''
      const covers = await coversP
      if (covers) {
        for (const m of list) {
          const mid = String(m?.songmid ?? m?.meta?.songId ?? '')
          const pic = covers.get(mid)
          if (!pic) continue
          if (m.meta) m.meta.picUrl = pic
          m.pic = pic
        }
      }
    }

    /* 排序在映射之前做：界面按下标点歌，顺序必须和原生手里的数组一致 */
    const ordered = sortList(list, sort)
    const songs = ordered.map(toSong)
    const token = mint({
      kind,
      id,
      source: kind === 'board' ? (id.split('__')[0] as LX.OnlineSource) : source,
      songs,
      raw: ordered,
    })
    /* 头图没有真图时拿列表第一首的专辑图兜底：比纯渐变像样，
       而且不管哪个源、哪个接口缺图都自动生效。
       注意 toSong 的字段叫 pic（不是 img）—— 这里写成 img 会静默取不到，
       头图就一直是渐变，很难看出来。 */
    const img = info?.img || boardCover || songs.find(s => s.pic)?.pic || ''
    return { title, author, desc, cover, songs, token, img }
  }

  async function library() {
    const [users, love] = await Promise.all([
      getUserLists().catch(() => [] as any[]),
      getListMusics(LIST_IDS.LOVE).catch(() => [] as any[]),
    ])
    /* 自建歌单的歌数不在 UserListInfo 上，得从列表缓存里取 */
    const countOf = (id: string) => (listState.allMusicList.get(id) ?? []).length

    /* 「我创建的歌单」= 用户自己建的。两件东西**不能**放进来：
         · 「我喜欢的音乐」—— 它有自己的「歌曲」页签，混进自建里既重复，
           又让「N 个自建」这个数字比真实的自建数多 1；
         · 收藏来的歌单 —— 它们带 sourceListId，属于下一条，
           不过滤的话同一张歌单会同时出现在两个小节里。 */
    const mine = users.filter(l => !l.sourceListId)
    const collected = users.filter(l => l.sourceListId)

    const my = mine.map(l => ({
      id: `ul:${l.id}`,
      name: l.name ?? '未命名歌单',
      cover: coverKeyOf(l.id ?? ''),
      meta: `${countOf(l.id)} 首 · 自建`,
    }))
    const fav = collected.map(l => ({
      id: `ul:${l.id}`,
      name: l.name ?? '收藏的歌单',
      cover: coverKeyOf(l.id ?? ''),
      meta: `${l.source ?? ''} 收藏 · ${countOf(l.id)} 首`,
    }))
    return {
      my,
      fav,
      stats: {
        love: love.length,
        lists: users.length,
        downloads: countOf(LIST_IDS.DOWNLOAD),
        follows: 0,
      },
    }
  }

  /**
   * 后台补齐榜单封面：全局一个队列、固定 2 路，取一个推一个。
   *
   * 只补界面**看得见**的那几张（界面用 IntersectionObserver 滚到哪问到哪）：
   * 酷我榜单有 43 个，启动时一次性全取会连发 43 个请求，从 +3.5s 一直占到 +7.5s，
   * 和首屏那条数据请求抢带宽 —— 首屏反而更慢，而用户可能根本不进榜单页。
   *
   * 队列放在这一层（而不是每次调用起两个 worker）：界面滚动会分批发好几次请求，
   * 各自起 worker 的话并发数会随滚动累加。这里固定 2 路，重复的 id 直接丢掉。
   *
   * 不让 charts() 直接 await：串起来要好几秒，进榜单页会一直空着。
   * 先返回渐变卡（界面有首字水印占位），封面到了再贴上去，观感上快得多。
   */
  const coverQueue: string[] = []
  let coverWorkers = 0

  function pumpBoardCovers() {
    while (coverWorkers < 2 && coverQueue.length) {
      const id = coverQueue.shift()!
      coverWorkers++
      fetchBoardCover(id)
        .then(v => { emitRef?.('chartCovers', { id: `board:${id}`, img: v.img, tops: v.tops }) })
        .catch(() => { /* 单个榜单取不到就保持渐变封面，不影响其它榜单 */ })
        .finally(() => { coverWorkers--; pumpBoardCovers() })
    }
  }

  function queueBoardCovers(ids: string[]) {
    for (const id of ids) {
      if (boardCoverCache.has(id) || coverQueue.includes(id)) continue
      coverQueue.push(id)
    }
    pumpBoardCovers()
  }

  /* ───────────────────── 首页「为你精选」 ───────────────────── */

  /**
   * 歌单广场第一页（网络）。取到就推 `homePlaylists`，取不到推空数组。
   *
   * 为什么不放在 home 里 await：这条请求在模拟器上实测要 4 秒多，
   * 而 home 的返回是首屏能不能画出来的前提 —— 一起等的话整屏空 4 秒。
   * 「猜你喜欢」是本地库，一条消息就到，先把它画出来。
   *
   * 取到过就不再取（空结果不缓存，下次进首页还能重试）。
   */
  let homePlaylistsCache: any[] | null = null
  let homePlaylistsLoading: Promise<any[]> | null = null

  async function loadHomePlaylists(): Promise<any[]> {
    if (homePlaylistsCache) {
      emitRef?.('homePlaylists', { playlists: homePlaylistsCache })
      return homePlaylistsCache
    }
    if (!homePlaylistsLoading) {
      homePlaylistsLoading = (async () => {
        // 平台取内核里记住的那个（用户在原生界面切过的话），不要硬编码
        const { source } = await getSongListSetting()
        try {
          const sorts = (getSortList(source) ?? []) as Array<{ id: string }>
          const info = await getSonglists(source, '', sorts[0]?.id ?? 'new', 1)
          return (info.list ?? []).map(it => toPlaylistCard(it, source))
        } catch (e) {
          // 歌单广场取不到不算致命：首页还有收藏列表可用
          return []
        }
      })()
    }
    const list = await homePlaylistsLoading
    homePlaylistsLoading = null
    if (list.length) homePlaylistsCache = list
    emitRef?.('homePlaylists', { playlists: list })
    return list
  }

  /* ───────────────────── 首页「猜你喜欢」 ───────────────────── */

  /** 界面上「猜你喜欢」固定显示这么多首 */
  const HOME_LIKES = 30

  /**
   * 「猜你喜欢」的补足池：当前榜单的前两页，去掉用户已经收藏的那些。
   *
   * 为什么要补：这一栏原本直接显示「我喜欢的音乐」，用户只收藏了一首时
   * 整栏就孤零零一行（用户反馈「猜你喜欢里面就一首歌 要三十首才对」）。
   * 现在收藏的歌照旧排在前面，不够 30 首的用榜单补上。
   *
   * 池子只取一次（整场会话复用），所以反复进首页不会反复打网络；
   * 榜单取不到就返回空数组，界面保持「只有收藏那几首」—— 不是错误，只是没补成。
   */
  let likePool: any[] | null = null
  let likePoolLoading: Promise<any[]> | null = null

  async function loadLikePool(): Promise<any[]> {
    if (likePool) return likePool
    if (!likePoolLoading) {
      likePoolLoading = (async () => {
        const { source } = await getLeaderboardSetting()
        const boards = (await getBoardsList(source)) as any[]
        const board = boards[0]
        if (!board) return []
        /* 两页拼起来：榜单接口一页常常就 30 首，只取一页的话
           「收藏 1 首 + 补 29 首」会把整页榜单都塞进来，反而没有挑选余地。
           两路并发，走的是内核内置接口、不是用户音源。 */
        const pages = await Promise.all(
          [1, 2].map(p => getBoardDetail(board.id, p).catch(() => null)),
        )
        const out: any[] = []
        const seen = new Set<string>()
        for (const r of pages) {
          for (const m of (((r as any)?.list ?? []) as any[])) {
            const id = String(m?.id ?? '')
            if (id) {
              if (seen.has(id)) continue
              seen.add(id)
            }
            out.push(m)
          }
        }
        return out
      })().catch(() => [] as any[])
    }
    const pool = await likePoolLoading
    likePoolLoading = null
    if (pool.length) likePool = pool
    return pool
  }

  /**
   * 把「猜你喜欢」补到 30 首：收藏的排在前面，其余从榜单里按种子挑。
   *
   * 种子与「每日推荐」**故意错开**（那边是 `day`，这边是 `day * 31 + 7`）——
   * 两处都从同一张榜里挑，用同一个种子的话会挑出同一批歌，看着像重复功能。
   */
  async function loadHomeLikes(love: any[]): Promise<void> {
    if (love.length >= HOME_LIKES) return
    const pool = await loadLikePool()
    const have = new Set(love.map(m => String(m?.id ?? '')))
    const fresh = pool.filter(m => !have.has(String(m?.id ?? '')))
    const seed = Math.floor(Date.now() / 86400000) * 31 + 7
    const picked = fresh.length ? pickSpread(fresh, HOME_LIKES - love.length, seed) : []
    const w = wrapSongs([...love, ...picked])
    /* 池子空、收藏也空时这里推的是空数组 —— 界面据此显示空态说明，
       而不是一直停在「加载中」的占位上。 */
    emitRef?.('homeLikes', { songs: w.songs, token: w.token })
  }

  /* ───────────── 歌曲下载 ─────────────
   * 音源接口的「取播放地址」与播放共用同一个按 IP 限流的通道，
   * 所以这里也和音源测试一样**绝不并发**：一次一首串行下载，
   * 每首之间再留间隔。下载落盘走公共音乐目录
   * /sdcard/Music/TideMusic/（targetSdk 29 + legacy storage +
   * 运行时申请 WRITE_EXTERNAL_STORAGE，见 utils/tools 的
   * requestStoragePermission），文件管理器和系统音乐播放器都能看到。
   */
  type DlItem = { musicInfo: LX.Music.MusicInfoOnline; single: boolean }
  const dlQueue: DlItem[] = []
  let dlRunning = false

  const dlDir = () => externalStorageDirectoryPath + '/Music/TideMusic'

  const dlSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  /** 扩展名从返回的地址里推；推不出就当 mp3 */
  const extFromUrl = (url: string) => {
    const m = /\.(mp3|flac|m4a|ape|wav|ogg|aac)/i.exec(String(url || '').split('?')[0])
    return (m ? m[1] : 'mp3').toLowerCase()
  }

  /** 文件名里的 Windows/Android 保留字符换空格 */
  const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, ' ').trim() || '未命名'

  async function runDownloadOne(item: DlItem) {
    const { musicInfo } = item
    const name = musicInfo.name || '未命名'
    const singer = musicInfo.singer || ''
    const emit = (status: string, extra?: Record<string, any>) => {
      emitRef?.('download', { status, name, singer, single: item.single, remain: dlQueue.length, ...extra })
    }
    emit('start')

    const granted = await requestStoragePermission()
    if (!granted) {
      const msg = granted === null
        ? '存储权限被设为「不再询问」，去系统设置里手动开启'
        : '没有存储权限，下载没法落盘'
      emit('error', { msg })
      throw new Error(msg)
    }

    /* isRefresh: true 强制取新地址。播放的地址缓存（getStoreMusicUrl）可能早已
       失效 —— 实测拿缓存下载 0.3 秒「完成」、文件 0 字节（响应是个错误页）。 */
    const url = await getOnlineMusicUrl({ musicInfo, isRefresh: true })
    if (!url) throw new Error('取不到播放地址')

    const dir = dlDir()
    try { await mkdir(dir) } catch { /* 已存在时原生会抛，落 stat 校验兜住 */ }

    const base = safeFileName(formatMusicName(settingState.setting['download.fileName'], name, singer))
    const ext = extFromUrl(url)
    let fileName = `${base}.${ext}`
    let path = `${dir}/${fileName}`
    /* 重名自动加 (1)、(2)，不覆盖已经下载好的文件 */
    for (let n = 1; await existsFile(path); n++) {
      fileName = `${base}(${n}).${ext}`
      path = `${dir}/${fileName}`
    }

    /* progressDivider 10 = 每 10% 推一次进度，界面只用它做提示，不刷屏 */
    const job = downloadFile(url, path, {
      progressDivider: 10,
      progress: (res: any) => {
        try {
          emit('progress', { progress: Math.round((res.bytesWritten / (res.contentLength || 1)) * 100) })
        } catch { /* 进度回调失败不影响下载本身 */ }
      },
    })
    const result = await job.promise
    if (result && result.statusCode && (result.statusCode < 200 || result.statusCode >= 300)) {
      throw new Error('下载响应异常 HTTP ' + result.statusCode)
    }

    const info = await stat(path)
    if (!info || !(info.size > 0)) throw new Error('下载的文件是空的')
    emit('done', { path, size: info.size })
  }

  async function pumpDownloads() {
    if (dlRunning) return
    dlRunning = true
    try {
      while (dlQueue.length) {
        const item = dlQueue.shift()!
        try {
          await runDownloadOne(item)
        } catch {
          /* 单首失败继续下一首；原因已经推给界面 */
        }
        /* 换歌间隔：别把音源接口连着打 */
        if (dlQueue.length) await dlSleep(600)
      }
    } finally {
      dlRunning = false
    }
  }

  function enqueueDownloads(list: any[], single: boolean) {
    const items = (list || []).filter(m => m && m.source) as LX.Music.MusicInfoOnline[]
    if (!items.length) return { ok: false, msg: '这里没有可下载的在线歌曲' }
    dlQueue.push(...items.map(m => ({ musicInfo: m, single })))
    void pumpDownloads()
    return { ok: true, count: items.length }
  }

  /* ───────────── 当前播放态快照 ─────────────
   * 内核在 App 启动时就会恢复上次播放的歌（initPlayInfo → playList，
   * 恢复态是暂停的，重启后不会自动出声），但那串事件发生在 **WebView
   * 加载之前** —— 界面一个都收不到，表现就是「关掉再开没有记忆上次播放」。
   * init 命令里带一份快照、订阅时再补推一帧，两处都用它。 */
  function playerSnapshot() {
    const cur: any = playerState.playMusicInfo.musicInfo
    const love = (getListMusicSync(LIST_IDS.LOVE) ?? []) as any[]
    return {
      song: cur ? toSong({ ...cur, source: cur.source ?? '' }) : null,
      isPlay: playerState.isPlay,
      position: playerState.progress.nowPlayTime ?? 0,
      duration: playerState.progress.maxPlayTime ?? 0,
      mode: PLAY_MODE_TO_UI[settingState.setting['player.togglePlayMethod']] ?? 0,
      liked: cur ? love.some(m => m.id === cur.id) : false,
    }
  }

  /* ───────────── 命令表 ───────────── */

  const commands: Record<string, (args: any) => Promise<any>> = {
    async init() {
      /* 界面现在比内核先加载（HomeScreen 提前 setRoot，见 src/app.ts）。
         这里等内核初始化完成再回数据：init 的返回值里带着上次播放的歌与音源，
         早回就是一份空快照，首页会一直空着。等的时候页面的壳层已经画出来了。 */
      await kernelReady
      const appId = String((NativeModules as any)?.UtilsModule?.appId ?? '')
      return {
        ok: true,
        apiSource: settingState.setting['common.apiSource'],
        playMode: PLAY_MODE_TO_UI[settingState.setting['player.togglePlayMethod']] ?? 0,
        /* 界面「关于」页显示真实版本（以前写死 3.2.0，和 APK 的 1.9.x 对不上） */
        version: appVersion,
        form: appId.endsWith('.tablet') ? 'tablet' : 'phone',
        /* 冷启动恢复的那首歌（若内核恢复了上次播放）：界面据此画迷你条 */
        player: playerSnapshot(),
      }
    },

    /**
     * 检查更新（潮汐界面的「关于 → 检查更新」）。
     *
     * 真正的检查/下载/安装都在内核那条链路上：`core/version` 拉 GitHub Release、
     * 弹原生的更新窗口、下载 APK、调系统安装器。这里只把结果压成界面要的形状，
     * 让「关于」页能显示「已是最新 / 新版本 vX」。
     */
    async checkUpdate() {
      const { checkUpdate } = await import('@/core/version')
      const info = await checkUpdate()
      const nv = info?.newVersion?.version ?? ''
      return {
        ok: true,
        version: info?.version ?? appVersion,
        latest: !!info?.isLatest,
        unknown: !!info?.isUnknown,
        newVersion: nv && nv !== '0.0.0' ? nv : '',
      }
    },

    /**
     * 首页：收藏列表（本地库）打底当「猜你喜欢」，歌单广场第一页当「为你精选」。
     *
     * 两条网络请求都不等 —— 歌单广场慢起来要 4 秒多，等它整屏就空着：
     * 「为你精选」由 loadHomePlaylists 取到后推 homePlaylists；
     * 「猜你喜欢」不够 30 首时由 loadHomeLikes 推 homeLikes 补足。
     * 这里只返回本地那部分，首屏立刻就画得出来。
     */
    async home() {
      const love = await getListMusics(LIST_IDS.LOVE).catch(() => [] as any[])
      const w = wrapSongs(love)
      void loadHomePlaylists()
      void loadHomeLikes(love)
      /* 首屏数据已经拿到，界面马上就能画出来 —— 现在才轮到剩下那段内核初始化
         （装内置音源 / 音源沙箱 / 恢复上次播放，实测 ~460ms）。见 src/tide/background.ts */
      setTimeout(runBackgroundInit, 0)
      return { playlists: [], likes: w.songs, token: w.token }
    },

    /** 榜单列表。封面不在这里等，也没缓存的由界面按需来要（见 chartCovers）。 */
    async charts(args) {
      const source = (normalizeSource(args?.source, false) ?? (await getLeaderboardSetting()).source) as LX.OnlineSource
      const boards = (await getBoardsList(source)) as any[]
      const charts = boards.map(b => {
        const c = boardCoverCache.get(b.id)
        return {
          id: `board:${b.id}`,
          name: b.name,
          cover: coverKeyOf(b.id),
          img: c?.img ?? '',
          meta: '在线排行榜',
          tops: c?.tops ?? [],
        }
      })
      return { charts }
    },

    /**
     * 按需补榜单封面。界面把当前看得见的榜单 id 发过来（`board:<bangid>`），
     * 缓存的立刻推回去，没缓存的丢后台取、取好一个推一个。
     */
    async chartCovers(args) {
      const ids = (Array.isArray(args?.ids) ? args.ids : [])
        .map((id: any) => String(id).replace(/^board:/, ''))
        .filter(Boolean)
      const missing: string[] = []
      for (const id of ids) {
        const c = boardCoverCache.get(id)
        if (c) emitRef?.('chartCovers', { id: `board:${id}`, img: c.img, tops: c.tops })
        else if (!missing.includes(id)) missing.push(id)
      }
      if (missing.length) queueBoardCovers(missing)
      return { cached: ids.length - missing.length, queued: missing.length }
    },

    /**
     * 每日推荐：从当前榜单的第一张榜里按日期挑 30 首。
     *
     * 不做「根据你的口味」那种承诺 —— 洛雪没有账号体系，拿不到听歌画像，
     * 所以界面上写的是「今天来自 X 榜」而不是「根据近期口味更新」。
     * 同一天进来是同 30 首（日期当种子），点「换一批」换下一组。
     */
    async daily(args) {
      const shift = Math.max(0, Number(args?.shift ?? 0))
      const { source } = await getLeaderboardSetting()
      const boards = (await getBoardsList(source)) as any[]
      const board = boards[0]
      if (!board) return { sub: '', songs: [], token: '', canShuffle: false }
      const sub = `今天来自「${board.name}」`
      /* 取两页拼起来：榜单接口一页常常就 30 首，只取一页的话
         「可选池」等于「输出」，换一批会换不动（实测就是这样）。
         两路并发，走的是内置接口、不是用户音源。 */
      const pages = await Promise.all(
        [1, 2].map(p => getBoardDetail(board.id, p).catch(() => null)),
      )
      const seen = new Set<string>()
      const all: any[] = []
      for (const r of pages) {
        for (const m of (((r as any)?.list ?? []) as any[])) {
          const id = String(m?.id ?? '')
          if (id) {
            if (seen.has(id)) continue
            seen.add(id)
          }
          all.push(m)
        }
      }
      if (!all.length) return { sub, songs: [], token: '', canShuffle: false }
      const day = Math.floor(Date.now() / 86400000) + shift * 7
      const w = wrapSongs(pickSpread(all, 30, day))
      /* 池子不比输出大就换不动 —— 如实告诉界面，让它把「换一批」置灰，
         而不是让用户点了发现没反应 */
      return { sub, songs: w.songs, token: w.token, canShuffle: all.length > 30 }
    },

    /** 歌单广场翻页（首页「为你精选 · 全部」的「换一批」） */
    async square(args) {
      const page = Math.max(1, Number(args?.page ?? 1))
      const source = (normalizeSource(args?.source, false) ?? (await getSongListSetting()).source) as LX.OnlineSource
      const sorts = (getSortList(source) ?? []) as Array<{ id: string }>
      if (!sorts.length) return { playlists: [] }
      // 「换一批」轮着换分类标签：同一个标签翻页翻到底就没内容了，
      // 换标签则每一批都是新的。
      const sort = sorts[(page - 1) % sorts.length]
      const sourcePage = Math.floor((page - 1) / sorts.length) + 1
      const info = await getSonglists(source, '', sort.id, sourcePage)
      return { playlists: (info.list ?? []).map(it => toPlaylistCard(it, source)) }
    },

    /** 收藏整张歌单/榜单到「我收藏的歌单」 */
    async collectList(args) {
      const id = String(args?.id ?? '')
      const name = String(args?.name ?? '') || '歌单'
      if (!id) return { ok: false, msg: '歌单还没加载完' }
      // 收藏本身会弹原生提示（重复收藏时还会问要不要同步），这里不再叠一层 toast
      if (id.startsWith('board:')) {
        const raw = id.slice(6)
        const source = raw.split('__')[0] as LX.OnlineSource
        await collectBoard(raw, name, source)
        return { ok: true }
      }
      if (id.startsWith('sl:')) {
        const [, source, listId] = id.split(':')
        await collectSonglist(listId, source as SonglistSource, name)
        return { ok: true }
      }
      // 「我喜欢的音乐」和自建歌单本来就在自己的库里，没有「收藏」这回事
      if (id === 'love') return { ok: false, msg: '「我喜欢的音乐」就是你的收藏' }
      if (id.startsWith('ul:')) return { ok: false, msg: '这是你自己的歌单' }
      return { ok: false, msg: '这张歌单不支持收藏' }
    },

    /** 分享：song = 当前播放的歌（走内核的分享设置），list = 歌单名 */
    async share(args) {
      const kind = String(args?.kind ?? '')
      if (kind === 'song') {
        const cur = playerState.playMusicInfo.musicInfo as any
        if (!cur) return { ok: false, msg: '还没有正在播放的歌曲' }
        shareMusic(
          settingState.setting['common.shareType'],
          settingState.setting['download.fileName'],
          cur,
        )
        // 内核的分享自己会给反馈（系统分享面板 / 复制成功提示）
        return { ok: true }
      }
      const title = String(args?.title ?? '').trim() || '歌单'
      await shareText(global.i18n.t('share_title_music'), title, title).catch(() => {})
      return { ok: true }
    },

    /** 新建歌单（潮汐界面的「新建」按钮） */
    async createPlaylist(args) {
      const name = String(args?.name ?? '').trim()
      if (!name) return { ok: false, msg: '歌单名不能为空' }
      if (listState.userList.some(l => l.name === name)) {
        return { ok: false, msg: '已经有同名歌单了' }
      }
      await createUserList(listState.userList.length, [{
        id: `userlist_${Date.now()}`,
        name,
        locationUpdateTime: null,
      }])
      return { ok: true, msg: `已创建歌单「${name}」` }
    },

    /**
     * 记住界面当前主题的底色（和主题模式），下次启动时原生拿它给启动窗口/根视图上色。
     * 即发即忘：记不住颜色最多是启动时闪一下，不值得为它挡流程。
     */
    async bootBg(args) {
      try {
        const mod = (NativeModules as any)?.UtilsModule
        if (mod?.setBootBackground) {
          mod.setBootBackground(String(args?.color ?? ''), String(args?.mode ?? ''))
        }
      } catch (e) {
        // 忽略
      }
      return { ok: true }
    },

    /**
     * 把界面的深浅 + 调色板同步给原生侧。
     *
     * 原生子页面（评论、最近播放、本地音乐、**洛雪原生设置**、音源…）用的是
     * 内核主题 + 鸿蒙 token 两套东西，和界面自己的皮肤完全是两回事：
       · 不传 `dark`：深色界面里点「评论」会蹦出一张纯白页（内核主题的 auto 逻辑
         用的也是这两个 id，见 theme/themes/index.ts）；
       · 不传色值：原生设置页会是一套固定的绿，而界面可能是薄荷/星紫/琥珀……
         用户反馈的「很割裂」就是指这个。
     *
     * 所以界面把自己算好的那几个颜色（`--bg` / `--card-solid` / `--text` …）直接推过来，
     * `setTidePalette` 覆盖 harmony token，原生页面就与界面同一套配色了。
     */
    async theme(args) {
      setTheme(args?.dark === false ? 'green' : 'black')
      setTidePalette({
        dark: args?.dark !== false,
        accent: String(args?.accent ?? ''),
        bg: String(args?.bg ?? ''),
        card: String(args?.card ?? ''),
        text: String(args?.text ?? ''),
        textSub: String(args?.textSub ?? ''),
        textWeak: String(args?.textWeak ?? ''),
        divider: String(args?.divider ?? ''),
      })
      return { ok: true }
    },

    /**
     * 读播放音效状态（设备能力 + 当前设置 + 可选预设）。
     *
     * 默认每次都重新问一遍原生：频段布局、效果库可用性、音频会话都是会变的，
     * 而且这个命令只在用户打开音效弹层时发一次，不值得缓存。
     */
    async soundEffect() {
      await refreshSoundEffectStatus()
      return soundEffectPayload()
    },

    /**
     * 改播放音效设置。只传要改的字段，返回改完的最新状态。
     * 改完立刻 `applySoundEffect()`：不用等下一次播放才开始生效。
     */
    async soundEffectSet(args) {
      const patch: Partial<LX.AppSetting> = {}
      const num = (v: unknown, lo: number, hi: number) => {
        const n = Math.round(Number(v))
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
      }
      const has = (k: string) => args != null && Object.prototype.hasOwnProperty.call(args, k)

      if (has('enabled')) patch['player.soundEffectEnabled'] = !!args.enabled
      if (has('preset')) {
        const v = num(args.preset, -1, 4096)
        if (v !== null) patch['player.soundEffectPreset'] = v
      }
      if (has('bassBoost')) {
        const v = num(args.bassBoost, 0, 1000)
        if (v !== null) patch['player.soundEffectBassBoost'] = v
      }
      if (has('virtualizer')) {
        const v = num(args.virtualizer, 0, 1000)
        if (v !== null) patch['player.soundEffectVirtualizer'] = v
      }
      if (has('loudness')) {
        const v = num(args.loudness, 0, 1000)
        if (v !== null) patch['player.soundEffectLoudness'] = v
      }
      if (has('reverb')) {
        const v = num(args.reverb, 0, 6)
        if (v !== null) patch['player.soundEffectReverb'] = v
      }
      if (Object.keys(patch).length) updateSetting(patch)
      await applySoundEffect()
      return soundEffectPayload()
    },

    /** 榜单详情：id 形如 `board:kw__16` */
    async chartDetail(args) {
      const raw = String(args?.id ?? '').replace(/^board:/, '')
      return detailOf('board', raw, undefined, String(args?.sort ?? ''))
    },

    /** 歌单/榜单/自建歌单/收藏 详情（界面所有详情入口都走这里） */
    async playlistDetail(args) {
      const id = String(args?.id ?? '')
      const sort = String(args?.sort ?? '')
      // 榜单 id 形如 `board:kw__16` —— 走榜单接口，别丢给歌单接口
      if (id.startsWith('board:')) {
        return detailOf('board', id.slice(6), undefined, sort)
      }
      if (id === 'love') {
        const love = await getListMusics(LIST_IDS.LOVE).catch(() => [] as any[])
        const songs = love.map(toSong)
        return {
          title: '我喜欢的音乐',
          author: '',
          desc: '你收藏的全部歌曲',
          cover: coverKeyOf('love'),
          songs,
          token: mint({ kind: 'songs', songs, raw: love }),
        }
      }
      if (id.startsWith('ul:')) {
        const listId = id.slice(3)
        const raw = await getListMusics(listId).catch(() => [] as any[])
        const meta = listState.userList.find(l => l.id === listId)
        const songs = raw.map(toSong)
        return {
          title: meta?.name ?? '歌单',
          author: meta?.source ? `来自 ${meta.source}` : '自建歌单',
          desc: '',
          cover: coverKeyOf(listId),
          songs,
          token: mint({ kind: 'songs', songs, raw }),
        }
      }
      if (id.startsWith('sl:')) {
        const [, source, listId] = id.split(':')
        return detailOf('songlist', listId, source as LX.OnlineSource, sort)
      }
      // 兜底：当成歌单广场的 id
      const { source } = await getSongListSetting()
      return detailOf('songlist', id, source, sort)
    },

    async library() {
      return library()
    },

    async search(args) {
      const text = String(args?.text ?? '').trim()
      const source = (normalizeSource(args?.source, true) ?? 'all') as LX.OnlineSource | 'all'
      const page = Math.max(1, Number(args?.page ?? 1))
      if (!text) return { songs: [], token: '', page, total: 0, hasMore: false }
      const list = await searchMusic(text, page, source)
      const info = searchMusicState.listInfos[source]
      const w = wrapSongs(list)
      return {
        songs: w.songs,
        token: w.token,
        page,
        total: info?.total || w.songs.length,
        hasMore: !!info && info.maxPage > page,
      }
    },

    /**
     * 歌单搜索（搜索页的「歌单」页签）。
     *
     * 走内核的 `core/search/songlist`，`'all'` 是跨平台聚合（内核自己按名字相似度排）。
     * kw/kg/mg/tx/wy 五家都实现了 `songList.search`（bd 没有），
     * 所以聚合出来的结果通常一次就有几十张。
     *
     * 返回的形状和「歌单广场」完全一样（`sl:<平台>:<歌单id>`），
     * 所以界面直接复用同一套卡片与详情页，不用为搜索结果另写一份。
     */
    async searchPlaylists(args) {
      const text = String(args?.text ?? '').trim()
      const source = (normalizeSource(args?.source, true) ?? 'all') as LX.OnlineSource | 'all'
      const page = Math.max(1, Number(args?.page ?? 1))
      if (!text) return { playlists: [], page, total: 0, hasMore: false }
      // 单家接口挂掉不该让整页空白：内核那边已经按平台 catch 过一次，这里再兜一层
      const list = await searchSonglist(text, page, source).catch(() => [] as any[])
      const info = searchSonglistState.listInfos[source]
      const cards = (list ?? []).map((it: any) => toPlaylistCard(it, it.source as LX.OnlineSource))
      return {
        playlists: cards,
        page,
        total: info?.total || cards.length,
        hasMore: !!info && info.total > cards.length,
      }
    },

    /** 搜索源列表（搜索页顶部那一排 chip）。active 来自内核搜索设置，原生页与潮汐共用。 */
    async searchSources() {
      const s = await getSearchSetting().catch(() => ({ source: 'all' as const }))
      return sourceOptions(String(s.source || 'all'), true)
    },

    /** 切搜索源。temp_source 跟着改，联想词才会问用户选的那个平台（只有酷我真有 tipSearch）。 */
    async setSearchSource(args) {
      const id = normalizeSource(args?.id, true)
      if (!id) return { ok: false, msg: '没有这个搜索源' }
      await saveSearchSetting({
        source: id as LX.OnlineSource | 'all',
        temp_source: (id === 'all' ? 'kw' : id) as LX.OnlineSource,
      })
      return { ok: true }
    },

    /** 榜单平台列表。榜单必须落到某一平台，所以没有「全部」。 */
    async chartSources() {
      const s = await getLeaderboardSetting().catch(() => ({ source: 'kw' as LX.OnlineSource }))
      return sourceOptions(String(s.source || 'kw'), false)
    },

    /** 切榜单平台：写内核设置，详情页/首页补歌也会跟着用这个平台。 */
    async setChartSource(args) {
      const id = normalizeSource(args?.id, false)
      if (!id) return { ok: false, msg: '没有这个榜单平台' }
      await saveLeaderboardSetting({ source: id as LX.OnlineSource })
      return { ok: true }
    },

    /** 歌单广场平台列表。 */
    async squareSources() {
      const s = await getSongListSetting().catch(() => ({ source: 'kw' as LX.OnlineSource }))
      return sourceOptions(String(s.source || 'kw'), false)
    },

    /** 切歌单广场平台：写内核设置，详情页兜底也用这个平台。 */
    async setSquareSource(args) {
      const id = normalizeSource(args?.id, false)
      if (!id) return { ok: false, msg: '没有这个歌单平台' }
      await saveSongListSetting({ source: id as LX.OnlineSource })
      return { ok: true }
    },

    /**
     * 音源列表（「我的 · 音源」那一行与切换入口用）。形状见 apiSourcesPayload。
     */
    async apiSources() {
      return apiSourcesPayload()
    },

    /** 切换音源（内核会重新初始化该音源并把结果广播出去） */
    async setApiSource(args) {
      const id = String(args?.id ?? '')
      if (!id) return { ok: false, msg: '没有指定音源' }
      setApiSourceCore(id)
      return { ok: true }
    },

    /**
     * 从在线地址导入音源脚本。
     *
     * 规则与内核原生那一套（`UserApiEditModal/ScriptImportOnline`）完全一致：
     * 必须是 http(s)、拉回来的文本当脚本交给 `importUserApi`、超过 9MB 直接拒。
     * 自己做这一页的原因：原生那个弹层是另一套视觉（绿标题栏 + 居中标题 +
     * 浅绿按钮），压在潮汐界面上很割裂 —— 用户原话「音源点进去三级菜单还是很割裂」。
     */
    async importApiSourceUrl(args) {
      const url = String(args?.url ?? '').trim()
      if (!/^https?:\/\//.test(url)) return { ok: false, msg: '地址要以 http:// 或 https:// 开头' }
      /* 下载失败重试一次。
         为什么：模拟器上实测过一种抖动 —— App 自己打的时间戳显示这次 fetch
         只活了 **254ms** 就报 `Network request failed`，而同一时刻宿主机服务端
         日志里那条 GET 是 **200**（带 `?_=`，确认是 App 发的）。同一进程此前已经
         开了很多音频连接，看起来是 NAT/连接池那一侧丢了第一枪。
         真实用户遇到偶发网络抖动也不该让他重新点一遍「导入」，所以重试一次；
         两次都失败才报错，并说明「重试过一次」，免得以为是脚本地址的问题。 */
      let resp: { body?: unknown, statusCode?: number } | null = null
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          resp = await httpFetch(url).promise as any
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 700))
        }
      }
      if (lastErr || !resp) {
        return {
          ok: false,
          msg: '下载失败：' + ((lastErr as Error)?.message ?? '未知错误') + '（重试过一次）',
        }
      }
      /* 状态码要自己判：拿到 404 时 `body` 往往是个空串，只报「内容是空的」
         会让人以为是地址写错了地方（实测 `registry.npmmirror.com/.../files/x.js`
         这种接口 404 时就是空 body）。 */
      const code = Number(resp.statusCode ?? 0)
      if (code && (code < 200 || code >= 300)) {
        return { ok: false, msg: `下载失败：服务器返回 ${code}` }
      }
      const script = resp.body as string
      if (typeof script !== 'string' || !script.length) return { ok: false, msg: '下载到的内容是空的' }
      if (script.length > 9_000_000) return { ok: false, msg: '脚本太大了（超过 9MB）' }
      try {
        await importUserApi(script)
      } catch (e) {
        return { ok: false, msg: '导入失败：' + ((e as Error)?.message ?? '未知错误') }
      }
      return { ok: true, sources: apiSourcesPayload() }
    },

    /**
     * 从本地文件导入音源脚本。
     *
     * 走**系统文件选择器**（`AndroidScoped.openDocument`）—— 那是安卓自己的界面，
     * 用户不会觉得割裂，也不用把内核那个自绘文件浏览器搬过来。
     * 选完文件读出来交给 `importUserApi`，跟原生那条路一样（.js 之外的类型拒掉）。
     */
    async importApiSourceFile() {
      let file: { data?: string } | null = null
      try {
        file = (await selectFile({
          extTypes: USER_API_SOURCE_FILE_EXT_RXP,
          toPath: TEMP_FILE_PATH,
        })) as any
      } catch (e) {
        return { ok: false, msg: '打不开文件选择器：' + ((e as Error)?.message ?? '未知错误') }
      }
      const path = file?.data ?? ''
      // 用户在系统选择器里点了返回：不是错误，界面按「取消」处理
      if (!path) return { ok: false, cancelled: true }
      if (!USER_API_SOURCE_FILE_EXT_RXP.some(ext => path.toLowerCase().endsWith('.' + ext))) {
        void unlink(path)
        return { ok: false, msg: '这个文件不是音源脚本（应该是 .js）' }
      }
      const script = await readFile(path).catch(() => null)
      void unlink(path)
      if (script == null) return { ok: false, msg: '读文件失败' }
      try {
        await importUserApi(script)
      } catch (e) {
        return { ok: false, msg: '导入失败：' + ((e as Error)?.message ?? '未知错误') }
      }
      return { ok: true, sources: apiSourcesPayload() }
    },

    /**
     * 删掉一个音源脚本。
     *
     * 内核的 `removeUserApi` 收的是 id 数组（和 `removeUserList` 那种「对内对外同名不同参」
     * 的情况不一样，这里只有这一个）。删完把最新列表带回去，界面不用再问一次。
     */
    async removeApiSource(args) {
      const id = String(args?.id ?? '')
      if (!id) return { ok: false, msg: '没有指定音源' }
      try {
        await removeUserApi([id])
      } catch (e) {
        return { ok: false, msg: '删除失败：' + ((e as Error)?.message ?? '未知错误') }
      }
      return { ok: true, sources: apiSourcesPayload() }
    },

    async hot() {
      // 必须传 'all'：部分平台没有 hotSearch 接口，传单个平台常常拿到空列表
      const words = await getHotSearch('all').catch(() => [] as string[])
      return {
        hot: (words ?? []).slice(0, 12).map((w, i) => ({
          w,
          d: i < 3 ? '热度飙升' : '大家都在搜',
          b: i === 0 ? '爆' : i < 3 ? '热' : '',
        })),
      }
    },

    async history() {
      const list = await getSearchHistory().catch(() => [] as string[])
      return { history: list ?? [] }
    },
    async addHistory(args) {
      await addHistoryWord(String(args?.word ?? '')).catch(() => {})
      const list = await getSearchHistory().catch(() => [] as string[])
      return { history: list ?? [] }
    },
    async clearHistory() {
      await clearHistoryList().catch(() => {})
      return { ok: true }
    },

    /**
     * 搜索联想词（边打字边给的补全）。
     *
     * 用的是内核各家 SDK 自己的 `tipSearch` —— 酷我那个打的是 `tips.kuwo.cn/t.s`，
     * 返回的就是它搜索框里那串 RELWORD。
     *
     * ⚠️ 只有酷我（kw）在 `musicSdk` 各家的 `index.js` 里是**真的挂上了** tipSearch，
     * kg / mg / tx / wy 那几家都被注释掉了。所以这里按当前平台取，取不到就返回空数组，
     * 界面那边用本地历史 + 热搜兜底（见 app.js 的 showSearchTips），不会白等。
     *
     * 问哪个平台：界面现在会带 `source`（搜索页顶部选的平台）；
     * 没带就退回 `search.temp_source`（内核搜索页用的也是它，默认 kw）。
     * 「全部」没有自己的 tipSearch，仍用 temp_source（切到全部时界面会把它写成 kw）。
     */
    async tips(args) {
      const text = String(args?.text ?? '').trim()
      if (!text) return { tips: [] }
      const req = normalizeSource(args?.source, true)
      const { temp_source } = await getSearchSetting().catch(() => ({ temp_source: 'kw' as LX.OnlineSource }))
      const source = (req && req !== 'all' ? req : temp_source) as LX.OnlineSource
      const sdk = (musicSdk as any)[source]
      if (!sdk?.tipSearch?.search) return { tips: [], unsupported: true }
      const list = await sdk.tipSearch.search(text).catch(() => null)
      return {
        tips: (Array.isArray(list) ? list : [])
          .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
          .slice(0, 12),
      }
    },

    /** 播放：token + 下标 */
    async play(args) {
      const entry = tokens.get(String(args?.token ?? ''))
      const index = Number(args?.index ?? 0)
      /* 空列表要说出来。原来只回 { ok: false }，界面那边 resolve 了、什么都不做，
         表现就是「点了没反应」—— 用户报的「点不进去」有一部分就是这个。 */
      if (!entry || !entry.songs.length) {
        return { ok: false, msg: '这个列表还是空的，先去收藏几首吧' }
      }

      if (entry.kind === 'board') {
        // 复用底座的动作：它会 setTempList 当前页并 playList，随后补齐完整列表
        await playBoard(entry.id!, entry.raw, index)
      } else if (entry.kind === 'songlist') {
        await playPlaylist(entry.id!, entry.source!, entry.raw, index)
      } else {
        const listId = `tide_${Date.now()}`
        await setTempList(listId, entry.raw as LX.Music.MusicInfoOnline[])
        void playList(LIST_IDS.TEMP, index)
      }
      return { ok: true }
    },

    async toggle() { togglePlay(); return { ok: true } },
    async next() { void playNext(); return { ok: true } },
    async prev() { void playPrev(); return { ok: true } },
    async seek(args) {
      const sec = Number(args?.sec ?? 0)
      if (Number.isFinite(sec)) void setCurrentTime(Math.max(0, sec))
      return { ok: true }
    },
    async setMode(args) {
      const m = Number(args?.mode ?? 0)
      updateSetting({ 'player.togglePlayMethod': UI_MODE_TO_SETTING[m] ?? 'list' })
      return { ok: true }
    },
    async like(args) {
      const on = !!args?.on
      const love = (getListMusicSync(LIST_IDS.LOVE) ?? []) as any[]
      const cur = playerState.playMusicInfo.musicInfo as any
      const has = cur ? love.some(m => m.id === cur.id) : false
      if (on && !has) collectMusic()
      if (!on && has) uncollectMusic()
      return { ok: true }
    },

    async queue() {
      /* 读 listManage 的同步快照。⚠️ 不能读 listState.allMusicList —— 那个
         store Map 从启动到现在没有任何写入方（真数据源在 utils/listManage 的
         allMusicList，setMusicList/overwrite 全写那边），读它永远得到空队列，
         真机上的「播放队列」就因为这个一直是空态（预览 mock 看不出来）。 */
      const list = getListMusicSync(LIST_IDS.TEMP) as any[]
      return { songs: list.map(toSong) }
    },
    async queuePlay(args) {
      const index = Number(args?.index ?? 0)
      void playList(LIST_IDS.TEMP, index)
      return { ok: true }
    },

    /* 清空播放队列：待播的全清掉，**保留正在播的这首**（与主流音乐 App 一致）。
       ⚠️ 不能真全清：watchList 监听列表变化，全清会被判成「当前歌被移除」
       而立刻 playNext → 空列表 → 停止播放并把当前歌清掉（实测就是这个链）。
       保留用的是 playMusicInfo 里的对象本身而不是回列表里找 id —— 换源后
       当前歌的 id 已经变成新平台的（实测），在原列表里按 id 找是空的。 */
    async queueClear() {
      const cur = playerState.playMusicInfo
      const keep = (cur.listId === LIST_IDS.TEMP && cur.musicInfo && (cur.musicInfo as any).source)
        ? [cur.musicInfo as LX.Music.MusicInfoOnline]
        : []
      await setTempList(LIST_IDS.TEMP, keep)
      return { ok: true, kept: keep.length }
    },

    /* ── 歌曲下载 ── */
    async downloadSong(args) {
      if (args?.current) {
        let cur = playerState.playMusicInfo.musicInfo as any
        if (!cur) return { ok: false, msg: '当前没有在播的歌曲' }
        /* 下载列表条目（ListItem）的真实歌对象在 metadata.musicInfo 里 */
        if (cur.metadata && cur.metadata.musicInfo) cur = cur.metadata.musicInfo
        if (!cur.source) return { ok: false, msg: '当前没有在播的在线歌曲' }
        return enqueueDownloads([cur], true)
      }
      const entry = tokens.get(String(args?.token ?? ''))
      const index = Number(args?.index ?? 0)
      const raw = entry?.raw?.[index]
      if (!raw) return { ok: false, msg: '没有找到这首歌' }
      return enqueueDownloads([raw], true)
    },

    /* 整张歌单/榜单入队：逐首串行下载，事件里带还剩几首 */
    async downloadList(args) {
      const entry = tokens.get(String(args?.token ?? ''))
      if (!entry || !entry.songs.length) return { ok: false, msg: '这个列表还是空的' }
      return enqueueDownloads(entry.raw, false)
    },

    /* 「我的下载」：列出落盘目录里的文件（最新在前） */
    async downloads() {
      let items: any[] = []
      try { items = (await readDir(dlDir())) as any[] } catch { return { ok: true, files: [] } }
      const files = (items || [])
        .filter(f => f && f.isFile !== false)
        .map(f => ({ name: f.name, size: f.size || 0, mtime: f.lastModified || 0 }))
        .sort((a: any, b: any) => b.mtime - a.mtime)
      return { ok: true, files }
    },

    async downloadDelete(args) {
      const name = String(args?.name ?? '')
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return { ok: false, msg: '文件名不对' }
      }
      try {
        await unlink(`${dlDir()}/${name}`)
      } catch {
        return { ok: false, msg: '删除失败，文件可能已经不在了' }
      }
      return { ok: true }
    },

    async lyrics() {
      const info = playerState.musicInfo
      return { lrc: info?.lrc ?? '', tlrc: info?.tlrc ?? '' }
    },

    /**
     * 桌面歌词开关（主题页那颗）。与原生设置页是同一个动作：
     * 开 = 先查悬浮窗权限，过了再 show；没过就去开系统设置页，界面把开关按回原位。
     */
    async setDesktopLyric(args) {
      const on = !!args?.enable
      try {
        if (on) {
          await checkDesktopLyricOverlayPermission()
          await showDesktopLyric()
        } else {
          await hideDesktopLyric()
        }
      } catch (err) {
        if (on) {
          try { openDesktopLyricOverlayPermissionActivity() } catch {}
          return { ok: false, msg: '需要悬浮窗权限，已打开系统设置，授权后再开' }
        }
        /* 关的时候本来就没在显示，报错也当关成功 */
      }
      updateSetting({ 'desktopLyric.enable': on })
      return { ok: true }
    },

    async toast(args) {
      nativeToast(String(args?.msg ?? ''))
      return { ok: true }
    },
  }

  /* ───────────── 事件推送 ───────────── */

  function subscribe(emit: (event: string, payload: any) => void) {
    const offs: Array<() => void> = []
    let lastProgressAt = 0

    /* 后台补齐的榜单封面也要推给界面，所以把推送口记下来 */
    emitRef = emit

    /** 当前播放态打包（歌 + 播放状态 + 进度 + 模式 + 是否已收藏） */
    const onMusic = () => { emit('player', playerSnapshot()) }
    const onState = () => { emit('player', playerSnapshot()) }
    // 歌词是随后异步加载进 musicInfo 的，单独通知界面重取一次
    const onLyric = () => { emit('lyrics', {}) }
    const onQueue = () => { emit('queue', {}) }
    /* 音源换了就把最新列表推一次：用户是在**原生音源页**里换的，
       界面那层盖在下面，切回来时不会重新走一遍 goTab，不推的话摘要一直是旧的 */
    const onApiSource = () => { emit('apiSources', apiSourcesPayload()) }
    const onProgress = () => {
      const now = Date.now()
      // 限流到 4 次/秒：再密对界面也没意义，只会让 WebView 忙
      if (now - lastProgressAt < 250) return
      lastProgressAt = now
      emit('progress', {
        position: playerState.progress.nowPlayTime ?? 0,
        duration: playerState.progress.maxPlayTime ?? 0,
      })
    }

    global.state_event.on('playMusicInfoChanged', onMusic)
    global.state_event.on('playerMusicInfoChanged', onLyric)
    global.state_event.on('playStateChanged', onState)
    global.state_event.on('playProgressChanged', onProgress)
    global.state_event.on('playTempPlayListChanged', onQueue)
    global.state_event.on('apiSourceUpdated', onApiSource)

    offs.push(
      () => { global.state_event.off('playMusicInfoChanged', onMusic) },
      () => { global.state_event.off('playerMusicInfoChanged', onLyric) },
      () => { global.state_event.off('playStateChanged', onState) },
      () => { global.state_event.off('playProgressChanged', onProgress) },
      () => { global.state_event.off('playTempPlayListChanged', onQueue) },
      () => { global.state_event.off('apiSourceUpdated', onApiSource) },
    )

    /* 订阅进来先补一帧当前播放态：内核恢复上次播放发生在这之前，
       那串事件界面一个都没收到（冷启动后迷你条不出现的根因之一） */
    emit('player', playerSnapshot())

    return () => {
      if (emitRef === emit) emitRef = null
      offs.forEach(fn => { fn() })
    }
  }

  return {
    async handle(cmd, args) {
      const fn = commands[cmd]
      if (!fn) throw new Error('未知命令: ' + cmd)
      return fn(args)
    },
    subscribe,
  }
}
