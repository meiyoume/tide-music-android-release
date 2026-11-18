/**
 * 宽屏（平板 / 折叠屏）适配算法
 *
 * 逐行对应鸿蒙 `ui/Layout.ets`。**单位是 dp**（鸿蒙的 vp 与 RN 的 dp 1:1）。
 *
 * 断点口径与 HDS 底部悬浮页签栏一致：
 *   < 440        手机
 *   440 - 600    大屏手机 / 折叠屏折叠态
 *   >= 600       折叠屏展开态 / 平板（两条栏同时展开，恒为中心对齐）
 */

export const BP_COMPACT = 440
export const BP_MEDIUM = 600
export const BP_EXPANDED = 840

/** 页签数 >= 4 时单条栏的宽度上限（官方文档写死的值） */
const BAR_WIDTH_MAX = 328
/** 页签栏宽度下限：4 个页签每个 56vp */
const TAB_BAR_WIDTH_MIN = 224
/** 迷你栏展开态宽度下限 */
const MINI_BAR_WIDTH_MIN = 232
/** 迷你栏展开态拿窗口可用宽度的比例 */
const MINI_BAR_WIDTH_RATIO = 0.5
/** 迷你栏折叠态：一颗圆钮，宽度等于栏高 */
const MINI_BAR_COLLAPSED = 56
/**
 * 窄屏「图标态」页签栏每颗页签占的槽位
 *
 * 窄屏下迷你栏展开时，页签栏要收成**只有图标**的形态给迷你栏让位。
 * 每颗槽位必须放得下图标（22）+ 左右呼吸，48dp 是实测舒服的值。
 *
 * ⚠️ 这里**不能写死一个「折叠后总宽」**。鸿蒙源码里的 `96` 是
 * `smallWidth = windowWidth - 96`（页签栏与窗口左右边距之和），
 * 不是「折叠后栏宽」—— 早先把 96 当成总宽，3 个图标挤在 96dp 里（每颗 32dp），
 * 截图里图标明显挤在一起。正确做法是按**页签数 × 槽位**算。
 */
const TAB_SLOT_ICON = 48
/** 图标态槽位的下限（再窄就放不下图标了） */
const TAB_SLOT_ICON_MIN = 40
/**
 * 窄屏展开迷你栏时，迷你栏的可用下限
 *
 * 展开态要放下：圆封面 44 + 歌名/歌手 + 三个 24dp 控制钮（间距 16）。
 * 低于这个宽度歌名就没法看了，宁可让页签栏再收一点。
 */
const MINI_BAR_NARROW_MIN = 200
/** 两条栏之间的缝 */
const BAR_GAP = 8

/** 详情页 / 设置页里表单类内容的最大宽度 */
export const CONTENT_MAX_WIDTH = 720
/** 宽屏下一行内容至少多宽 */
export const HOME_ROW_MIN_WIDTH = 360
/** 最多列数 */
export const HOME_COLUMNS_MAX = 4
/** 并排的一张卡至少要多宽 */
const CARD_MIN_WIDTH = 460

/** 推荐歌单宫格一列至少多宽（卡片只有「封面 + 两行标题」，比列表行的 360 小得多） */
const PLAYLIST_COL_MIN_WIDTH = 150
/** 推荐歌单宫格列数下限 —— 手机就是这个值 */
const PLAYLIST_COLUMNS_MIN = 4
/** 推荐歌单宫格列数上限 */
const PLAYLIST_COLUMNS_MAX = 5

const clamp = (v: number, min: number, max: number): number => {
  if (v < min) return min
  return v > max ? max : v
}

/** 页签栏 / 迷你栏与窗口左右边的距离：窗口越宽留得越多 */
export function barSideMarginFor(windowWidth: number): number {
  if (windowWidth >= BP_EXPANDED) return 24
  if (windowWidth >= BP_MEDIUM) return 16
  return 12
}

/** 窗口宽度是否算「宽屏」（宽屏下迷你栏恒为展开态） */
export function isWideWindow(windowWidth: number): boolean {
  return windowWidth >= BP_MEDIUM
}

/**
 * 宽屏下一屏放几列（列表页共用）
 *
 * 列数 = 能放内容的宽度 / HOME_ROW_MIN_WIDTH，最少 1 列、最多 HOME_COLUMNS_MAX 列。
 * 窗口宽度 0（还没量到）或窄屏一律 1 列。
 */
