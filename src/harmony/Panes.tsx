/**
 * 二级列表页（「我的」页 5 个快捷入口的落点）
 *
 * 对应鸿蒙侧 `views/{LocalMusicView,HistoryView,...}` + 共用的 `SongListPane`
 * （规格 2.11）。RN 底座里这些页面**大部分没有对应实现**，所以这一层按能力分三类：
 *
 *   1. **有真实数据** → 真正渲染列表（收藏、最近播放）
 *   2. **有部分能力** → 渲染 + 明确说明限制（本地音乐：只能导入，不能扫库）
 *   3. **底座完全没有** → 明确空态说明，不假装有功能（下载管理、云端音乐）
 *
 * 为什么不复用底座的 `components/OnlineList`：它的行渲染直接读
 * `musicInfo.meta._qualitys`（`OnlineList/ListItem.tsx`），而本地歌的 meta 里
 * **没有 `_qualitys`**（只有 filePath/ext）⇒ 会抛 TypeError；且它的行点击默认
 * 会把歌塞进「试听列表」（`list.isClickPlayList` 默认 false，传了 onPlayList 也不生效）。
 * 所以这里用移植层自己的 `SongRow`（不碰 `_qualitys`）。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native'
import { useTokens } from './useTokens'
import { LxIcon, type IconName } from './LxIcon'
import { SongRow, RowDivider } from './SongRow'
import { F_ITEM, F_SUB, R_CARD } from './tokens'
import { contentColumnsFor } from './Layout'
import { getListMusics, removeListMusics } from '@/core/list'
import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { LIST_IDS } from '@/config/constant'
import { setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { confirmDialog, toast } from '@/utils/tools'
import {
  getHistory,
  removeHistory,
  clearHistory,
  subscribeHistory,
  type HistoryItem,
} from './playHistory'

/** 二级页共用的整屏外壳（自带返回栏） */
interface PaneShellProps {
  title: string
  topInset: number
  onBack: () => void
  /** 头部（可选，列表上方常驻） */
  header?: React.ReactNode
  children: React.ReactNode
}

export const PaneShell = ({ title, topInset, onBack, header, children }: PaneShellProps) => {
  const t = useTokens()
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          height: 60 + topInset,
          paddingTop: topInset,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 4,
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          style={{ width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={0.6}
        >
          <LxIcon name="chevronLeft" size={24} color={t.text} />
        </TouchableOpacity>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '600', color: t.text }}>
          {title}
        </Text>
      </View>
      {header}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  )
}

/** 空态（与鸿蒙 EmptyState 同款：一句主文案 + 一句说明） */
const EmptyState = ({ text, hint, icon }: { text: string, hint?: string, icon?: IconName }) => {
  const t = useTokens()
  return (
    <View style={{ alignItems: 'center', paddingTop: 82, paddingHorizontal: 32, gap: 8 }}>
      {icon && <LxIcon name={icon} size={30} color={t.textWeak} />}
      <Text style={{ fontSize: 15, color: t.textSub }}>{text}</Text>
      {!!hint && (
        <Text style={{ fontSize: F_SUB, color: t.textWeak, textAlign: 'center', lineHeight: 19 }}>
          {hint}
        </Text>
      )}
    </View>
  )
}

/** 未移植说明页（底座完全没有该能力时用，明确讲清楚而不是假装有） */
const NotSupported = ({ title, lines }: { title: string, lines: string[] }) => {
  const t = useTokens()
  return (
    <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 60, gap: 10 }}>
      <Text style={{ fontSize: F_ITEM, fontWeight: '600', color: t.text }}>{title}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={{ fontSize: 14, lineHeight: 22, color: t.textSub }}>
          {line}
        </Text>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------- 当前播放

/**
 * 当前正在播的歌曲 id（跟着播放变化刷新）
 *
 * 用它给列表里的「正在播」那一行加高亮（与鸿蒙 SongListPane 的 `currentId` 一致）。
 */
const useCurrentPlayingId = (): string | null => {
  const [id, setId] = useState<string | null>(playerState.playMusicInfo.musicInfo?.id ?? null)
  useEffect(() => {
    const update = () => { setId(playerState.playMusicInfo.musicInfo?.id ?? null) }
    global.state_event.on('playMusicInfoChanged', update)
    return () => { global.state_event.off('playMusicInfoChanged', update) }
  }, [])
  return id
}

