/**
 * 播放历史（「我的 - 最近播放」的数据源）
 *
 * ## 为什么不用底座的 `playerState.playedList`
 *
 * 那个数组的名字容易误解 —— 它**不是**播放历史，而是
 * 「随机播放模式下已经播过、别再随机到」的**去重队列**：
 *   - 只在 `player.togglePlayMethod == 'random'` 时才写入
 *     （`core/player/player.ts:195,263`），默认是 `listLoop` ⇒ 永远是空的；
 *   - 切列表时会被 `clearPlayedList()` 清空（`core/player/player.ts:279,293`）；
 *   - 只在内存里，重启即丢（`utils/data.ts` 里没有它的读写）。
 *
 * 用它渲染「最近播放」会得到一个**默认空、且随时被清**的页面 —— 实测确认过。
 * 所以这里单独维护一份**持久化**的播放历史。
 *
 * ## 记录规则（与鸿蒙版观感对齐，且不啰嗦）
 *
 *   - 同一首歌只保留**最新一次**播放（去重后置顶），与鸿蒙的「最近播放」一致；
 *   - 最多保留 `MAX_HISTORY` 条，超出丢最旧的；
 *   - 只记「真正开始播」的歌（由 `initHistory` 订阅 `playMusicInfoChanged`）。
 */
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import playerState from '@/store/player/state'

/** 最多保留多少条历史 */
const MAX_HISTORY = 300

/** 历史里的一条（只存渲染与再播放所需的字段，避免把整个列表塞进存储） */
export interface HistoryItem {
  /** 歌曲 id */
  id: string
  name: string
  singer: string
  /** 来源（local / kw / kg / …），用于判断能否走在线播放 */
  source: LX.Source
  /** 封面 */
  pic?: string | null
  /** 记录时间（毫秒） */
  time: number
}

let history: HistoryItem[] = []
let loaded = false
/** 订阅者（页面用） */
const listeners = new Set<(list: HistoryItem[]) => void>()

const notify = () => {
  for (const fn of listeners) fn([...history])
}

/** 读取历史（首次调用会从存储加载） */
export const getHistory = async(): Promise<HistoryItem[]> => {
  if (!loaded) {
    history = (await getData<HistoryItem[]>(storageDataPrefix.playHistory)) ?? []
    loaded = true
  }
  return [...history]
}

/** 内存里的历史（已加载过才有值；页面应先用 getHistory） */
export const getHistorySync = (): HistoryItem[] => [...history]

/** 订阅历史变化（返回取消订阅函数） */
export const subscribeHistory = (fn: (list: HistoryItem[]) => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

const persist = () => {
  void saveData(storageDataPrefix.playHistory, history)
}

/** 记一条播放历史（同 id 去重后置顶） */
export const addHistory = (item: HistoryItem) => {
  history = [item, ...history.filter(h => h.id !== item.id)].slice(0, MAX_HISTORY)
  persist()
  notify()
}

/** 按 id 批量删除 */
export const removeHistory = (ids: string[]) => {
  if (!ids.length) return
  const set = new Set(ids)
  history = history.filter(h => !set.has(h.id))
  persist()
  notify()
}

/** 清空历史 */
export const clearHistory = () => {
  history = []
  persist()
  notify()
}

/**
 * 接上播放事件：开始播一首歌就记一条历史
 *
 * 在 `core/init` 里调一次即可。**不要**放进 `core/player/player.ts`，
 * 那样会把「历史」这个 UI 侧概念耦合进播放核心。
 */
export const initHistory = () => {
  void getHistory()
  global.state_event.on('playMusicInfoChanged', (playMusicInfo) => {
    const musicInfo = playMusicInfo?.musicInfo
    if (!musicInfo) return
    // 下载项（`LX.Download.ListItem`）没有直接的 name/singer，走 metadata
    const isDownloadItem = 'progress' in musicInfo
    const target = isDownloadItem ? musicInfo.metadata.musicInfo : musicInfo
    if (!target?.id) return
    addHistory({
      id: target.id,
      name: target.name,
      singer: target.singer,
      source: target.source,
      pic: target.meta?.picUrl ?? null,
      time: Date.now(),
    })
  })
}

/** 当前正在播的那首（页面用来高亮） */
export const getCurrentPlayingId = (): string | null =>
  playerState.playMusicInfo.musicInfo?.id ?? null