export function contentColumnsFor(windowWidth: number): number {
  // 页面自己左右各留 16 的内边距
  const avail = windowWidth - 32
  if (windowWidth < BP_MEDIUM || avail <= 0) return 1
  let columns = Math.floor(avail / HOME_ROW_MIN_WIDTH)
  if (columns < 1) columns = 1
  return columns > HOME_COLUMNS_MAX ? HOME_COLUMNS_MAX : columns
}

/**
 * 推荐歌单宫格一屏几列
 *
 * ⚠️ 与 `contentColumnsFor` **是两个口径**，不能共用：
 * 列表一行要放下「封面 + 歌名 + 歌手 + 时长」，360dp 才够，所以手机上 `contentColumnsFor`
 * 只给 1 列；而歌单卡片只有「封面 + 两行标题 + 一行播放量」，一格 ~90dp 就能看清。
 * 早先歌单宫格错用了 `contentColumnsFor`，手机上得到 1 列 ⇒ 封面被拉成整屏宽的正方形，
 * 用户反馈「推荐歌单图标太大，改成一排四个比较好」。
 *
 * 手机固定 4 列（下限），宽屏按可用宽度算、最多 5 列。
 */
export function playlistColumnsFor(windowWidth: number): number {
  if (windowWidth <= 0) return PLAYLIST_COLUMNS_MIN
  return clamp(
    Math.floor((windowWidth - 32) / PLAYLIST_COL_MIN_WIDTH),
    PLAYLIST_COLUMNS_MIN,
    PLAYLIST_COLUMNS_MAX,
  )
}

/**
 * 设置类页面宽屏下并排几张卡（1 或 2）
 *
 * 与列表页的 contentColumnsFor 是两个口径：列表一行 360 就够，卡片门槛更高。
 * 精确阈值：windowWidth - 32 >= 460*2 + 14 = 934  =>  windowWidth >= 966
 */
export function cardColumnsFor(windowWidth: number): number {
  const avail = windowWidth - 32
  if (windowWidth < BP_MEDIUM || avail < CARD_MIN_WIDTH * 2 + 14) return 1
  return 2
}

/** 并排时每张卡的宽度：宽屏 48%（留 4% 给列间距），窄屏铺满 */
export function cardWidthOf(windowWidth: number): `${number}%` {
  return cardColumnsFor(windowWidth) > 1 ? '48%' : '100%'
}

/** 「不限宽」的占位值（constraintSize maxWidth 必须给一个数） */
export const LAYOUT_UNBOUNDED = 100000

export interface BarMetrics {
  /** 栏与窗口左右边的距离 */
  sideMargin: number
  /** 页签栏宽度 */
  tabBarWidth: number
  /** 迷你栏宽度（展开态；折叠态由圆钮自己定） */
  miniBarWidth: number
}

/**
 * 窄屏（< 600dp）下迷你栏是否允许处于展开态
 *
 * 鸿蒙侧这条约束由 HDS 框架自己保证：`miniBarStyle` 只在 HdsTabs 宽度 < 600vp 时生效，
 * 且窄屏下迷你栏展开时**页签栏会自动折叠**（官方文档「迷你栏和页签栏处于左右布局场景」），
 * 所以两条栏永远不会同时占满宽度。
 *
 * RN 侧没有这层框架，必须自己守：窄屏 + 迷你栏展开 = 页签栏折叠成图标条。
 * 不守的话 `barMetricsFor` 在 320–480dp 上会算出 tab=224 + mini=232 + 8 = 464 > 可用宽度，
 * 两条栏直接叠在一起（这正是鸿蒙源码注释里警告的那个 bug）。
 */
export function shouldCollapseTabBar(windowWidth: number, miniExpanded: boolean): boolean {
  // 宽屏两条都展开是官方允许的（栏宽已按可用宽度算好，不会重叠）
  if (isWideWindow(windowWidth)) return false
  return miniExpanded
}

/**
 * 窄屏下迷你栏是否放得下展开态
 *
 * 极窄屏（约 < 360dp：图标态页签栏 3×48 + 迷你栏下限 200 + 缝 8 = 352）上，
 * 两条栏**怎么排都放不下**。鸿蒙侧由 HDS 自己把迷你栏按回折叠态（一颗圆钮）兜底，
 * RN 侧由壳层读这个值决定：放不下就强制折叠成圆钮，别硬撑出重叠。
 */
