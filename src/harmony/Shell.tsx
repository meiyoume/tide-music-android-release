/**
 * 应用壳层 —— **手机 QQ 音乐**结构
 *
 * 底部两层（自上而下）：
 *   1. **迷你播放栏**：TabBar 上方一条独立的白底条（左封面+歌名、右控制钮），
 *      点歌名区 → 全屏播放器；点列表钮 → 播放列表；
 *   2. **贴底 TabBar**：横跨整宽、直角、顶部一条 0.5px 分割线（推荐 / 听书 / 我的）。
 *
 * 这里经历过一次换肤：**原先照搬鸿蒙版的「悬浮胶囊带」**
 * （页签栏 + 迷你栏并排、离底 16dp、圆角 30、左右留边），
 * 按用户要求改成手机 QQ 音乐那种**贴底的普通 TabBar**。
 * 换肤后 `Layout.ts` 里那套「两条悬浮栏的宽度分配」算法就不再参与了
 * （`barMetricsFor` / `narrowBarSplit` / `canExpandMiniBar` 仍留在 Layout 里，
 * 但 Shell 不再调用 —— 贴底栏按下标等分，不需要算槽位）。
 *
 * 页面内容区在底部栏之上的剩余空间里滚动（不是浮在栏底下），
 * 所以各页面的 `paddingBottom` 不需要再刻意留出「栏高 + 间距」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackHandler, View, StatusBar, StyleSheet, useWindowDimensions } from 'react-native'
import { useTokens } from '@/harmony/useTokens'
import { MiniBar } from '@/harmony/MiniBar'
import { TabBar, TAB_HOME, TAB_MINE, type TabDef } from '@/harmony/TabBar'
import { SubPageHost } from '@/harmony/SubPageHost'
import { OnlineDetailPage } from '@/harmony/OnlineDetailPage'
import { HDS_BAR_HEIGHT, getBarSolid } from '@/harmony/tokens'
import { useStatusbarHeight } from '@/store/common/hook'
import commonState from '@/store/common/state'
import { RecommendPage } from './RecommendPage'
import { MinePage } from './MinePage'

/** 壳层能进的子页面 */
export interface ShellActions {
  /** 打开全屏播放器 */
  openPlayer: () => void
  /** 打开播放列表 */
  openQueue: () => void
  /** 进「我的」里的某个子页面（local / history / favorites / downloads / cloud / settings / about） */
  navigate: (action: string) => void
  /** 打开搜索页 */
  openSearch: () => void
}

interface ShellProps extends ShellActions {}

