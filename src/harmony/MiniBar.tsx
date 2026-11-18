/**
 * 迷你播放栏（鸿蒙 `views/MiniBar.ets` 的 RN 版）
 *
 * 折叠与展开画同一份内容，只有封面尺寸与留白不同：
 *   - 折叠：封面 56（正好填满那颗圆钮）
 *   - 展开：封面 44，右侧留给歌名与控制钮
 *
 * 封面三层叠加（照鸿蒙的 coverView）：淡圆底 + 真封面 + 外圈进度环；
 * 播放中叠一颗跳动符。**刻意不露黑底** —— 鸿蒙源码里记了原因：迷你栏在切页签时会被重建，
 * 网络封面重建期间会短暂什么都画不出来，露黑底就会「先黑一下再亮起来」。
 */
import { memo } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTokens } from '@/harmony/useTokens'
import { CoverArt } from '@/harmony/CoverArt'
import { LxIcon } from '@/harmony/LxIcon'
import { usePlayerMusicInfo, useIsPlay, useProgress } from '@/store/player/hook'
import { playNext, togglePlay } from '@/core/player/player'

/** 折叠态封面边长 */
export const COVER_COLLAPSED = 56
/** 展开态封面边长 */
export const COVER_EXPANDED = 44
/** 控制钮图标大小与间距 */
const CONTROL_SIZE = 24
const CONTROL_GAP = 16
/** 歌名 / 歌手字号与行高 */
const TITLE_SIZE = 12
const TITLE_LINE = 16
const SINGER_SIZE = 10
const SINGER_LINE = 13

/** 折叠态迷你栏内容与栏边的留白，按窗口宽度分档（与派音 BreakpointType(16,24,32,32) 一致） */
const sideInsetFor = (windowWidth: number): number => {
  if (windowWidth >= 840) return 32
  if (windowWidth >= 600) return 24
  return 16
}

const styles = StyleSheet.create({
  /** 封面底部那条细进度（绝对定位，宽度由比例算） */
  miniProgress: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
})

/**
 * 封面底部那条细进度 —— **整个迷你栏里唯一订阅播放进度的地方**
 *
 * 为什么单独拆出来：进度事件在播放中约 **1 秒一次**（见
 * `core/init/player/playProgress.ts` 的 `BackgroundTimer.setInterval`，
 * 间隔 = `1000 / playbackRate`）。早先 `MiniBar` 自己订阅，于是
 * **整条迷你栏（封面 + 歌名/歌手 + 三个控制钮）每秒重渲染一次**，
 * 而这里面真正每秒会变的只有这条 2px 的进度。
 *
 * 拆成叶子组件后（它自己也是 `memo`）：迷你栏主体只在
 * 「换歌 / 播放暂停 / 展开态 / 窗口宽度」变化时重渲染。
 *
 * 鸿蒙侧这是封面外圈的圆环（`Progress(Ring)`）；RN 没有内置环形进度，
 * 用底部一条细进度表达同一语义（不挡封面）。
 */
const MiniProgress = memo(({ width, color }: { width: number, color: string }) => {
  const progress = useProgress()
  const total = progress.maxPlayTime || 0
  if (total <= 0) return null
  const ratio = Math.max(0, Math.min(1, progress.nowPlayTime / total))
  return <View style={[styles.miniProgress, { width: width * ratio, backgroundColor: color }]} />
})

interface MiniBarProps {
  /** 是否展开（由壳层按窗口宽度与用户切换决定） */
  expanded: boolean
  /** 窗口宽度（dp） */
  windowWidth: number
  /** 点信息区 → 打开全屏播放器 */
  onOpenPlayer: () => void
  /** 点播放列表钮 → 打开播放列表 */
  onOpenQueue: () => void
  /**
   * 页内那条迷你栏（歌单详情这类不在页签体系里的页面）
   * 恒为展开态，且左右留白用 4（不是页签里那条的 6/16）
   */
  forceExpanded?: boolean
}

export const MiniBar = memo(({
  expanded,
  windowWidth,
  onOpenPlayer,
  onOpenQueue,
  forceExpanded = false,
}: MiniBarProps) => {
  const t = useTokens()
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()
  // ⚠️ 这里**故意不订阅 `useProgress()`** —— 进度一秒一变，订阅它会拖累整条栏，
  // 已下沉到下面的 `MiniProgress`（只重渲染那条 2px 进度）。

  const isExpanded = forceExpanded || expanded
  const coverSide = isExpanded ? COVER_EXPANDED : COVER_COLLAPSED

  const sideInset = forceExpanded ? 4 : (isExpanded ? 6 : sideInsetFor(windowWidth))
  const sideInsetEnd = forceExpanded ? 4 : (isExpanded ? 16 : sideInsetFor(windowWidth))

  const name = musicInfo?.name ?? ''
  const singer = musicInfo?.singer ?? ''
  const cover = musicInfo?.pic ?? ''

  const coverView = (
    <View style={{ width: coverSide, height: coverSide, justifyContent: 'center', alignItems: 'center' }}>
      <CoverArt url={cover} name={name} size={coverSide} radius={coverSide / 2} fallback="icon" />
      <MiniProgress width={coverSide} color={t.red} />
      {isPlay && (
        <View style={{ position: 'absolute' }}>
          <LxIcon name="rhythm" size={CONTROL_SIZE} color={t.text} />
        </View>
      )}
    </View>
  )

  const aside = (
    <>
      <TouchableOpacity
        style={{ flex: 1, justifyContent: 'center' }}
        onPress={onOpenPlayer}
        activeOpacity={0.6}
      >
        <Text
          numberOfLines={1}
          style={{ fontSize: TITLE_SIZE, lineHeight: TITLE_LINE, fontWeight: '700', color: t.text }}
        >
          {name}
        </Text>
        {singer.length > 0 && (
          <Text
            numberOfLines={1}
            style={{ fontSize: SINGER_SIZE, lineHeight: SINGER_LINE, color: t.textSub }}
          >
            {singer}
          </Text>
        )}
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: CONTROL_GAP }}>
        <TouchableOpacity onPress={togglePlay} activeOpacity={0.6}>
          <LxIcon name={isPlay ? 'pauseCircle' : 'playCircle'} size={CONTROL_SIZE} color={t.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { void playNext() }} activeOpacity={0.6}>
          <LxIcon name="next" size={CONTROL_SIZE} color={t.icon} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenQueue} activeOpacity={0.6}>
          <LxIcon name="queue" size={CONTROL_SIZE} color={t.icon} />
        </TouchableOpacity>
      </View>
    </>
  )

  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: sideInset,
        paddingRight: sideInsetEnd,
        paddingTop: 6,
        paddingBottom: 6,
      }}
    >
      {coverView}
      {/* 折叠态下右侧内容被父容器裁掉，视觉上就只剩那颗圆封面 */}
      {isExpanded && aside}
    </View>
  )
})

/** 迷你栏在「加载中」时该显示转圈（供外部判断用） */
export const MiniBarLoading = ({ color }: { color: string }) => (
  <ActivityIndicator size={CONTROL_SIZE} color={color} />
)