// ---------------------------------------------------------------- 通用歌曲列表

interface SongItem {
  id: string
  name: string
  singer: string
  pic?: string | null
}

/**
 * 单行的外壳（多列时按列等分，单列铺满）
 *
 * 单独抽成 `memo` 组件，并且**回调通过 props 传进来、由行自己带 index 去调** ——
 * 这样 `renderItem` 不必为了捕获 index 而每次新建闭包，行也就不必跟着
 * 父组件的无关重渲染（loading 切换等）一起重渲染。
 */
const SongRowItem = memo(({
  item,
  index,
  columns,
  isCurrent,
  onPressSong,
  onLongPressSong,
}: {
  item: SongItem
  index: number
  columns: number
  isCurrent: boolean
  onPressSong: (index: number) => void
  onLongPressSong?: (index: number) => void
}) => {
  const handlePress = useCallback(() => { onPressSong(index) }, [onPressSong, index])
  const handleLongPress = useMemo(
    () => (onLongPressSong ? () => { onLongPressSong(index) } : undefined),
    [onLongPressSong, index],
  )
  return (
    <View style={columns > 1 ? { flex: 1 / columns } : undefined}>
      <SongRow
        name={item.name}
        singer={item.singer}
        pic={item.pic ?? undefined}
        isCurrent={isCurrent}
        onPress={handlePress}
        onLongPress={handleLongPress}
      />
      <RowDivider inset={78} />
    </View>
  )
})

/** 底部留白盖过悬浮栏（离底 16 + 栏高 56） */
const LIST_BOTTOM_PAD = { paddingBottom: 120 }

/**
 * 二级页的歌曲列表
 *
 * 用移植层的 `SongRow` + `FlatList`（平板按 `contentColumnsFor` 多列），
 * 不碰底座 `OnlineList` 的在线类型约束。
 *
 * 性能上做了三件事（长列表里成百上千次无谓 render 都来自这里）：
 *   1. `renderItem` / `keyExtractor` 用 `useCallback` 稳定住 —— 否则 `FlatList`
 *      每次父组件重渲染都认为「渲染方式变了」，会把可见行全部重渲染一遍；
 *   2. 行抽成 `memo(SongRowItem)`，回调由行自己带 index 调，避免捕获式闭包；
 *   3. 显式给虚拟化参数 —— `windowSize` 默认 **21**，即一次留住 21 屏的行，
 *      对几百条的历史/收藏太浪费；这里收到 11（仍是 5 屏上下的余量）。
 *
 * 没给 `getItemLayout`：多列时「第几个 = 第几行」要按列数换算，且行高外边
 * 还挂着一条 0.6 的分割线，算错会让滚动条与内容错位 —— 收益不抵这个风险。
 */
const SongPane = ({
  songs,
  currentId,
  emptyText,
  emptyHint,
  emptyIcon,
  onPressSong,
  onLongPressSong,
  onLayoutWidth,
  columns,
}: {
  songs: SongItem[]
  currentId: string | null
  emptyText: string
  emptyHint?: string
  emptyIcon?: IconName
  onPressSong: (index: number) => void
  onLongPressSong?: (index: number) => void
  onLayoutWidth: (w: number) => void
  columns: number
}) => {
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<SongItem>) => (
      <SongRowItem
        item={item}
        index={index}
        columns={columns}
        isCurrent={currentId === item.id}
        onPressSong={onPressSong}
        onLongPressSong={onLongPressSong}
      />
    ),
    [columns, currentId, onPressSong, onLongPressSong],
  )

  // id 在三个列表里都是唯一的（各自都做过去重），退路才用下标
  const keyExtractor = useCallback((item: SongItem, i: number) => item.id || `i-${i}`, [])
  const columnWrapperStyle = useMemo(
    () => (columns > 1 ? { paddingHorizontal: 8 } : undefined),
    [columns],
  )
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => { onLayoutWidth(e.nativeEvent.layout.width) },
    [onLayoutWidth],
  )

  if (songs.length === 0) {
    return (
      <View style={{ flex: 1 }} onLayout={handleLayout}>
        <EmptyState text={emptyText} hint={emptyHint} icon={emptyIcon} />
      </View>
    )
  }

  return (
    <FlatList
      key={`cols-${columns}`}
      data={songs}
      numColumns={columns}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      columnWrapperStyle={columnWrapperStyle}
      contentContainerStyle={LIST_BOTTOM_PAD}
      onLayout={handleLayout}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={11}
    />
  )
}

