/**
 * 玻璃层（鸿蒙 `ui/Glass.ets` 的 RN 版）
 *
 * 鸿蒙侧是三层叠加：系统沉浸材质（API 26）/ HDS 光效 / 自绘玻璃兜底。
 * RN 侧**没有系统材质能力**，按 HARMONY_UI_SPEC.md 6.8 的明确结论，
 * 直接实现「降级后的观感」：
 *
 *   半透明白底 + 1px 白描边 + 圆角，**不加阴影**。
 *
 * 为什么不能加阴影（这是「好看」与「粗糙」的分界）：
 * 玻璃感来自「透出背后的内容」——底子越淡，背后透得越多，越像玻璃。
 * 加阴影、加高光边、把底调厚，反而会把它变成一块实心白牌子。
 * 参考实现（派音）全项目 0 处 shadow()，它的顶栏圆钮就是
 * `10% 白底 + 1px 纯白描边 + 圆角`，仅此而已。
 */
import { View, type ViewStyle, type StyleProp, StyleSheet } from 'react-native'
import { useTokens } from './useTokens'

export type GlassLevel = 'thin' | 'regular' | 'solid'

interface GlassProps {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  /** 圆角 */
  radius: number
  /**
   * 玻璃档位：
   * - `thin`（默认）最透一层：悬浮圆钮、下拉胶囊、迷你栏
   * - `regular` 中等厚度：卡片式浮层
   * - `solid` 更实一档：提示条（要保证文字可读）
   */
  level?: GlassLevel
  /** 深色玻璃（播放器控制区用）：底与描边都走白色系，与深浅模式无关 */
  dark?: boolean
  /** 是否画 1px 描边（默认画；压在深色封面上的层可关掉） */
  bordered?: boolean
}

/** 深色玻璃的两个字面量（与深浅模式无关，对应鸿蒙 FLOAT_FILL_DARK / EDGE_HIGHLIGHT_DARK） */
const FLOAT_FILL_DARK = '#FFFFFF19'
const EDGE_HIGHLIGHT_DARK = '#FFFFFF66'

export const Glass = ({
  children,
  style,
  radius,
  level = 'thin',
  dark = false,
  bordered = true,
}: GlassProps) => {
  const t = useTokens()

  let backgroundColor: string
  if (dark) {
    backgroundColor = FLOAT_FILL_DARK
  } else if (level === 'regular') {
    backgroundColor = t.glassTint
  } else if (level === 'solid') {
    backgroundColor = t.glassSolid
  } else {
    backgroundColor = t.glassFill
  }

  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor,
          overflow: 'hidden',
        },
        bordered && {
          borderWidth: StyleSheet.hairlineWidth < 1 ? 1 : 1,
          borderColor: dark ? EDGE_HIGHLIGHT_DARK : t.glassEdge,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/**
 * 玻璃层的样式片段（不需要包一层 View 时用，例如给已有的 TouchableOpacity 加玻璃底）
 *
 * 与 `<Glass>` 同一套取值，只是不产生额外节点。
 */
export const useGlassStyle = (
  radius: number,
  level: GlassLevel = 'thin',
  dark = false,
): ViewStyle => {
  const t = useTokens()
  const backgroundColor = dark
    ? FLOAT_FILL_DARK
    : level === 'regular'
      ? t.glassTint
      : level === 'solid'
        ? t.glassSolid
        : t.glassFill

  return {
    borderRadius: radius,
    backgroundColor,
    borderWidth: 1,
    borderColor: dark ? EDGE_HIGHLIGHT_DARK : t.glassEdge,
  }
}
