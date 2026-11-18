/**
 * 在线详情页（鸿蒙 `views/OnlineListView.ets` 的 RN 版）
 *
 * 榜单与歌单详情在鸿蒙侧**是同一个组件**，只用 `kind` 区分取数接口与
 * 几个按钮的显隐（规格 2.6）：
 *   - `kind === 'board'`：没有「收藏歌单」钮（榜单不能收藏）
 *   - `kind === 'playlist'`：多一颗「收藏歌单」钮
 *
 * 为什么要做这一页：早先推荐页的榜单卡片与推荐歌单点了没反应 ——
 * 壳层里 `board:` / `playlist:` 被显式忽略（当时的注释写「详情类页面本次未接入」），
 * 于是「点不动」。这一页就是把那条路接通。
 *
 * 数据全部走宿主内置接口（`core/leaderboard` / `core/songlist`），与音源无关；
 * 播放与收藏复用底座现成的 `listAction`（它内部会 `setTempList` + `playList`）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native'
import { useTokens } from './useTokens'
import { CoverArt } from './CoverArt'
import { LxIcon } from './LxIcon'
import { SongRow, RowDivider } from './SongRow'
import { F_ITEM, F_SUB, R_CARD, platformColor, platformTint } from './tokens'
import { contentColumnsFor } from './Layout'
import { getListDetail as getBoardDetail, getBoardsList } from '@/core/leaderboard'
import { getListDetail as getPlaylistDetail } from '@/core/songlist'
import { handlePlay as playBoard, handleCollect as collectBoard } from '@/screens/Home/Views/Leaderboard/listAction'
import { handlePlay as playPlaylist, handleCollect as collectPlaylist } from '@/screens/SonglistDetail/listAction'
import playerState from '@/store/player/state'

/** 平台显示名（与推荐页同一套） */
const PLATFORM_NAMES: Record<string, string> = {
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
  tx: 'QQ',
  wy: '网易云',
}

/** 一页 30 首，与宿主 LIST_LOAD_LIMIT 一致 */
const PAGE_LIMIT = 30

interface OnlineDetailPageProps {
  /** `board` = 在线榜单；`playlist` = 在线歌单 */
  kind: 'board' | 'playlist'
  /** 榜单是 `{source}__{bangId}`；歌单是歌单 id */
  id: string
  /** 歌单来源（榜单从 id 前缀里取） */
  source?: LX.OnlineSource
  /** 标题（进页时先用推荐页已知的名字，取到详情后覆盖） */
  title?: string
  topInset: number
  onBack: () => void
}

/**
 * 详情页的行外壳（多列时按列等分，单列铺满）
 *
 * 与 `Panes.tsx` 的 `SongRowItem` 同样做法：抽成 `memo`，回调由行自己带 index 去调。
 * 这样才能让 `renderItem` 稳定下来 —— 否则父组件每次重渲染（`loadingMore`、`error`、
 * `winWidth` 这些与行无关的状态一变）都会生成新的渲染函数，`FlatList` 便认为
 * 「渲染方式变了」，把可见行整批重渲染一遍。
 */
const DetailRow = memo(({
  name,
  singer,
  pic,
  index,
  columns,
  isCurrent,
  onPressSong,
}: {
  name: string
  singer: string
  pic?: string
  index: number
  columns: number
  isCurrent: boolean
  onPressSong: (index: number) => void
}) => {
  const handlePress = useCallback(() => { onPressSong(index) }, [onPressSong, index])
  return (
    <View style={columns > 1 ? { flex: 1 / columns } : undefined}>
      <SongRow
        name={name}
        singer={singer}
        pic={pic}
        isCurrent={isCurrent}
        onPress={handlePress}
      />
      <RowDivider inset={78} />
    </View>
  )
})

