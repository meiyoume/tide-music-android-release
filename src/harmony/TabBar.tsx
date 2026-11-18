/**
 * 底部页签栏 —— **手机 QQ 音乐**样式
 *
 * 与鸿蒙版的区别（这是本次换肤的核心差异之一）：
 *   - 鸿蒙版：**悬浮胶囊**（离底 16、圆角 30、左右留边、与迷你栏并排成一条带）
 *   - QQ 音乐：**贴底的普通 TabBar**（横跨整宽、直角、顶部一条 0.5px 分割线），
 *     迷你播放栏贴在它**上方**单独占一行
 *
 * 另外 QQ 音乐手机版底部是**四个**页签（我的 / 发现 / 音乐馆 / 关注 之类，
 * 且用户可自定义），这里按本移植版**实际有的功能**来 —— 现在是**两个**（推荐 / 我的）。
 * 「听书」页签已按用户要求去掉（点进去只是一个「未包含」的说明页，
 * 因为鸿蒙的听书是独立的书源引擎）；`TAB_LISTEN` 的定义还留着，想加回来放回数组即可。
 *
 * 页签数量按功能来，不去硬凑四个。`flex: 1` 等分，所以两个页签各自占一半宽。
 *
 * 选中态：图标与文字都是**品牌绿**（QQ 音乐就是图标+文字一起变绿）。
 */
import { memo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTokens } from './useTokens'
import { LxIcon, type IconName } from './LxIcon'
import { F_TAB } from './tokens'

export interface TabDef {
  key: string
  icon: IconName
  iconActive: IconName
  label: string
}

/** 三个页签的定义（`TAB_LISTEN` 目前不在可见列表里，见文件头说明） */
export const TAB_HOME: TabDef = { key: 'home', icon: 'home', iconActive: 'homeFill', label: '推荐' }
export const TAB_LISTEN: TabDef = { key: 'listen', icon: 'book', iconActive: 'bookFill', label: '听书' }
export const TAB_MINE: TabDef = { key: 'mine', icon: 'person', iconActive: 'personFill', label: '我的' }

/** 全部页签定义（含已隐藏的听书），供需要时取用 */
export const TABS: TabDef[] = [TAB_HOME, TAB_LISTEN, TAB_MINE]

/** 单颗页签占的宽度（保留导出，避免调用点报错；贴底栏按下标等分，不再需要算槽位） */
const TAB_SLOT_MEDIUM = 72
const TAB_SLOT_LARGE = 80

/** 贴底 TabBar 的高度（QQ 音乐手机版约为 50 + 手势条） */
export const TABBAR_HEIGHT = 52

interface TabBarProps {
  /** 可见的页签（听书可隐藏） */
  tabs: TabDef[]
  activeKey: string
  onSelect: (key: string) => void
  /** 栏宽（贴底样式下其实横跨整宽，保留参数以兼容调用点） */
  width: number
  /** 是否折叠成图标条（窄屏保护，保留以兼容调用点） */
  collapsed?: boolean
  /** 底部安全区（手势条高度），贴底栏需要自己让出来 */
  bottomInset?: number
}

export const TabBar = memo(({
  tabs,
  activeKey,
  onSelect,
  collapsed = false,
  bottomInset = 0,
}: TabBarProps) => {
  const t = useTokens()

  return (
    <View
      style={{
        width: '100%',
        // 贴底：不是悬浮胶囊，横跨整宽 + 直角
        height: TABBAR_HEIGHT + bottomInset,
        paddingBottom: bottomInset,
        backgroundColor: t.card,
        // 顶部一条分割线（QQ 音乐靠这条线把 TabBar 与内容分开，不用阴影）
        borderTopWidth: StyleSheet.hairlineWidth < 1 ? 0.5 : StyleSheet.hairlineWidth,
        borderTopColor: t.divider,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {tabs.map(tab => {
        const active = tab.key === activeKey
        return (
          <TouchableOpacity
            key={tab.key}
            style={{
              flex: 1,
              height: '100%',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 3,
            }}
            onPress={() => { onSelect(tab.key) }}
            activeOpacity={0.6}
          >
            <LxIcon
              name={active ? tab.iconActive : tab.icon}
              size={23}
              color={active ? t.red : t.tabUnselected}
            />
            {!collapsed && (
              <Text style={{ fontSize: F_TAB, color: active ? t.red : t.tabUnselected }}>
                {tab.label}
              </Text>
            )}
          </TouchableOpacity>
        )
      })}
    </View>
  )
})

export { TAB_SLOT_MEDIUM, TAB_SLOT_LARGE }