// ---------------------------------------------------------------- 收藏

export const FavoritesPane = ({ topInset, onBack }: { topInset: number, onBack: () => void }) => {
  const t = useTokens()
  const [songs, setSongs] = useState<LX.Music.MusicInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [winWidth, setWinWidth] = useState(0)
  const columns = contentColumnsFor(winWidth)
  const currentPlayingId = useCurrentPlayingId()

  const reload = useCallback(() => {
    void getListMusics(LIST_IDS.LOVE).then(list => {
      setSongs([...list])
      setLoading(false)
    }).catch(() => { setLoading(false) })
  }, [])

  useEffect(() => {
    reload()
    // 收藏变化：列表集合变化 + 列表内歌曲变化（两个事件都要订）
    const onMyListUpdate = () => { reload() }
    const onMusicUpdate = (ids: string[]) => { if (ids.includes(LIST_IDS.LOVE)) reload() }
    global.state_event.on('mylistUpdated', onMyListUpdate)
    global.app_event.on('myListMusicUpdate', onMusicUpdate)
    return () => {
      global.state_event.off('mylistUpdated', onMyListUpdate)
      global.app_event.off('myListMusicUpdate', onMusicUpdate)
    }
  }, [reload])

  const playAt = useCallback((index: number) => {
    void setTempList(`pane_favorites`, songs as LX.Music.MusicInfoOnline[]).then(() => {
      void playList(LIST_IDS.TEMP, index)
    })
  }, [songs])

  /** 长按取消收藏 */
  const handleLongPress = useCallback((index: number) => {
    const target = songs[index]
    if (!target) return
    void confirmDialog({
      message: `把「${target.name}」从收藏里去掉？下载与本地文件都不受影响。`,
      cancelButtonText: '取消',
      confirmButtonText: '取消收藏',
    }).then(confirm => {
      if (!confirm) return
      void removeListMusics(LIST_IDS.LOVE, [target.id]).then(() => {
        toast('已取消收藏')
        reload()
      })
    })
  }, [songs, reload])

  // 只依赖 songs：不缓存的话每次 render 都 map 出一个**新数组**，
  // FlatList 会认为数据整体变了，把可见行全部重渲染一遍
  const rows = useMemo(
    () => songs.map(s => ({ id: s.id, name: s.name, singer: s.singer, pic: s.meta?.picUrl })),
    [songs],
  )

  return (
    <PaneShell title="收藏" topInset={topInset} onBack={onBack}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 80 }}>
          <ActivityIndicator color={t.red} />
        </View>
      ) : (
        <SongPane
          songs={rows}
          currentId={currentPlayingId}
          emptyText="还没有收藏的歌曲"
          emptyHint="在播放页点那颗心，或在列表里长按歌曲选「收藏」"
          emptyIcon="heart"
          onPressSong={playAt}
          onLongPressSong={handleLongPress}
          onLayoutWidth={setWinWidth}
          columns={columns}
        />
      )}
    </PaneShell>
  )
}

// ---------------------------------------------------------------- 最近播放

