import { Children } from 'react'
import { View, StyleSheet } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import Text from '@/components/common/Text'
import { useTokens } from '@/harmony/useTokens'
import {
  SET_CARD_RADIUS,
  SET_DIVIDER_INSET,
  SET_GROUP_GAP,
  SET_LABEL_SIZE,
  SET_LABEL_TRACK,
} from '@/harmony/tokens'


interface Props {
  title: string
  children: React.ReactNode | React.ReactNode[]
}

/**
 * 设置分组
 *
 * 两种形态：
 *   - **鸿蒙壳层开启**：圆角卡片分组（标题在上、卡片在下的白底卡片），
 *     与鸿蒙 `SettingsView` 的 `cardGroup` 一致（HARMONY_UI_SPEC.md 2.10.1）。
 *     规格要求「行之间显示分隔线」，所以这里在子项之间插分隔线。
 *   - 关掉壳层：退回安卓版原样式（左侧红色竖条 + 缩进标题），保证回退保险有效。
 *
 * 为什么在这里做「两态」而不是新写一套设置页：这个组件被 11 个设置子页引用、
 * `CheckBoxItem` 被 35 个文件引用，改共享组件能一次覆盖整棵设置树；
 * 新写一套则要复制上百个设置项，既容易漏也跟不上上游。
 */
export default ({ title, children }: Props) => {
  const theme = useTheme()
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()

  if (harmonyShell) {
    const items = Children.toArray(children)
    return (
      <View style={harmonyStyles.container}>
        <Text style={[harmonyStyles.title, { color: t.textWeak }]}>{title}</Text>
        <View style={[harmonyStyles.card, { backgroundColor: t.card, borderColor: t.divider }]}>
          {items.map((child, index) => (
            <View key={index}>
              {index > 0 && (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth < 1 ? 0.6 : StyleSheet.hairlineWidth,
                    backgroundColor: t.divider,
                    marginLeft: SET_DIVIDER_INSET,
                  }}
                />
              )}
              {child}
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={{ ...styles.title, borderLeftColor: theme['c-primary'] }} size={16} >{title}</Text>
      <View>
        {children}
      </View>
    </View>
  )
}


const styles = createStyle({
  container: {
    // paddingLeft: 10,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  title: {
    borderLeftWidth: 5,
    paddingLeft: 12,
    marginBottom: 10,
    // lineHeight: 16,
  },
})

/**
 * 鸿蒙形态：分组标题 + 圆角卡片
 *
 * ⚠️ 这一版（v1.9.20）**整体换成了潮汐界面的骨架**，取值逐项来自 Web 界面的 `styles.css`：
 *   `.s-group__label` → 12px / 600 / letterSpacing .03em / **浅灰**（`--text-3`）
 *   `.s-group`        → 圆角 22（`--radius-lg`）+ 1px 描边（`--hairline`）
 *   `.s-row + .s-row` → 分隔线左缩进 16
 *
 * 上一版按鸿蒙源码做的是「17 号 + 中型 + 深色」的分组标题（见下），
 * 那是**鸿蒙应用的**分组标题规格，不是潮汐界面的。用户反馈「原生设置还是没有变化」，
 * 量过颜色之后确认调色板已经生效（开关轨道取到潮汐薄荷色），
 * 剩下的差异全在版式上 —— 17px 深色标题 + 8 圆角卡片跟界面对不上，所以这次换掉。
 *
 * 为什么不再按鸿蒙源码对齐：现在这一层服务的对象是**潮汐界面**，
 * 鸿蒙源码只是当初的移植参照。规格冲突时以界面为准。
 *
 * 关掉壳层仍然退回安卓版原样式（左侧红色竖条 + 缩进标题），回退保险有效。
 */
const harmonyStyles = createStyle({
  container: {
    marginBottom: SET_GROUP_GAP,
  },
  title: {
    fontSize: SET_LABEL_SIZE,
    fontWeight: '600',
    letterSpacing: SET_LABEL_TRACK,
    paddingLeft: 4,
    paddingRight: 4,
    paddingBottom: 8,
  },
  card: {
    borderRadius: SET_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth < 1 ? 0.6 : StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
