/**
 * 推荐页（鸿蒙 `views/RecommendView.ets` 的 RN 版）
 *
 * 对应洛雪的「歌单页 + 排行榜页」合起来那块内容：
 *   顶部来源胶囊 + 排序下拉 → 在线榜单横滑卡片 → 推荐歌单列表。
 * 数据全部来自宿主内置的平台接口（`core/leaderboard` / `core/songlist`），不依赖导入的音源。
 *
 * 平板：歌单列表用 `playlistColumnsFor(windowWidth)` 一屏多列（ListHeader 通栏）。
 * 手机也走宫格（4 列）—— 原先手机是 1 列、封面被拉成整屏宽的正方形，用户反馈「图标太大」。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native'
import { useTokens } from './useTokens'
import { CoverArt } from './CoverArt'
import { LxIcon } from './LxIcon'
import { Glass } from './Glass'
import { F_TITLE, F_SECTION, F_ITEM, F_SUB, R_CARD, R_COVER } from './tokens'
import { contentColumnsFor, playlistColumnsFor } from './Layout'
import { getBoardsList } from '@/core/leaderboard'
import { getList, getSortList } from '@/core/songlist'
import type { ListInfoItem } from '@/store/songlist/state'

/** 平台列表（与鸿蒙 LIST_PLATFORMS 同序） */
const PLATFORMS: LX.OnlineSource[] = ['kw', 'kg', 'mg', 'tx', 'wy']

/** 平台显示名（与鸿蒙 platformName 一致） */
const PLATFORM_NAMES: Record<string, string> = {
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
  tx: 'QQ',
  wy: '网易云',
}

/** 列表底部留白（模块级常量：内联字面量每次 render 都是新对象，会让 FlatList 白重渲染一轮） */
const LIST_CONTENT_PAD = { paddingBottom: 24 }

/** 榜单卡片配色（按榜单顺序循环取，同榜每次进入颜色不变） */
const BOARD_COLORS: string[][] = [
  ['#7B6CF6', '#4E3FD6'],
  ['#3FD07A', '#17A94F'],
  ['#FF7A59', '#E2432F'],
  ['#4FA8FF', '#1E6FD9'],
  ['#FFB13D', '#E0810F'],
  ['#F26DB4', '#C22C86'],
]

const boardColors = (index: number): string[] => BOARD_COLORS[index % BOARD_COLORS.length]

interface BoardItem {
  id: string
  name: string
  bangid: string
}

interface RecommendPageProps {
  /** 状态栏高度：标题栏是沉浸式的，内容要让出这一段 */
  topInset: number
  onOpenSearch: () => void
  onNavigate: (action: string) => void
}