export const HistoryPane = ({ topInset, onBack }: { topInset: number, onBack: () => void }) => {
  const t = useTokens()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [winWidth, setWinWidth] = useState(0)
  const columns = contentColumnsFor(winWidth)
  const currentPlayingId = useCurrentPlayingId()

  useEffect(() => {
    void getHistory().then(list => {
      setItems(list)
      setLoading(false)
    })
    return subscribeHistory(list => { setItems(list) })
  }, [])

  const playAt = useCallback((index: number) => {
    const item = items[index]
    if (!item) return
    // 历史里只存了渲染字段，没有完整的 meta（在线播放需要），
    // 所以这里用「临时列表 + 只含这一首」的方式播 —— 能播，且不污染试听列表。
    void setTempList(`pane_history`, [{
      id: item.id,
      name: item.name,
      singer: item.singer,
      source: item.source,
      interval: null,
      meta: { songId: item.id, albumName: '', picUrl: item.pic ?? '' },
    }] as unknown as LX.Music.MusicInfoOnline[]).then(() => {
      void playList(LIST_IDS.TEMP, 0)
    })
  }, [items])

  const handleClear = useCallback(() => {
    if (items.length === 0) return
    void confirmDialog({
      message: `清空这 ${items.length} 条播放记录？收藏、下载与本地文件都不受影响。`,
      cancelButtonText: '取消',
      confirmButtonText: '清空',
    }).then(confirm => {
      if (!confirm) return
      clearHistory()
      toast('已清空播放记录')
    })
  }, [items.length])

  const handleLongPress = useCallback((index: number) => {
    const target = items[index]
    if (!target) return
    void confirmDialog({
      message: `从播放历史里删掉「${target.name}」？收藏、下载与本地文件都不受影响。`,
      cancelButtonText: '取消',
      confirmButtonText: '删除',
    }).then(confirm => {
      if (!confirm) return
      removeHistory([target.id])
    })
  }, [items])

  const header = items.length > 0
    ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 }}>
        <Text style={{ flex: 1, fontSize: F_SUB, color: t.textWeak }}>{items.length} 条记录</Text>
        <TouchableOpacity onPress={handleClear} activeOpacity={0.6}>
          <Text style={{ fontSize: F_SUB, color: t.red, paddingVertical: 4 }}>清空</Text>
        </TouchableOpacity>
      </View>
      )
    : null

  // 同上：不缓存会让 FlatList 每次 render 都收到新数组
  const rows = useMemo(
    () => items.map(i => ({ id: i.id, name: i.name, singer: i.singer, pic: i.pic })),
    [items],
  )

  return (
    <PaneShell title="最近播放" topInset={topInset} onBack={onBack} header={header}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 80 }}>
          <ActivityIndicator color={t.red} />
        </View>
      ) : (
        <SongPane
          songs={rows}
          currentId={currentPlayingId}
          emptyText="还没有播放记录"
          emptyHint="播放过的歌会自动出现在这里"
          emptyIcon="clock"
          onPressSong={playAt}
          onLongPressSong={handleLongPress}
          onLayoutWidth={setWinWidth}
          columns={columns}
        />
      )}
    </PaneShell>
  )
}

// ---------------------------------------------------------------- 本地音乐

