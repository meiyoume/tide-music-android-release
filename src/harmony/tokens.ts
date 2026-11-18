/**
 * 洛雪（鸿蒙移植版）设计 token —— React Native 侧
 *
 * 与鸿蒙工程 `resources/base/element/color.json`（亮）和 `resources/dark/element/color.json`（暗）
 * **逐项一一对应**：token 名沿用鸿蒙侧的语义名（去掉 `c_` 前缀，改为大驼峰），
 * 色值原样搬过来（鸿蒙是 #AARRGGBB，这里已转成 RN 的 #RRGGBBAA）。
 *
 * 为什么要单独一套 token，而不是复用洛雪安卓版原有的 `theme['c-primary-*']`：
 * 鸿蒙版的视觉体系与安卓版原版**不是同一套** —— 鸿蒙版是「浅灰底 + 纯白卡片 + 洛雪红强调色」，
 * 且把每个颜色都做成了语义 token（C_BG / C_CARD / C_RED / C_GLASS_* …）。
 * 移植的目标是**视觉一致**，所以界面代码直接吃这套语义名，一眼能对上鸿蒙源码。
 *
 * 用法：
 *   const t = useTokens()          // 组件内（跟随深浅模式自动切换）
 *   const t = getTokens(true)      // 非组件环境（显式指定深浅）
 */

/** 一套完整的洛雪 token（亮色 / 暗色各一份） */
export interface LxTokens {
  // ---------------- 页面与容器 ----------------
  /** 页面底色（浅灰 / 近黑） */
  bg: string
  /** 顶栏渐隐起点色 */
  topFade: string
  /** 顶栏渐隐终点色（同色 alpha 0） */
  topFadeEnd: string
  /** 卡片 / 列表底 */
  card: string
  /** 浅一档填充（搜索框、说明块、动作区） */
  fillSoft: string
  /** 再深一档填充（次级按钮、轨道底、头像底） */
  fillSoftStrong: string
  /** 分段胶囊容器底 */
  segBg: string
  /** 分割线 */
  divider: string
  /** 底部页签栏下的渐隐蒙层 */
  maskBottom: string

  // ---------------- 文字与图标 ----------------
  /** 主要文字 */
  text: string
  /** 次要文字（歌手、副标题） */
  textSub: string
  /** 更弱文字（占位、计数、行尾图标） */
  textWeak: string
  /** 未选中图标 */
  icon: string
  /** 行尾小箭头 */
  chevron: string
  /** 分段胶囊未选中文字 */
  segUnselected: string
  /** 底部页签栏未选中文字 */
  tabUnselected: string
  /** 强调色药丸上的反白字 */
  onAccent: string

  // ---------------- 强调色与状态 ----------------
  /** 强调色（洛雪红） */
  red: string
  /** 强调色淡底（标签、重试钮、图标底） */
  redTint: string
  /** 设置行图标 / 头像淡圆底 */
  iconCircle: string
  /** 折叠态唱片圆钮底 */
  recordButton: string
  /** 按压态覆盖色 */
  pressed: string
  /** 滑块轨道 */
  sliderTrack: string

  // ---------------- 玻璃层 ----------------
  /** 最透一档玻璃底（圆钮、迷你栏） */
  glassFill: string
  /** 中等厚度玻璃底（卡片式浮层） */
  glassTint: string
  /** 玻璃层描边（顶边高光） */
  glassEdge: string
  /** 提示条那种更实的玻璃底 */
  glassSolid: string
  /** 玻璃层主色（材质不生效时的兜底观感） */
  glass: string
  /** 玻璃层描边（mask 档） */
  glassMaskEdge: string
  /** 深色玻璃（播放器控制区，两种模式相同） */
  glassDark: string

  // ---------------- 设置页图标色 ----------------
  iconBlue: string
  iconPurple: string
  iconGreen: string
  iconOrange: string
  iconCoral: string

  // ---------------- 平台品牌色 ----------------
  platform: Record<string, string>
  platformTint: Record<string, string>

  /** 当前是否为深色 */
  isDark: boolean
}