export const Shell = ({ openPlayer, openQueue, navigate, openSearch }: ShellProps) => {
  const t = useTokens()
  const { width: winWidth } = useWindowDimensions()
  /** 状态栏高度：标题栏是沉浸式的，内容必须自己让出这一段，否则首行文字被状态栏压住 */
  const topInset = useStatusbarHeight()

  const [activeKey, setActiveKey] = useState<string>('home')
  /**
   * 当前打开的子页面（从「我的」页点进来）
   *
   * 鸿蒙侧这些是 HdsNavDestination（整屏压上来、带返回键）。RN 侧底座里
   * 设置/关于这些页面本来就存在（`nav_setting` 那一套），所以这里只是
   * **在壳层里承接一个整屏子页面**，不再假装点一下没反应。
   */
  const [subPage, setSubPage] = useState<string | null>(null)

  /**
   * 子页面路由
   *
   * 早先这里把 `board:` / `playlist:` / `userlist:` 直接 return 忽略了（当时的注释写
   * 「详情类页面本次未接入」），结果推荐页的榜单卡片与推荐歌单**点了没反应** ——
   * 这是实测截图验证时用户直接反馈的问题（「我点不动」）。
   *
   * 现在这几类都真正压上一个整屏子页面：
   *   - `board:<榜单id>`      → 在线详情页（榜单）
   *   - `playlist:<源>:<id>`  → 在线详情页（歌单）
   *   - 其余（设置 / 关于 / 本地音乐 …）→ SubPageHost 承接
   */
  const handleNavigate = useCallback((action: string) => {
    setSubPage(action)
    // 仅对底座认得的页签动作（nav_*）透传，详情类由壳层自己渲染
    if (!action.includes(':')) navigate(action)
  }, [navigate])

  /**
   * 关掉当前子页面
   *
   * 用 `useCallback` 稳定引用：子页面宿主是 `memo` 的，内联箭头函数会让它
   * 每次壳层重渲染都判定 props 变化而重渲染。
   */
  const closeSubPage = useCallback(() => { setSubPage(null) }, [])

  /**
   * 系统返回键 / 手势返回：**逐层回退，而不是直接退出应用**
   *
   * 底座的返回键链路是：RNN 的 `NavigationActivity` → RN 的 `onBackPressed()`
   * → JS 的 `hardwareBackPress` 事件；**只有 JS 侧没有任何监听者返回 true** 时，
   * 才会走 `invokeDefaultOnBackPressed()` → pop 原生栈，栈里没得 pop 就
   * `finish()` 掉 Activity —— 也就是用户反馈的「搜完点返回直接回到了手机桌面」。
   *
   * 鸿蒙壳层的子页面（搜索 / 设置 / 榜单详情 …）是壳层自己的 `subPage` 状态，
   * **不是** RNN 的原生栈，所以原生栈里没得 pop，返回键一路走到 `finish()`。
   * 这里把这一层补上：有开着的子页面就先关掉它。
   *
   * ⚠️ 必须判断「首页是不是当前唯一挂载的页面」：
   * 播放页 / 歌单详情是 RNN `push` 上去的**独立屏幕**，推上去时首页并没有被卸载，
   * 本监听器依然挂在 RN 的全局 BackHandler 上（RNN 不卸载下层屏幕）。少了这个判断，
   * 在播放页按返回会被壳层吞掉。底座自己的 `Setting/index.tsx` 用的就是同一个判断。
   */
  useEffect(() => {
    const onHardwareBack = () => {
      // 上面还压着别的屏幕（播放页 / 歌单详情…）→ 不接管，让原生栈去 pop
      if (Object.keys(commonState.componentIds).length > 1) return false
      // 没有子页面 → 不接管，交给系统（退出应用，与上游行为一致）
      if (subPage == null) return false
      setSubPage(null)
      return true
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack)
    return () => { subscription.remove() }
  }, [subPage])

  /**
   * 打开搜索页
   *
   * 搜索页在底座里是 `nav_search` 页签的内容，但鸿蒙壳层自己不渲染那些页签
   * （页签只有推荐 / 听书 / 我的三个）。所以这里把它当**子页面**整屏承接 ——
   * 早先只是 `setNavActiveId('nav_search')`，壳层不认这个页签，点搜索钮毫无反应。
   */
  const handleOpenSearch = useCallback(() => {
    setSubPage('search')
    openSearch()
  }, [openSearch])

  /**
   * 底部页签
   *
   * 移植版**去掉了「听书」**（用户要求）。理由也站得住：鸿蒙版的听书是一套独立的
   * 书源引擎（阅读 / Legado 的 JSON 规则），与音乐音源不是同一套协议，
   * 本次移植并没有这部分能力 —— 那个页签点进去只是一个「未包含」的说明页，
   * 留着反而像是功能坏了。想加回来：把 `TAB_LISTEN` 放回数组、
   * 并在 `renderPage` 里补回 `listen` 分支（`TabBar.tsx` 里的 `TAB_LISTEN` 定义还留着）。
   */
  const tabs = useMemo<TabDef[]>(() => [TAB_HOME, TAB_MINE], [])

  /**
   * 底部安全区（手势条高度）
   *
   * 贴底 TabBar 必须自己让出这一段，否则最后一排图标会被手势条压住。
   * 本工程没装 `react-native-safe-area-context`（见 node_modules 实测），
   * 底座也**只**暴露了 `statusbarHeight`、没有底部对应的值，所以这里用
   * Android 通行的手势条高度估算 —— 宁可多留 4dp，也不要被遮住。
   * （鸿蒙版是悬浮栏、离底 16dp，天然避开了这个问题；改成贴底后必须显式处理。）
   */
  const bottomInset = 24

  const renderPage = () => {
    // 子页面优先：从「我的」页或推荐页点进来的，整屏盖住页签内容
    if (subPage) {
      // 详情类（在线榜单 / 在线歌单）走专用页面
      if (subPage.startsWith('board:')) {
        return (
          <OnlineDetailPage
            kind="board"
            id={subPage.slice('board:'.length)}
            topInset={topInset}
            onBack={closeSubPage}
          />
        )
      }
      if (subPage.startsWith('playlist:')) {
        // `playlist:<源>:<歌单id>`（歌单 id 里可能含冒号，所以只切前两段）
        const rest = subPage.slice('playlist:'.length)
        const sep = rest.indexOf(':')
        const source = (sep >= 0 ? rest.slice(0, sep) : 'kw') as LX.OnlineSource
        const id = sep >= 0 ? rest.slice(sep + 1) : rest
        return (
          <OnlineDetailPage
            kind="playlist"
            id={id}
            source={source}
            topInset={topInset}
            onBack={closeSubPage}
          />
        )
      }
      return (
        <SubPageHost
          page={subPage}
          topInset={topInset}
          onBack={closeSubPage}
        />
      )
    }
    switch (activeKey) {
      case 'home':
        return (
          <RecommendPage
            topInset={topInset}
            onOpenSearch={handleOpenSearch}
            onNavigate={handleNavigate}
          />
        )
      case 'mine':
        return <MinePage topInset={topInset} onNavigate={handleNavigate} />
      default:
        return null
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* 页面内容 */}
      <View style={{ flex: 1 }}>{renderPage()}</View>

      {/* 底部：**QQ 音乐结构** —— 迷你播放栏贴在 TabBar 上方，TabBar 贴底。
          子页面是整屏的（自带返回栏），不挂底部栏。 */}
      {!subPage && (
        <View>
          {/* 迷你播放栏：QQ 音乐里它是 TabBar 上方一条独立的白底条
              （左边封面+歌名，右边播放/下一首），不是鸿蒙那种胶囊 */}
          <View
            style={{
              height: HDS_BAR_HEIGHT,
              // 贴底栏上方同样用实底：这里上下都是内容，透出字来会糊
              backgroundColor: getBarSolid(t),
              borderTopWidth: StyleSheet.hairlineWidth < 1 ? 0.5 : StyleSheet.hairlineWidth,
              borderTopColor: t.divider,
              overflow: 'hidden',
            }}
          >
            <MiniBar
              expanded
              windowWidth={winWidth}
              onOpenPlayer={openPlayer}
              onOpenQueue={openQueue}
            />
          </View>

          <TabBar
            tabs={tabs}
            activeKey={activeKey}
            onSelect={setActiveKey}
            width={winWidth}
            collapsed={false}
            bottomInset={bottomInset}
          />
        </View>
      )}
    </View>
  )
}
