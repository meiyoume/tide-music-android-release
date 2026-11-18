/**
 * 壳层里的子页面宿主（鸿蒙 `HdsNavDestination` 的 RN 版）
 *
 * 鸿蒙侧从「我的」页点「设置 / 帮助和反馈」会压上一个整屏子页面（带返回键）。
 * RN 侧这些页面在底座里已经存在（`screens/Home/Views/Setting`、`Setting/settings/About`），
 * 所以这里只负责：**整屏铺开 + 顶部一条返回栏 + 把内容放进去**，
 * 不重写页面本身（那会把上游代码改得面目全非，也会丢掉已有功能）。
 *
 * 为什么需要这一层：早先「我的」页的入口只是切底部页签（`setNavActiveId('nav_love')`），
 * 而点的时候已经在那个页签上 —— 等于点了没反应。截图验证时发现的。
 */
import { memo } from 'react'
import { View, Text, TouchableOpacity, ScrollView } from 'react-native'
import { useTokens } from './useTokens'
import { LxIcon } from './LxIcon'
import { HDS_TITLE_BAR_HEIGHT, SET_NAV_SLOT, SET_NAV_TITLE_SIZE, SET_NAV_TITLE_WEIGHT } from './tokens'
import {
  FavoritesPane,
  HistoryPane,
  LocalMusicPane,
  DownloadsPane,
  CloudPane,
} from './Panes'

/** 子页面标题 */
const TITLES: Record<string, string> = {
  settings: '设置',
  about: '帮助和反馈',
  search: '搜索',
  local: '本地音乐',
  history: '最近播放',
  favorites: '收藏',
  downloads: '下载管理',
  cloud: '云端音乐',
  newPlaylist: '新建歌单',
  importPlaylist: '歌单导入',
  comment: '评论',
  apiSource: '音源',
}

/**
 * 自带标题栏 / 返回栏的页面：外面不再套一层
 *
 * - `search`：搜索页自带输入框与标题栏
 * - `comment`：评论页自带歌曲信息头 + 热门/最新页签
 * - 五个 Pane：用 `PaneShell` 自带返回栏（它们的头部是常驻控件，需要自己让出状态栏）
 */
const NO_HEADER = new Set(['search', 'comment', 'favorites', 'history', 'local', 'downloads', 'cloud', 'apiSource'])

interface SubPageHostProps {
  page: string
  /** 状态栏高度 */
  topInset: number
  onBack: () => void
}

export const SubPageHost = memo(({ page, topInset, onBack }: SubPageHostProps) => {
  const t = useTokens()
  /* 页面名可以带参数（`apiSource:add` = 音源页 + 进来就弹出导入弹层）。
     标题与「这页自不自带标题栏」都按冒号前那段判，否则带参数的那个会
     多出一条写着 `apiSource:add` 的返回栏。 */
  const base = page.split(':')[0]
  const title = TITLES[base] ?? page

  // 延迟 require，避免把整套设置页的依赖打进首屏
  const content = (() => {
    switch (page) {
      case 'settings': {
        const Setting = require('@/screens/Home/Views/Setting').default
        return <Setting />
      }
      case 'about': {
        const About = require('@/screens/Home/Views/Setting/settings/About').default
        return <About />
      }
      case 'search': {
        // 搜索页：底座里是 nav_search 页签的内容，这里整屏承接。
        // 不接的话点搜索钮什么都不会发生（壳层自己不渲染那个页签）。
        const Search = require('@/screens/Home/Views/Search').default
        return <Search />
      }
      case 'comment': {
        // 播放页的「评论」按钮。评论页自己去 playerState 取当前播放的歌，
        // 所以不用传参数；它也不会用 navigations（查过），随便给个 componentId 就行。
        const Comment = require('@/screens/Comment').default
        return <Comment componentId="tide_comment" />
      }
      // 下面五个是「我的」页的快捷入口。它们**自带返回栏**（PaneShell），
      // 所以不进 SubPageHost 的通用返回栏（见 NO_HEADER）。
      case 'favorites':
        return <FavoritesPane topInset={topInset} onBack={onBack} />
      case 'history':
        return <HistoryPane topInset={topInset} onBack={onBack} />
      case 'local':
        return <LocalMusicPane topInset={topInset} onBack={onBack} />
      case 'downloads':
        return <DownloadsPane topInset={topInset} onBack={onBack} />
      case 'cloud':
        return <CloudPane topInset={topInset} onBack={onBack} />
      /* 音源：`apiSource:add` 是「添加歌源」那一行进来的，直接把导入弹层弹出来。
         延迟 require，理由同 settings —— 不把整套音源管理打进首屏。 */
      case 'apiSource':
      case 'apiSource:add': {
        const ApiSourcePane = require('./ApiSourcePane').ApiSourcePane
        return <ApiSourcePane topInset={topInset} onBack={onBack} autoAdd={page === 'apiSource:add'} />
      }
      default:
        return <NotPorted page={page} title={title} />
    }
  })()

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 返回栏：与鸿蒙子页面的标题栏同高（60 + 状态栏）。
          搜索页自己带标题栏与输入框，所以不套这一层。
          v1.9.20：标题改成**居中**、16px/650，与界面 `.navbar__title` 一致
          （原来是 19px、左对齐，压在潮汐界面上像另一个应用的头）。
          两侧各留一个等宽槽，标题才是真居中 —— 和界面里
          「返回 + 居中标题 + 右动作」三格同一套。 */}
      {!NO_HEADER.has(base) && (
        <View
          style={{
            height: HDS_TITLE_BAR_HEIGHT + topInset,
            paddingTop: topInset,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 4,
          }}
        >
          <TouchableOpacity
            onPress={onBack}
            style={{ width: SET_NAV_SLOT, height: SET_NAV_SLOT, justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={0.6}
          >
            <LxIcon name="chevronLeft" size={24} color={t.text} />
          </TouchableOpacity>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: SET_NAV_TITLE_SIZE,
              fontWeight: SET_NAV_TITLE_WEIGHT,
              color: t.text,
            }}
          >{title}</Text>
          <View style={{ width: SET_NAV_SLOT, height: SET_NAV_SLOT }} />
        </View>
      )}

      {/* 搜索页需要自己让出状态栏 */}
      {NO_HEADER.has(base) && <View style={{ height: topInset, backgroundColor: t.bg }} />}

      <View style={{ flex: 1 }}>{content}</View>
    </View>
  )
})

/** 本次移植未包含的页面：给明确说明，不假装有功能 */
const NotPorted = ({ page, title }: { page: string, title: string }) => {
  const t = useTokens()
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }}>{title}</Text>
      <Text style={{ fontSize: 14, lineHeight: 22, color: t.textSub }}>
        本次移植只重做了**界面壳层与推荐页 / 我的页**。{'\n'}
        「{title}」这类子页面的内容层沿用了洛雪安卓版原有实现，
        但接入壳层的路由还没做完（鸿蒙侧它是 HdsNavDestination 子页面）。
        {'\n\n'}
        关掉「设置 - 基础设置 - 界面壳层（鸿蒙移植版）」可以立刻回到安卓版原界面，
        那里这些入口都是完整的。
      </Text>
    </ScrollView>
  )
}