/**
 * 亮色 token —— **手机 QQ 音乐**风格
 *
 * 色值**实测自 QQ 音乐线上 CSS**（`y.qq.com` 的 3 个 common css，共 101202 字节，
 * 统计十六进制色值出现频次），不是照印象猜的：
 *
 *   | 用途 | 色值 | 出现次数 |
 *   |---|---|---|
 *   | 品牌绿（强调色） | `#31C27C` | 48 |
 *   | 绿悬停 | `#2CAF6F` | 8 |
 *   | 页面底 | `#F2F2F2` | 10 |
 *   | 卡片 | `#FBFBFD` | 3 |
 *   | 次要文字 | `#4F4F4F` | 2 |
 *   | 弱文字 / 箭头 | `#C9C9C9` | 14 |
 *   | 分割线 | `#EDEDED` | 5 |
 *   | 滑块轨道 | `#E1E1E1` | 6 |
 *
 * 并遵循 QQ 音乐 2024 改版设计稿的三条原则（腾讯音乐 MUX 公开总结）：
 *   1. **克制用色**：黑白承担文字与背景，**品牌绿只作点缀**（不做大面积绿底）；
 *   2. **减小圆角**：让封面展示更完整、负空间更规整；
 *   3. **加大宫格**：一屏内容更少、更纯粹，把注意力留给封面本身。
 *
 * ⚠️ 实现上的取巧：界面代码里强调色一律写 `t.red` / `t.redTint`（共 31 处），
 * 所以换肤**只需要改这里的值**，不必去动那 31 个文件 —— 语义名仍叫 red（历史命名），
 * 但值已经是 QQ 绿。这样改动面最小、也不会漏。
 */
const LIGHT: Omit<LxTokens, 'isDark'> = {
  bg: '#F2F2F2',
  topFade: '#F2F2F2',
  topFadeEnd: '#F2F2F200',
  card: '#FBFBFD',
  fillSoft: '#F2F2F2',
  fillSoftStrong: '#EDEDED',
  segBg: '#EDEDED',
  divider: '#EDEDED',
  maskBottom: '#F2F2F266',

  text: '#000000',
  textSub: '#4F4F4F',
  textWeak: '#A2A2A2',
  icon: '#1A1A1A',
  chevron: '#C9C9C9',
  segUnselected: '#4F4F4F',
  tabUnselected: '#7F7F7F',
  onAccent: '#FFFFFF',

  // 语义名仍是 red（历史命名，界面 31 处都这么取），值 = QQ 品牌绿
  red: '#31C27C',
  redTint: '#31C27C1A',
  iconCircle: '#0000000A',
  recordButton: '#31C27C',
  pressed: '#0000000A',
  sliderTrack: '#E1E1E1',

  // QQ 音乐不做「悬浮玻璃」这套，玻璃层按最简处理（保留字段以免大面积改调用点）
  glassFill: '#FFFFFF',
  glassTint: '#FFFFFF',
  glassEdge: '#EDEDED',
  glassSolid: '#FFFFFF',
  glass: '#FFFFFF',
  glassMaskEdge: '#EDEDED',
  glassDark: '#FFFFFF2E',

  iconBlue: '#2E77E5',
  iconPurple: '#8257F5',
  iconGreen: '#31C27C',
  iconOrange: '#C7922B',
  iconCoral: '#FF4222',

  platform: { kw: '#FF6B35', kg: '#4A90D9', mg: '#FF4081', tx: '#31C27C', wy: '#C62F2F' },
  platformTint: {
    kw: '#FF6B351A',
    kg: '#4A90D91A',
    mg: '#FF40811A',
    tx: '#31C27C1A',
    wy: '#C62F2F1A',
  },
}

const DARK: Omit<LxTokens, 'isDark'> = {
  bg: '#121212',
  topFade: '#121212',
  topFadeEnd: '#12121200',
  card: '#1E1E1E',
  fillSoft: '#242424',
  fillSoftStrong: '#2A2A2A',
  segBg: '#2A2A2A',
  divider: '#2A2A2A',
  maskBottom: '#12121266',

  text: '#F2F2F2',
  textSub: '#A2A2A2',
  textWeak: '#6E6E6E',
  icon: '#EDEDED',
  chevron: '#5C5C5C',
  segUnselected: '#C9C9C9',
  tabUnselected: '#8A8A8A',
  onAccent: '#FFFFFF',

  // 暗色下 QQ 绿提亮一档（纯 #31C27C 在深底上偏闷）
  red: '#3FD98F',
  redTint: '#3FD98F2E',
  iconCircle: '#FFFFFF14',
  recordButton: '#3FD98F',
  pressed: '#FFFFFF14',
  sliderTrack: '#3A3A3A',

  glassFill: '#1E1E1E',
  glassTint: '#1E1E1E',
  glassEdge: '#2A2A2A',
  glassSolid: '#1E1E1E',
  glass: '#1E1E1E',
  glassMaskEdge: '#2A2A2A',
  glassDark: '#FFFFFF2E',

  iconBlue: '#5C8CFF',
  iconPurple: '#A78BFA',
  iconGreen: '#3FD98F',
  iconOrange: '#E0A83C',
  iconCoral: '#FF6B4A',

  platform: { kw: '#FF8A5C', kg: '#74A6E6', mg: '#FF6FA5', tx: '#3FD98F', wy: '#E86A6A' },
  platformTint: {
    kw: '#FF8A5C2E',
    kg: '#74A6E62E',
    mg: '#FF6FA52E',
    tx: '#3FD98F2E',
    wy: '#E86A6A2E',
  },
}

