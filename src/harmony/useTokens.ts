/**
 * 洛雪 token 的 React hook
 *
 * `useTokens()` 跟随当前主题的深浅模式（`useTheme()` 给的 ActiveTheme 里带 `isDark`），
 * 组件里直接拿 `t.bg` / `t.red` 这样用，切深浅模式会自动重渲染。
 *
 * 还会订阅潮汐界面推来的调色板（`setTidePalette`）：界面换皮肤 / 换主题色 /
 * 切深浅时，原生子页面的颜色跟着一起换 —— 不然就是「界面一套色、原生页另一套色」
 * 的割裂感（用户反馈过）。
 */
import { useEffect, useState } from 'react'
import { useTheme } from '@/store/theme/hook'
import { getTokens, subscribeTokens, type LxTokens } from './tokens'

export const useTokens = (): LxTokens => {
  const theme = useTheme()
  const [, bump] = useState(0)
  useEffect(() => subscribeTokens(() => { bump(v => v + 1) }), [])
  return getTokens(!!theme.isDark)
}

export type { LxTokens }