export const RecommendPage = ({ topInset, onOpenSearch, onNavigate }: RecommendPageProps) => {
  const t = useTokens()
  const [winWidth, setWinWidth] = useState(0)
  const [platform, setPlatform] = useState<LX.OnlineSource>('kw')
  const [boards, setBoards] = useState<BoardItem[]>([])
  const [sorts, setSorts] = useState<Array<{ name: string, id: string }>>([])
  const [sortIndex, setSortIndex] = useState(0)
  const [playlists, setPlaylists] = useState<ListInfoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [noMore, setNoMore] = useState(false)
  const [error, setError] = useState('')
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [sortPickerOpen, setSortPickerOpen] = useState(false)
  const pageRef = useRef(0)

  /**
   * 榜单卡片用的「宽屏 / 窄屏」口径（只决定卡片宽 216 还是 180）
   *
   * ⚠️ 不要拿它当歌单宫格的列数 —— 它按「一行 360dp」算，手机上是 1 列。
   * 歌单宫格用下面的 `playlistColumns`。
   */
  const columns = contentColumnsFor(winWidth)

  /**
   * 推荐歌单宫格的列数
   *
   * 手机固定 4 列（用户反馈「图标太大，一排四个比较好」），宽屏 4~5 列。
   * 与 `columns` 是两个口径，见 `Layout.ts` 的 `playlistColumnsFor`。
   */
  const playlistColumns = playlistColumnsFor(winWidth)

  /**
   * 歌单封面边长（宫格卡片）
   *
   * 一行可用宽 = 窗口宽 − 宫格左右外边距，再扣掉卡片自己的左右内边距，就是封面边长。
   * `aspectRatio: 1` 让封面是正方形。
   * （宫格列数下限是 4，实际走的都是多列那条；单列分支留着以防口径改回 1 列。）
   */
  const cardSize = useMemo(() => {
    if (winWidth <= 0) return 80
    const grid = playlistColumns > 1
    const outerPad = grid ? 20 : 32 // 宫格 columnWrapper 10×2 / 单列页边距 16×2
    const cardPad = grid ? 12 : 32 // 卡片自身 paddingHorizontal 6×2 / 16×2
    return Math.max(56, Math.floor((winWidth - outerPad) / playlistColumns) - cardPad)
  }, [winWidth, playlistColumns])

  // ---------------- 取数 ----------------

  const reload = useCallback(async (source: LX.OnlineSource, sid: string) => {
    setError('')
    setLoading(true)
    try {
      // 榜单是同步的（内置表），先出
      setBoards(await getBoardsList(source))
    } catch (e) {
      // 榜单失败不阻塞歌单
      setBoards([])
    }
    try {
      const info = await getList(source, '', sid, 1)
      setPlaylists(info.list)
      pageRef.current = 1
      setNoMore(info.list.length === 0)
    } catch (e) {
      setError((e as Error).message)
      setPlaylists([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || noMore || error.length > 0) return
    setLoadingMore(true)
    try {
      const info = await getList(platform, '', sorts[sortIndex]?.id ?? '', pageRef.current + 1)
      if (info.list.length === 0) {
        setNoMore(true)
        return
      }
      setPlaylists(prev => prev.concat(info.list))
      pageRef.current += 1
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }, [loading, loadingMore, noMore, error, platform, sorts, sortIndex])

  // 首次进入 + 换平台
  useEffect(() => {
    const list = getSortList(platform) ?? []
    setSorts(list as Array<{ name: string, id: string }>)
    setSortIndex(0)
    setPlaylists([])
    pageRef.current = 0
    setNoMore(false)
    void reload(platform, (list as Array<{ id: string }>)[0]?.id ?? '')
  }, [platform, reload])

  const switchSort = (index: number) => {
    if (index === sortIndex) return
    setSortIndex(index)
    setPlaylists([])
    pageRef.current = 0
    setNoMore(false)
    void reload(platform, sorts[index]?.id ?? '')
  }

  const onRefresh = () => {
    setRefreshing(true)
    void reload(platform, sorts[sortIndex]?.id ?? '')
  }

  // ---------------- 头部（榜单 + 推荐歌单标题） ----------------

  const listHeader = (
    <View>
      {/* 在线榜单 */}
      {boards.length > 0 && (
        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 8,
              paddingBottom: 12,
            }}
          >
            <Text style={{ fontSize: F_SECTION, fontWeight: '700', color: t.text }}>在线榜单</Text>
            <Text
              style={{
                fontSize: 12,
                color: t.red,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 9,
                backgroundColor: t.redTint,
                overflow: 'hidden',
              }}
            >
              {PLATFORM_NAMES[platform]}
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingLeft: 16, paddingRight: 16, gap: 12 }}
            style={{ height: 212 }}
          >
            {boards.map((board, index) => (
              <RankCard
                key={board.id}
                title={board.name}
                subtitle="在线排行榜"
                platform={PLATFORM_NAMES[platform]}
                colors={boardColors(index)}
                width={columns > 1 ? 216 : 180}
                onTap={() => { onNavigate(`board:${board.id}`) }}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* 推荐歌单标题行 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: boards.length > 0 ? 22 : 4,
          paddingBottom: 10,
        }}
      >
        <Text style={{ fontSize: F_SECTION, fontWeight: '700', color: t.text }}>推荐歌单</Text>
        <View style={{ flex: 1 }} />
        {loadingMore && <Text style={{ fontSize: 12, color: t.textWeak }}>加载中…</Text>}
        {sorts.length > 1 && (
          <TouchableOpacity onPress={() => { setSortPickerOpen(v => !v) }} activeOpacity={0.6}>
            <Glass
              radius={15}
              style={{
                height: 30,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingLeft: 12,
                paddingRight: 8,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '500', color: t.red }}>
                {sorts[sortIndex]?.name ?? ''}
              </Text>
              <LxIcon name="chevronDown" size={13} color={t.red} />
            </Glass>
          </TouchableOpacity>
        )}
      </View>

      {/* 排序下拉（自绘胶囊 + 展开列表） */}
      {sortPickerOpen && sorts.length > 1 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <Glass radius={R_CARD} level="regular" style={{ paddingVertical: 4 }}>
            {sorts.map((s, i) => (
              <TouchableOpacity
                key={s.id}
                style={{ paddingHorizontal: 14, paddingVertical: 10 }}
                onPress={() => { switchSort(i); setSortPickerOpen(false) }}
                activeOpacity={0.6}
              >
                <Text style={{ fontSize: 14, color: i === sortIndex ? t.red : t.text }}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </Glass>
        </View>
      )}
    </View>
  )

  const listFooter = (
    <View style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 16, paddingBottom: 16 }}>
      {playlists.length === 0 && loading ? (
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 24, paddingBottom: 14 }}>
          <ActivityIndicator color={t.textSub} />
          <Text style={{ fontSize: 14.5, color: t.textSub }}>
            正在加载{PLATFORM_NAMES[platform]}的推荐…
          </Text>
        </View>
      ) : playlists.length === 0 && error.length > 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 24, paddingBottom: 14 }}>
          <Text style={{ fontSize: 13.5, color: t.textSub, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity
            onPress={onRefresh}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 8,
              borderRadius: 18,
              backgroundColor: t.redTint,
            }}
            activeOpacity={0.6}
          >
            <Text style={{ fontSize: 14, fontWeight: '500', color: t.red }}>点击重试</Text>
          </TouchableOpacity>
        </View>
      ) : playlists.length === 0 ? (
        <Text style={{ fontSize: 14.5, color: t.textSub, textAlign: 'center', paddingTop: 24 }}>
          这个来源暂时没有推荐内容
        </Text>
      ) : (
        <Text style={{ fontSize: 13, color: t.textWeak, textAlign: 'center' }}>
          {error.length > 0 ? error : loadingMore ? '正在加载更多…' : noMore ? '没有更多了' : '上拉加载更多'}
        </Text>
      )}
    </View>
  )

  // 列表相关的回调/样式都稳定住：否则每次父组件重渲染都会给 FlatList 一个
  // 新的 renderItem，它会认为「渲染方式变了」而把可见卡片整批重渲染
  const handleOpenPlaylist = useCallback(
    (source: string, id: string) => { onNavigate(`playlist:${source}:${id}`) },
    [onNavigate],
  )
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListInfoItem>) => (
      <PlaylistRow item={item} onOpen={handleOpenPlaylist} columns={playlistColumns} cardSize={cardSize} />
    ),
    [handleOpenPlaylist, playlistColumns, cardSize],
  )
  // 歌单 id 在同一个来源里唯一；退路才用下标
  const keyExtractor = useCallback((item: ListInfoItem, i: number) => item.id || `i-${i}`, [])
  /**
   * 宫格左右外边距 10 + 卡片自己的左右内边距 6 = 16，
   * 正好和上方「推荐歌单」标题行的 paddingLeft/Right 16 对齐。
   */
  const columnWrapperStyle = useMemo(
    () => (playlistColumns > 1 ? { paddingHorizontal: 10 } : undefined),
    [playlistColumns],
  )
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => { setWinWidth(e.nativeEvent.layout.width) },
    [],
  )

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 透明标题栏：大标题 + 来源胶囊 + 搜索钮（顶部让出状态栏） */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: topInset + 8,
          paddingBottom: 8,
        }}
      >
        <Text style={{ fontSize: F_TITLE, fontWeight: '700', color: t.text }}>推荐</Text>
        <View style={{ flex: 1 }} />

        {/* 来源下拉胶囊 */}
        <TouchableOpacity onPress={() => { setSourcePickerOpen(v => !v) }} activeOpacity={0.6}>
          <Glass
            radius={18}
            style={{
              height: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              paddingLeft: 14,
              paddingRight: 10,
            }}
          >
            <Text style={{ fontSize: 14.5, fontWeight: '500', color: t.text }}>
              {PLATFORM_NAMES[platform]}
            </Text>
            <LxIcon name="chevronDown" size={14} color={t.textSub} />
          </Glass>
        </TouchableOpacity>

        {/* 搜索钮 */}
        <TouchableOpacity onPress={onOpenSearch} activeOpacity={0.6}>
          <Glass radius={20} style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}>
            <LxIcon name="search" size={21} color={t.text} />
          </Glass>
        </TouchableOpacity>
      </View>

      {/* 来源选择浮层 */}
      {sourcePickerOpen && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <Glass radius={R_CARD} level="regular" style={{ paddingVertical: 4 }}>
            {PLATFORMS.map(p => (
              <TouchableOpacity
                key={p}
                style={{ paddingHorizontal: 14, paddingVertical: 10 }}
                onPress={() => { setPlatform(p); setSourcePickerOpen(false) }}
                activeOpacity={0.6}
              >
                <Text style={{ fontSize: 14, color: p === platform ? t.red : t.text }}>
                  {PLATFORM_NAMES[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </Glass>
        </View>
      )}

      {/* 列表（平板一屏多列，头部通栏） */}
      <FlatList
        key={`cols-${playlistColumns}`}
        data={playlists}
        numColumns={playlistColumns}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        columnWrapperStyle={columnWrapperStyle}
        renderItem={renderItem}
        onEndReached={() => { void loadMore() }}
        onEndReachedThreshold={0.3}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        // 底部留白：换成贴底 TabBar 后内容区不再被栏盖住，只留一小段呼吸空间
        contentContainerStyle={LIST_CONTENT_PAD}
        onLayout={handleLayout}
        // 虚拟化：默认 windowSize 21 = 一次留住 21 屏的行，这个列表会一直分页加长
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
      />
    </View>
  )
}

// ---------------------------------------------------------------- 榜单卡片

const RankCard = ({
  title,
  subtitle,
  platform,
  colors,
  width,
  onTap,
}: {
  title: string
  subtitle: string
  platform: string
  colors: string[]
  width: number
  onTap: () => void
}) => {
  return (
    <TouchableOpacity onPress={onTap} activeOpacity={0.85}>
      <View
        style={{
          width,
          height: 212,
          borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: colors[1],
        }}
      >
        {/* 主渐变（用两段纯色近似角度渐变：上半 colorA、下半 colorB） */}
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors[0] }} />
          <View style={{ flex: 1, backgroundColor: colors[1] }} />
        </View>

        {/* 底部压暗层 */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '58%',
            backgroundColor: '#00000040',
          }}
        />

        {/* 左上角标 */}
        <View
          style={{ position: 'absolute', left: 13, top: 13, flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <View
            style={{
              width: 17,
              height: 17,
              borderRadius: 8.5,
              backgroundColor: '#FFFFFF',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <LxIcon name="mic" size={11} color="#E2432F" />
          </View>
          <Text style={{ fontSize: 11.5, color: '#FFFFFFE6' }}>{platform}</Text>
        </View>

        {/* 中央大标题 */}
        <View style={{ position: 'absolute', left: 13, right: 13, top: 0, bottom: 80, justifyContent: 'center' }}>
          <Text
            style={{
              fontSize: 34,
              fontWeight: '700',
              color: '#FFFFFF',
              textShadowColor: '#00000033',
              textShadowRadius: 12,
              textShadowOffset: { width: 0, height: 3 },
            }}
          >
            {title}
          </Text>
        </View>

        {/* 底部信息条 */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 80,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 13,
            paddingRight: 13,
          }}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>
              {title}
            </Text>
            <Text style={{ fontSize: 11.5, color: '#FFFFFFB3' }}>{subtitle}</Text>
          </View>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: '#FFFFFF',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <LxIcon name="play" size={19} color="#1A1A1A" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ---------------------------------------------------------------- 歌单行

/** CoverArt 铺满父容器用的样式。**必须是模块级常量** —— 写成内联字面量的话，
 *  `memo(CoverArt)` 的浅比较每次都判定 style 变了，等于没 memo。 */
const FILL = { width: '100%', height: '100%' } as const

/**
 * 推荐歌单的一行（QQ 式竖排卡片）
 *
 * 回调改成 `onOpen(source, id)` 由行自己拼 —— 父组件只要给一个**稳定**的
 * `useCallback`，`renderItem` 就不必为每行新建闭包，`memo` 也才能真正拦住重渲染。
 */
const PlaylistRow = memo(({
  item,
  onOpen,
  columns,
  cardSize,
}: {
  item: ListInfoItem
  onOpen: (source: string, id: string) => void
  /** 当前列表的列数（1 = 单列铺满；> 1 = 按列数等分） */
  columns: number
  /** 封面边长（由父组件按窗口宽度与列数算好） */
  cardSize: number
}) => {
  const t = useTokens()
  /**
   * 宫格（多列）时字号要小一号
   *
   * 手机上 4 列、一格只有 ~90dp 宽；沿用单列那套 15sp / 行高 21 的话，
   * 两行标题就占掉封面一半的高度。
   */
  const compact = columns > 1

  // meta = [作者, 播放量, `${total} 首`] 用 ' · ' 连接（有谁显示谁）
  const meta = useMemo(
    () => [item.author, item.play_count, item.total ? `${item.total} 首` : ''].filter(Boolean).join(' · '),
    [item],
  )
  const handlePress = useCallback(() => { onOpen(item.source, item.id) }, [onOpen, item.source, item.id])

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      // 单列铺满；多列用 flex 等分（**不能写死 50%** —— 3/4 列时会短一截，右侧留空）
      style={compact ? { flex: 1 } : { width: '100%' }}
    >
      {/* **QQ 音乐式竖排卡片**：封面在上（近正方形、圆角很小），
          下面两行文字（歌名 + 播放量）。
          原先这里是「左封面 58 + 右两行 + 右箭头」的横向行 —— 那是鸿蒙列表的排法；
          QQ 音乐 2024 改版明确「加大宫格、一屏内容更少、让封面成为主角」，
          所以改成封面占大头的竖排卡片，并去掉行尾箭头（卡片本身可点，不需要提示）。 */}
      <View style={{ paddingHorizontal: compact ? 6 : 16, paddingBottom: compact ? 14 : 16 }}>
        <View style={{ width: '100%', aspectRatio: 1 }}>
          <CoverArt
            url={item.img}
            name={item.name}
            size={cardSize}
            radius={R_COVER}
            style={FILL}
          />
        </View>
        <Text
          numberOfLines={2}
          style={{
            fontSize: compact ? 13 : F_ITEM - 1,
            color: t.text,
            marginTop: compact ? 6 : 8,
            lineHeight: compact ? 17 : 21,
          }}
        >
          {item.name}
        </Text>
        {/* 播放量用弱文字：QQ 音乐把辅助标签从绿减弱为灰黑，避免抢封面的视觉 */}
        <Text
          numberOfLines={1}
          style={{ fontSize: compact ? 11 : F_SUB, color: t.textWeak, marginTop: compact ? 3 : 4 }}
        >
          {meta}
        </Text>
      </View>
    </TouchableOpacity>
  )
})