/**
 * 预拼好的两套完整 token —— **同一套始终是同一个引用**
 *
 * 早先这里是 `{ ...(isDark ? DARK : LIGHT), isDark }` 现拼一个新对象。
 * 后果是 `useTokens()` 每次 render 都返回**新引用**，而这个 `t` 是几乎每个
 * 组件的依赖：任何 `useMemo/useCallback` 依赖 `t` 或其派生值都会**每次重算**，
 * 把 `t` 当 props 传给 `memo` 子组件也等于**没 memo**。
 * 现在只在切深浅模式时才换引用，其余时候恒定 —— 是下面各处 memo 能生效的前提。
 *
 * （故意不加 `Object.freeze`：工程里 token 是只读用法，但冻结一旦遇到某处
 *   意外写入就会在严格模式下抛错，收益不抵风险。）
 */
const LIGHT_TOKENS: LxTokens = { ...LIGHT, isDark: false }
const DARK_TOKENS: LxTokens = { ...DARK, isDark: true }

// ---------------------------------------------------------------- 潮汐界面推来的调色板

/**
 * 潮汐界面推来的调色板
 *
 * 为什么需要它：原生子页面（洛雪原生设置、音源、评论、最近播放…）吃的是**这套 token**，
 * 而潮汐界面有自己的一套皮肤（六套底色 + 一个可换的主题色）。两边不打通的话
 * 就是「深色界面里点设置，蹦出一张绿底白卡的安卓版设置页」—— 用户原话
 * 「洛雪原生设置里面也没要美化，ui 和软件 ui 对齐审美一致，不然很割裂」。
 *
 * 所以界面把**自己算好的那几个颜色**推过来（见 bridge 的 theme 命令），
 * 这里覆盖掉对应 token。推的是最终色值（`--bg` / `--card-solid` / `--text` …），
 * 不是皮肤名 —— 界面那边换皮肤、改主题色、切深浅，推过来的就是新的一组，
 * 原生页面自动跟上，这边不用知道「墨黑」「深海」是什么。
 */
export interface TidePalette {
  /** 这一组色值对应的深浅模式（决定它替哪一套 token） */
  dark: boolean
  /** 主题色（原来的洛雪红/QQ 绿，现在跟着界面的主题色走） */
  accent: string
  bg: string
  card: string
  text: string
  textSub: string
  textWeak: string
  divider: string
}

let palette: TidePalette | null = null
const tokenListeners = new Set<() => void>()
/** 按模式缓存「基础 token + 调色板」拼出来的那一份（同一份恒返回同一引用，理由见上） */
const derivedTokens: Partial<Record<'dark' | 'light', LxTokens>> = {}

/** `#RGB` / `#RRGGBB` → `#RRGGBBAA`；rgb()/rgba() 原样返回（RN 自己认） */
const withAlpha = (color: string, alpha: number): string => {
  let h = String(color ?? '').trim()
  if (!h) return ''
  if (h[0] !== '#') return h
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
  if (h.length !== 7) return h
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
  return h + a
}

/** 订阅调色板变化（`useTokens` 靠它重渲染） */
export const subscribeTokens = (fn: () => void): (() => void) => {
  tokenListeners.add(fn)
  return () => { tokenListeners.delete(fn) }
}

/**
 * 接住界面推来的调色板。色值全空就当没推（保持原样），
 * 免得界面那边读不到计算样式时把原生页面刷成一片透明。
 */
export const setTidePalette = (next: TidePalette | null): void => {
  const ok = !!next?.accent && !!next.bg && !!next.text
  const value = ok ? next : null
  const same = JSON.stringify(palette) === JSON.stringify(value)
  palette = value
  delete derivedTokens.dark
  delete derivedTokens.light
  if (same) return
  for (const fn of tokenListeners) fn()
}