export const LocalMusicPane = ({ topInset, onBack }: { topInset: number, onBack: () => void }) => {
  const t = useTokens()
  const [songs, setSongs] = useState<LX.Music.MusicInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [winWidth, setWinWidth] = useState(0)
  const columns = contentColumnsFor(winWidth)
  const currentPlayingId = useCurrentPlayingId()

  /**
   * 本地歌的收集方式
   *
   * 底座**没有**「本地音乐」这个独立集合（`LIST_IDS` 里没有 local），
   * 本地歌是「普通歌单里的成员」（`handleImportMediaFile(listInfo, path)` 把导入的
   * 本地文件加进指定歌单）。所以这里遍历所有歌单，把 `source === 'local'` 的挑出来。
   */
  const reload = useCallback(() => {
    // 用 store 里的列表集合（`listState.allList` 含试听 / 收藏 / 自建歌单）
    const all = listState.allList
    const ids = all.length
      ? all.map(l => l.id)
      : [LIST_IDS.DEFAULT, LIST_IDS.LOVE]
    void Promise.all(ids.map((id: string) => getListMusics(id).catch(() => [])))
      .then(lists => {
        const seen = new Set<string>()
        const local: LX.Music.MusicInfo[] = []
        for (const list of lists) {
          for (const m of list) {
            if (m.source !== 'local' || seen.has(m.id)) continue
            seen.add(m.id)
            local.push(m)
          }
        }
        setSongs(local)
        setLoading(false)
      })
      .catch(() => { setLoading(false) })
  }, [])

  useEffect(() => {
    reload()
    const onMusicUpdate = () => { reload() }
    global.app_event.on('myListMusicUpdate', onMusicUpdate)
    return () => { global.app_event.off('myListMusicUpdate', onMusicUpdate) }
  }, [reload])

  const playAt = useCallback((index: number) => {
    void setTempList(`pane_local`, songs as LX.Music.MusicInfoOnline[]).then(() => {
      void playList(LIST_IDS.TEMP, index)
    })
  }, [songs])

  const handleImport = useCallback(() => {
    // 导入本身走底座现成的流程（文件选择 + `handleImportMediaFile`），
    // 但它需要「一个目标歌单」——底座没有独立的本地库，本地歌是歌单成员。
    // 所以这里引导用户去自建歌单里导入，而不是在这里再做一个残缺的选择器。
    toast('请在「我的 - 自建歌单」里用「歌单导入」选择本地文件夹', 'long')
  }, [])

  const header = (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingLeft: 14,
            paddingRight: 16,
            paddingTop: 9,
            paddingBottom: 9,
            borderRadius: 19,
            backgroundColor: t.red,
          }}
          onPress={handleImport}
          activeOpacity={0.85}
        >
          <LxIcon name="download" size={17} color="#FFFFFF" />
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#FFFFFF' }}>导入音乐</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {songs.length > 0 && (
          <Text style={{ fontSize: F_SUB, color: t.textWeak }}>{songs.length} 首</Text>
        )}
      </View>
      {songs.length === 0 && (
        <Text style={{ fontSize: F_SUB, color: t.textWeak, lineHeight: 18 }}>
          系统不允许三方应用自己扫描音乐库，所以导入走文件管理：在「我的 - 自建歌单」里新建一个歌单，
          再用「歌单导入」选中设备上的音频文件夹，导入后本地歌会出现在这里。
        </Text>
      )}
    </View>
  )

  // 同上：不缓存会让 FlatList 每次 render 都收到新数组
  const rows = useMemo(
    () => songs.map(s => ({ id: s.id, name: s.name, singer: s.singer, pic: s.meta?.picUrl })),
    [songs],
  )

  return (
    <PaneShell title="本地音乐" topInset={topInset} onBack={onBack} header={header}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
          <ActivityIndicator color={t.red} />
        </View>
      ) : (
        <SongPane
          songs={rows}
          currentId={currentPlayingId}
          emptyText="还没有导入本地音乐"
          emptyHint="按上面的说明导入后，本地歌会出现在这里"
          emptyIcon="folder"
          onPressSong={playAt}
          onLayoutWidth={setWinWidth}
          columns={columns}
        />
      )}
    </PaneShell>
  )
}

// ---------------------------------------------------------------- 下载管理 / 云端音乐

export const DownloadsPane = ({ topInset, onBack }: { topInset: number, onBack: () => void }) => (
  <PaneShell title="下载管理" topInset={topInset} onBack={onBack}>
    <NotSupported
      title="这个版本还没有下载功能"
      lines={[
        '洛雪安卓版底座里没有实现歌曲下载：没有下载队列、没有下载记录存储，',
        '播放链路里「已下载文件」的分支也是被注释掉的（下载列表被硬编码为空）。',
        '',
        '鸿蒙版的「下载管理」依赖它自己那套下载引擎，这次移植没有包含这部分能力。',
        '所以这里给明确说明，而不是显示一个永远为空的列表。',
      ]}
    />
  </PaneShell>
)

export const CloudPane = ({ topInset, onBack }: { topInset: number, onBack: () => void }) => (
  <PaneShell title="云端音乐" topInset={topInset} onBack={onBack}>
    <NotSupported
      title="这个版本还没有云端音乐"
      lines={[
        '云端音乐（WebDAV）在洛雪安卓版底座里完全没有实现：',
        '代码里没有任何 WebDAV 相关逻辑，依赖里也没有网盘 SDK。',
        '',
        '鸿蒙版的「云端音乐」是它自己接的 WebDAV 曲库，这次移植没有包含这部分能力。',
        '所以这里给明确说明，而不是显示一个永远为空的列表。',
      ]}
    />
  </PaneShell>
)
