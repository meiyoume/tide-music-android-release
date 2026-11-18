/**
 * 图标（鸿蒙 `ui/Icons.ets` 的 `IconGlyph` 的 RN 版）
 *
 * 鸿蒙用系统符号库（`SymbolGlyph` + `sys.symbol.xxx`），RN 用 MaterialCommunityIcons，
 * 语义映射表见 `./icons`。
 */
import { memo } from 'react'
import { ICONS, MaterialCommunityIcons, type IconName } from './icons'
import { useTokens } from './useTokens'

interface LxIconProps {
  /** 语义名（见 `./icons` 的 ICONS） */
  name: IconName
  size?: number
  color?: string
  style?: React.ComponentProps<typeof MaterialCommunityIcons>['style']
}

export const LxIcon = memo(({ name, size = 20, color, style }: LxIconProps) => {
  const t = useTokens()
  return (
    <MaterialCommunityIcons
      name={ICONS[name]}
      size={size}
      color={color ?? t.icon}
      style={style}
    />
  )
})

export { ICONS }
export type { IconName }