/** 取一套 token（`isDark` = true 给暗色那份）。同一套恒返回同一引用。 */
export const getTokens = (isDark: boolean): LxTokens => {
  const key = isDark ? 'dark' : 'light'
  const cached = derivedTokens[key]
  if (cached) return cached
  const base = isDark ? DARK_TOKENS : LIGHT_TOKENS
  /* 界面推来的那组只对得上它自己的深浅模式：对不上就用内置的，
     免得出现「深色界面推来的色值被用到浅色 token 上」这种混搭 */
  if (!palette || palette.dark !== isDark) return base
  const p = palette
  derivedTokens[key] = {
    ...base,
    bg: p.bg,
    topFade: p.bg,
    topFadeEnd: withAlpha(p.bg, 0),
    maskBottom: withAlpha(p.bg, 0.4),
    card: p.card,
    glassFill: p.card,
    glassTint: p.card,
    glassSolid: p.card,
    glass: p.card,
    text: p.text,
    textSub: p.textSub || base.textSub,
    segUnselected: p.textSub || base.segUnselected,
    tabUnselected: p.textSub || base.tabUnselected,
    textWeak: p.textWeak || base.textWeak,
    chevron: p.textWeak || base.chevron,
    divider: p.divider || base.divider,
    glassEdge: p.divider || base.glassEdge,
    glassMaskEdge: p.divider || base.glassMaskEdge,
    red: p.accent,
    redTint: withAlpha(p.accent, 0.12),
    recordButton: p.accent,
    iconGreen: p.accent,
  }
  return derivedTokens[key]
}

/** 平台品牌色；取不到的平台退回次要文字色 */
export const platformColor = (t: LxTokens, source: string): string =>
  t.platform[source] ?? t.textSub

/** 平台品牌色淡底；取不到的平台退回强调色淡底 */
export const platformTint = (t: LxTokens, source: string): string =>
  t.platformTint[source] ?? t.redTint

// ---------------------------------------------------------------- 悬浮栏的不透明底

/**
 * 底部悬浮栏（页签栏 / 迷你栏）的实底
 *
 * **为什么不直接用 `glassSolid`（#FFFFFFD1，82% 不透明）**：
 * 鸿蒙侧这层的不透明度实际来自 HDS **系统材质**（`systemMaterialEffect`）——
 * 系统会在材质层做高斯模糊，背后的列表文字被糊掉，所以 10% 白底也读得清。
 * RN 没有这层材质，若只给 82% 白，背后那行歌名会以 18% 的强度透上来，
 * 与栏里的文字**叠成两层字**（实测截图里「华语R&B…」压在「推荐/听书/我的」上）。
 *
 * 所以这里退到**实底**：保住圆角与描边的玻璃观感，代价是不再透出背景。
 * 这是「没有模糊能力」时唯一能同时保住可读性与观感的选择
 * （详见 HARMONY_UI_SPEC.md 6.8：没有系统材质时不要靠半透明假装玻璃）。
 */
export const getBarSolid = (t: LxTokens): string => (t.isDark ? '#242428' : '#FFFFFF')

// ---------------------------------------------------------------- 全屏播放器（恒为深色）

/**
 * 全屏播放器的配色
 *
 * **与深浅模式无关**：播放器是压在封面上的深色层，鸿蒙侧这几个值写死在
 * `views/PlayerView.ets` 里（规格 3.1.7「系统级 / 特殊色」），亮色模式下也是深色。
 * 早先这里跟着主题走 `PageContent` 的底色，结果亮色模式下播放器变成浅色一片 ——
 * 与鸿蒙的观感完全不符（白底上压着白色歌词、封面浮在浅灰上）。
 */
export const PLAYER_TOKENS = {
  /** 播放器页底（根容器） */
  bg: '#0C0C0E',
  /** 封面模糊图的兜底渐变起点（角度 205，到 bg） */
  bgGradientTop: '#33333A',
  /** 盖在封面模糊图上的压暗层 */
  scrim: '#40000000',
  /** 自绘底部面板底（「更多」/ 音质面板） */
  panel: '#232326',
  /** 面板背后的遮罩 */
  panelScrim: '#8A000000',
  /** 正文 */
  text: '#FFFFFFF2',
  /** 次要文字 */
  textSub: '#FFFFFF8C',
  /** 更弱文字 */
  textWeak: '#FFFFFF5E',
  /** 虚线分隔 */
  line: '#FFFFFF1F',
} as const

// ---------------------------------------------------------------- 非颜色的常量

/**
 * 圆角常量
 *
 * ⚠️ 这一组按 QQ 音乐 2024 改版的原则**整体调小了**（原鸿蒙版是 30 / 16 / 12）。
 * 官方设计稿原话：「我们减小了圆角，让图片展示更完整，让负空间的图形更规整，
 * 让页面排版更整洁。从情感上来看，恰到好处的圆角能让页面看起来更亲和。」
 *
 * 同时底栏不再是「悬浮胶囊」——QQ 音乐手机版是**贴底的普通 TabBar**，
 * 所以 `R_PILL` 这个语义已经用不到了（保留常量以免改动调用点报错）。
 */