export function canExpandMiniBar(windowWidth: number, tabCount = 3): boolean {
  if (isWideWindow(windowWidth)) return true
  const avail = Math.max(0, windowWidth - barSideMarginFor(windowWidth) * 2)
  return avail >= tabCount * TAB_SLOT_ICON + MINI_BAR_NARROW_MIN + BAR_GAP
}

/**
 * 窄屏下「图标态页签栏 + 展开的迷你栏」的宽度分配
 *
 * 窄屏放不下「文字页签栏 + 展开迷你栏」，所以页签栏收成只有图标的形态。
 * 分配顺序：先按「页签数 × 槽位」给页签栏，剩下的给迷你栏；
 * 迷你栏不够下限时，反过来保迷你栏、压缩页签栏（但不低于图标下限）。
 *
 * @returns 两条栏的宽度；放不下时返回 null（调用方应让迷你栏保持折叠）
 */
export function narrowBarSplit(
  windowWidth: number,
  tabCount: number,
): { tabBarWidth: number, miniBarWidth: number } | null {
  const avail = Math.max(0, windowWidth - barSideMarginFor(windowWidth) * 2)
  let tab = tabCount * TAB_SLOT_ICON
  let mini = avail - tab - BAR_GAP

  if (mini < MINI_BAR_NARROW_MIN) {
    // 迷你栏保底，页签栏让位（但不能挤到放不下图标）
    mini = MINI_BAR_NARROW_MIN
    tab = avail - mini - BAR_GAP
  }
  if (tab < tabCount * TAB_SLOT_ICON_MIN) return null
  return { tabBarWidth: Math.round(tab), miniBarWidth: Math.round(mini) }
}

/**
 * 算底部两条栏的宽度
 *
 * 保证「页签栏 + 迷你栏 + 中间缝 = 可用宽度」，任何窗口宽度下都不会重叠。
 * 三条互相牵制的官方规则见 HARMONY_UI_SPEC.md 5.6。
 *
 * ⚠️ 调用方必须先用 {@link shouldCollapseTabBar} 判断页签栏要不要收成图标态：
 * 窄屏且迷你栏展开时，用 {@link narrowBarSplit} 算两条栏的宽度，否则两条会重叠。
 */
export function barMetricsFor(windowWidth: number, miniExpanded: boolean): BarMetrics {
  const sideMargin = barSideMarginFor(windowWidth)
  const avail = Math.max(0, windowWidth - sideMargin * 2)
  // 宽屏下 miniBarStyle 不生效，迷你栏一定处于展开态，页签栏也保持展开
  const wide = isWideWindow(windowWidth)
  const expanded = wide || miniExpanded

  let mini = clamp(Math.round(avail * MINI_BAR_WIDTH_RATIO), MINI_BAR_WIDTH_MIN, BAR_WIDTH_MAX)
  if (expanded) {
    // 展开态旁边那条也得有位置：宽屏是展开的页签栏，窄屏是图标态的页签栏
    const otherMin = wide ? TAB_BAR_WIDTH_MIN : TAB_SLOT_ICON * 3
    mini = Math.min(mini, Math.max(MINI_BAR_WIDTH_MIN, avail - otherMin - BAR_GAP))
  }

  const reserved = (expanded ? mini : MINI_BAR_COLLAPSED) + BAR_GAP
  let tab = Math.min(BAR_WIDTH_MAX, avail - reserved)
  if (tab < TAB_BAR_WIDTH_MIN) {
    // 窗口窄到两条都放不下（小屏手机）：页签栏保底，迷你栏让位
    tab = Math.min(BAR_WIDTH_MAX, Math.max(TAB_BAR_WIDTH_MIN, avail - reserved))
  }
  return { sideMargin, tabBarWidth: tab, miniBarWidth: mini }
}

/**
 * 页内那条迷你栏（歌单详情 / 在线详情，不在页签体系里）该收多宽
 *
 * > 0 = 宽屏，收成与页签里那条同一宽度；= 0 = 窄屏，不限宽。
 */
export function miniBarWidthOrUnbounded(published: number): number {
  return published > 0 ? published : LAYOUT_UNBOUNDED
}

/** 壳层要同步给别的页面的迷你栏宽度（宽屏给实际值，窄屏给 0） */
export function publishedMiniBarWidth(windowWidth: number, miniExpanded: boolean): number {
  if (!isWideWindow(windowWidth)) return 0
  return barMetricsFor(windowWidth, miniExpanded).miniBarWidth
}
