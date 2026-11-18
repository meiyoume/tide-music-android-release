import { memo } from 'react'

import Button, { type BtnProps } from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTokens } from '@/harmony/useTokens'
import { createStyle } from '@/utils/tools'

type ButtonProps = BtnProps

/**
 * 设置页里的按钮（「导入」「导出」「重置」这类）
 *
 * 潮汐壳层开着时用界面那套胶囊：强调色淡底 + 强调色文字（对应界面 `.btn--ghost`
 * 与 `.navbar__action` 的观感）。关掉壳层退回安卓版原样式。
 *
 * 上一版这里**完全没有分支**，一直吃的是内核主题（`theme['c-button-background']`），
 * 所以哪怕调色板推过来了，卡片里这颗按钮还是老配色 —— 也是「原生设置没变化」的一部分。
 */
export default memo(({ disabled, onPress, children }: ButtonProps) => {
  const theme = useTheme()
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()

  if (harmonyShell) {
    return (
      <Button style={{ ...styles.button, ...styles.pill, backgroundColor: t.redTint }} onPress={onPress} disabled={disabled}>
        <Text size={13} color={t.red}>{children}</Text>
      </Button>
    )
  }

  return (
    <Button style={{ ...styles.button, backgroundColor: theme['c-button-background'] }} onPress={onPress} disabled={disabled}>
      <Text size={14} color={theme['c-button-font']}>{children}</Text>
    </Button>
  )
})

const styles = createStyle({
  button: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 4,
    marginRight: 10,
  },
  /** 潮汐形态：胶囊（界面 `.btn` 的圆角是 99） */
  pill: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 99,
  },
})