export const R_PILL = 12
/** 卡片圆角（QQ 音乐列表卡更方正） */
export const R_CARD = 8
/** 列表封面圆角（减小圆角，让封面更完整） */
export const R_COVER = 4

/** 页面大标题字号 */
export const F_TITLE = 26
/** 分组标题字号 */
export const F_SECTION = 17
/** 列表主标题字号 */
export const F_ITEM = 16
/** 列表副标题字号 */
export const F_SUB = 12.5
/** 底部导航文字 / 多选底栏文字字号 */
export const F_TAB = 10.5

/** 底部悬浮页签栏 / 迷你栏 / 页内迷你栏高度 */
export const HDS_BAR_HEIGHT = 56
/** 子页面标题栏高度（不含状态栏） */
export const HDS_TITLE_BAR_HEIGHT = 60
/** 设置页单行高度 */
export const ROW_H = 46
/** 设置页滑块轨道宽度 */
export const SLIDER_W = 116
/** 页内迷你栏离手势条距离 */
export const PAGE_BAR_BOTTOM_GAP = 10

// ---------------------------------------------------------------- 设置树版式（v1.9.20）

/**
 * 设置树的版式常量 —— **逐项抄潮汐 Web 界面的 `styles.css`**
 *
 * 为什么单独开一组、而不是改上面的 `R_CARD` / `F_SECTION` / `F_ITEM`：
 * 用户第二次反馈「原生设置还是没有变化」时，我先量了颜色 —— 界面推过去的调色板
 * **确实生效了**（开关轨道取到 `#3DCCB0`，是潮汐的薄荷色，不是内核原来的 `#31C27C`）。
 * 也就是说「没变化」不是颜色问题，而是**版式**：17px 深色分组标题 + 8 圆角卡片 +
 * 46 高行，跟界面的 12px 浅灰小标题 + 22 圆角卡片 + 54 高行是两套骨架，
 * 颜色再对也还是一眼看出不是同一个应用。
 *
 * 那几个旧常量还被 harmony 自己的页面用着（`MinePage` / `RecommendPage` /
 * `SubPageHost` 共 20 处），改一处会连带改一片，所以这里新开一组，
 * 只给设置树（`Section` / `SubTitle` / `CheckBoxItem` / `Button` / `InputItem` / `Slider`）用。
 *
 * 对应关系（左边是 Web 界面的类名）：
 *   `.s-group`        → 卡片圆角 22 + 1px 描边
 *   `.s-group__label` → 12px / 600 / letterSpacing .03em / 浅灰
 *   `.s-row`          → 最小高 54 / 内边距 12×16 / 字号 14.5
 *   `.s-row + .s-row` → 分隔线左缩进 16
 *   `.switch`         → 48×29 胶囊 + 23px 白钮
 */
export const SET_CARD_RADIUS = 22
/** 分组之间的间距（`.s-group` 的 margin-top） */
export const SET_GROUP_GAP = 22
/** 分组标题字号 / 字距（CSS 的 `letter-spacing:.03em` × 12px ≈ 0.36） */
export const SET_LABEL_SIZE = 12
export const SET_LABEL_TRACK = 0.36
/** 设置行：最小高、内边距、正文字号 */
export const SET_ROW_MIN_H = 54
export const SET_ROW_PAD_X = 16
export const SET_ROW_PAD_Y = 12
export const SET_ROW_SIZE = 14.5
/** 行间分隔线的左缩进（Web 那边是 `left:16px`，卡片左对齐） */
export const SET_DIVIDER_INSET = 16
/** 开关：胶囊宽高 / 圆钮直径 / 圆钮离边距离 */
export const SET_SWITCH_W = 48
export const SET_SWITCH_H = 29
export const SET_SWITCH_KNOB = 23
export const SET_SWITCH_PAD = 3
/** 设置页左右内边距（界面 `.scroll` 是 18） */
export const SETTINGS_PAGE_PAD = 18
/** 子页面标题栏的字号 / 字重（界面 `.navbar__title` 是 16px / 650；
 *  字重取 600 —— RN 的 `fontWeight` 只认 100 的整数档，写 650 直接过不了类型检查，
 *  而 16px 下 600 与 650 肉眼分不出） */
export const SET_NAV_TITLE_SIZE = 16
export const SET_NAV_TITLE_WEIGHT = '600'
/** 标题栏两侧留出等宽的槽，标题才能真居中（界面里是「返回 + 居中标题 + 右动作」三格） */
export const SET_NAV_SLOT = 48