export const OnlineDetailPage = ({
  kind,
  id,
  source: sourceProp,
  title: titleProp,
  topInset,
  onBack,
}: OnlineDetailPageProps) => {
  const t = useTokens()

  // 榜单 id 形如 `kw__16`，来源就在前缀里
  const source = (kind === 'board' ? id.split('__')[0] : sourceProp) as LX.OnlineSource

  const [title, setTitle] = useState(titleProp ?? '')
  const [desc, setDesc] = useState('')
  const [img, setImg] = useState<string | undefined>(undefined)
  const [author, setAuthor] = useState('')
  const [playCount, setPlayCount] = useState('')
  const [songs, setSongs] = useState<LX.Music.MusicInfoOnline[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [winWidth, setWinWidth] = useState(0)
  const [collected, setCollected] = useState(false)

  const pageRef = useRef(0)
  /** 防止卸载后 setState */
  const aliveRef = useRef(true)

  const columns = contentColumnsFor(winWidth)

  const loadPage = useCallback(
    (page: number) =>
      kind === 'board'
        ? getBoardDetail(id, page)
        : getPlaylistDetail(id, source, page),
    [kind, id, source],
  )

  /** 首屏：拉第 1 页 + 头部信息 */
  useEffect(() => {
    aliveRef.current = true
    setLoading(true)
    setError('')
    setSongs([])
    pageRef.current = 0

    // 头部信息：榜单名从内置榜单表里取；歌单信息在详情返回里
    if (kind === 'board') {
      void getBoardsList(source)
        .then(list => {
          const board = list.find(b => b.id === id)
          if (board && aliveRef.current) setTitle(prev => prev || board.name)
        })
        .catch(() => { /* 榜单名取不到不影响列表 */ })
    }

    loadPage(1)
      .then(result => {
        if (!aliveRef.current) return
        setSongs(result.list)
        setTotal(result.total)
        pageRef.current = 1
        // 歌单详情会带 info（名称/简介/封面/播放量）
        const info = (result as unknown as { info?: {
          name?: string
          desc?: string
          img?: string
          author?: string
          play_count?: string
        } }).info
        if (info) {
          if (info.name) setTitle(info.name)
          if (info.desc) setDesc(info.desc)
          if (info.img) setImg(info.img)
          if (info.author) setAuthor(info.author)
          if (info.play_count) setPlayCount(info.play_count)
        }
      })
      .catch((e: Error) => {
        if (aliveRef.current) setError(e.message || '加载失败')
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false)
      })

    return () => { aliveRef.current = false }
  }, [kind, id, source, loadPage])

  /** 上拉加载更多 */
  const loadMore = useCallback(() => {
    if (loading || loadingMore || error) return
    if (songs.length === 0 || songs.length >= total) return
    setLoadingMore(true)
    const next = pageRef.current + 1
    loadPage(next)
      .then(result => {
        if (!aliveRef.current) return
        setSongs(prev => {
          // 去重（宿主分页偶尔会重叠）
          const seen = new Set(prev.map(m => m.id))
          return [...prev, ...result.list.filter(m => !seen.has(m.id))]
        })
        pageRef.current = next
      })
      .catch(() => { /* 加载更多失败不覆盖已有内容 */ })
      .finally(() => {
        if (aliveRef.current) setLoadingMore(false)
      })
  }, [loading, loadingMore, error, songs.length, total, loadPage])

  const handlePlayFrom = useCallback((index: number) => {
    if (kind === 'board') void playBoard(id, songs, index)
    else void playPlaylist(id, source, songs, index)
  }, [kind, id, source, songs])

  const handleCollect = useCallback(() => {
    const listId = kind === 'board' ? `board__${id}` : `${source}__${id}`
    if (kind === 'board') void collectBoard(id, title, source)
    else void collectPlaylist(id, source, title)
    // 收藏是异步的，先乐观置位；真正的状态由「我的 - 自建歌单」体现
    setCollected(true)
    void listId
  }, [kind, id, source, title])

  const currentId = playerState.playMusicInfo.musicInfo?.id

  const header = (
    <View>
      {/* 头部（规格 2.6 的居中版式） */}
      <View style={{ alignItems: 'center', paddingLeft: 20, paddingRight: 20, paddingTop: 18, paddingBottom: 14, gap: 12 }}>
        <CoverArt url={img} name={title} size={132} radius={24} />
        <Text numberOfLines={2} style={{ fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center' }}>
          {title || (loading ? '加载中…' : '')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text
            style={{
              fontSize: 12,
              color: platformColor(t, source),
              backgroundColor: platformTint(t, source),
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 3,
              paddingBottom: 3,
              borderRadius: 9,
              overflow: 'hidden',
            }}
          >
            {PLATFORM_NAMES[source] ?? source}
          </Text>
          {!!author && (
            <Text numberOfLines={1} style={{ fontSize: F_SUB, color: t.textSub }}>{author}</Text>
          )}
          {!!playCount && (
            <Text style={{ fontSize: F_SUB, color: t.textWeak }}>· {playCount}</Text>
          )}
        </View>
        {!!desc && (
          <Text numberOfLines={3} style={{ fontSize: 12.5, color: t.textWeak, paddingHorizontal: 4 }}>
            {desc}
          </Text>
        )}
      </View>

      {/* 动作行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 16, paddingBottom: 8 }}>
        <TouchableOpacity
          style={{
            flex: 1,
            height: 46,
            borderRadius: 23,
            backgroundColor: t.red,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
          onPress={() => { handlePlayFrom(0) }}
          activeOpacity={0.85}
          disabled={songs.length === 0}
        >
          <LxIcon name="playCircle" size={22} color="#FFFFFF" />
          <Text style={{ fontSize: 15, fontWeight: '500', color: '#FFFFFF' }}>播放全部</Text>
          {songs.length > 0 && (
            <Text style={{ fontSize: 12.5, color: '#FFFFFFD9' }}>{songs.length}</Text>
          )}
        </TouchableOpacity>

        {kind === 'playlist' && (
          <TouchableOpacity
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 46,
              paddingLeft: 16,
              paddingRight: 16,
              borderRadius: 23,
              backgroundColor: t.redTint,
            }}
            onPress={handleCollect}
            activeOpacity={0.7}
            disabled={collected}
          >
            <LxIcon name={collected ? 'heartFill' : 'heart'} size={20} color={t.red} />
            <Text style={{ fontSize: 15, color: t.red }}>{collected ? '已收藏' : '收藏歌单'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 分隔 */}
      <View style={{ height: 0.6, backgroundColor: t.divider, marginLeft: 16, marginRight: 16 }} />
    </View>
  )

  const footer = (
    <View style={{ width: '100%' }}>
      {loading && songs.length === 0 && (
        <View style={{ alignItems: 'center', paddingTop: 40, paddingBottom: 20 }}>
          <ActivityIndicator color={t.red} />
          <Text style={{ fontSize: 15, color: t.textSub, marginTop: 10 }}>正在加载…</Text>
        </View>
      )}
      {!loading && error.length > 0 && songs.length === 0 && (
        <View style={{ alignItems: 'center', paddingLeft: 32, paddingRight: 32, paddingTop: 50, paddingBottom: 20, gap: 10 }}>
          <Text style={{ fontSize: 14, color: t.textSub, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity
            style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 8, paddingBottom: 8, borderRadius: 18, backgroundColor: t.redTint }}
            onPress={() => { /* 重试：重新挂载即可，这里给个明确的动作 */ }}
          >
            <Text style={{ fontSize: 14, fontWeight: '500', color: t.red }}>点击重试</Text>
          </TouchableOpacity>
        </View>
      )}
      {!loading && !error && songs.length === 0 && (
        <Text style={{ fontSize: 15, color: t.textSub, textAlign: 'center', paddingTop: 50, paddingBottom: 20 }}>
          列表里还没有歌曲
        </Text>
      )}
      {loadingMore && (
        <Text style={{ fontSize: 13, color: t.textWeak, textAlign: 'center', paddingTop: 14, paddingBottom: 14 }}>
          正在加载更多…
        </Text>
      )}
      {!loadingMore && songs.length > 0 && songs.length >= total && total > 0 && (
        <Text style={{ fontSize: 12.5, color: t.textWeak, textAlign: 'center', paddingTop: 14, paddingBottom: 14 }}>
          共 {songs.length} 首
        </Text>
      )}
      {/* 底部让位：悬浮栏（离底 16 + 高 56）+ 一段余量 */}
      <View style={{ height: 130 }} />
    </View>
  )

  // 这三个都用 useCallback/useMemo 稳定住：FlatList 只在它们真的变了才重建行
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LX.Music.MusicInfoOnline>) => (
      <DetailRow
        name={item.name}
        singer={item.singer}
        pic={item.meta?.picUrl ?? undefined}
        index={index}
        columns={columns}
        isCurrent={currentId === item.id}
        onPressSong={handlePlayFrom}
      />
    ),
    [columns, currentId, handlePlayFrom],
  )
  const keyExtractor = useCallback(
    (item: LX.Music.MusicInfoOnline, i: number) => item.id || `i-${i}`,
    [],
  )
  const columnWrapperStyle = useMemo(
    () => (columns > 1 ? { paddingHorizontal: 8 } : undefined),
    [columns],
  )
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => { setWinWidth(e.nativeEvent.layout.width) },
    [],
  )

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 返回栏（沉浸式：自己让出状态栏） */}
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
          {kind === 'board' ? '在线榜单' : '歌单详情'}
        </Text>
      </View>

      <FlatList
        key={`cols-${columns}`}
        data={songs}
        numColumns={columns}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        columnWrapperStyle={columnWrapperStyle}
        renderItem={renderItem}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        onLayout={handleLayout}
        // 虚拟化：默认 windowSize 21 = 一次留住 21 屏的行；滚动加载的列表会越滚越长，
        // 收到 11 已经足够覆盖快速滚动的余量，内存与挂载量都降下来
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={11}
      />
    </View>
  )
}
