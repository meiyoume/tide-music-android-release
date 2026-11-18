/**
 * 播放器的深色主题覆盖
 *
 * 鸿蒙的全屏播放器**恒为深色底**（`#0C0C0E`），与系统深浅模式无关 ——
 * 它是一层压在封面模糊图上的深色界面，歌词、控制钮、进度条全按深色设计
 * （见 HARMONY_UI_SPEC.md 3.1.7「系统级 / 特殊色」与 2.4）。
 *
 * 安卓版底座的播放器却是「跟着主题走」的：亮色模式下底色浅灰、文字深色。
 * 直接只把根容器刷成深色，里面那些深色文字就看不见了（亮色主题的 `c-font` 是深灰）。
 *
 * 所以这里**不是**只改一个背景色，而是给播放器子树套一层「深色主题」——
 * 通过覆盖 `ThemeContext`，让播放器里 19 个文件、14 个主题 token 一次性全部按深色取值，
 * 不用逐个文件去改（那样既容易漏，也会把上游代码改得面目全非）。
 *
 * 做法：拿当前主题，把「字色 / 底色 / 图标色」这一类语义 token 换成深色档。
 * 强调色（`c-primary*`）保留主题自己的值 —— 洛雪红在深底上正好看。
 */
import { useContext, useMemo } from 'react'
import { ThemeContext } from '@/store/theme/state'
import { PLAYER_TOKENS } from './tokens'

/**
 * 深色播放器里这些 token 要覆盖成什么
 *
 * 键取自底座主题里实际被播放器用到的那些（`c-font` / `c-font-label` / `c-300` 系列
 * / `c-button-font` 等），值取自鸿蒙播放器的白色梯度。
 */
const DARK_OVERRIDES: Record<string, string> = {
  // 主要文字（歌名、歌词当前行等）
  'c-font': PLAYER_TOKENS.text,
  'c-1000': PLAYER_TOKENS.text,
  // 次要文字（歌手、时间）
  'c-font-label': PLAYER_TOKENS.textSub,
  'c-450': PLAYER_TOKENS.textSub,
  'c-500': PLAYER_TOKENS.textSub,
  'c-550': PLAYER_TOKENS.textSub,
  // 更弱（未播放的歌词行）
  'c-300': PLAYER_TOKENS.textWeak,
  'c-350': PLAYER_TOKENS.textWeak,
  'c-400': PLAYER_TOKENS.textWeak,
  // 控制钮图标
  'c-button-font': '#FFFFFF',
  // 内容底色：播放器自己的深底，别再让内部组件铺浅色
  'c-content-background': PLAYER_TOKENS.bg,
  'c-main-background': PLAYER_TOKENS.bg,
  'c-app-background': PLAYER_TOKENS.bg,
}

/**
 * 把当前主题转成「播放器深色主题」
 *
 * 同时覆盖 `c-050`…`c-1000` 这一整条灰阶（底座的文字灰阶是 c-050 到 c-1000），
 * 否则播放器里用到 `c-200` 这类没显式列出的档位时又会退回亮色灰。
 */
const buildPlayerTheme = (theme: LX.ActiveTheme): LX.ActiveTheme => {
  const next: Record<string, unknown> = { ...theme, ...DARK_OVERRIDES, isDark: true }

  // 灰阶整体翻到深色侧：c-1000 最亮（主文字），c-050 最暗
  for (let i = 0; i <= 1000; i += 50) {
    const key = `c-${String(i).padStart(3, '0')}`
    // 把 0..1000 映射成「亮 → 暗」的白度：1000 最亮
    const ratio = i / 1000
    const alpha = 0.35 + ratio * 0.65
    next[key] = `rgba(255,255,255,${alpha.toFixed(2)})`
  }
  // 显式覆盖优先于灰阶扫描
  Object.assign(next, DARK_OVERRIDES)

  return next as unknown as LX.ActiveTheme
}

/** 取播放器专用主题（在播放器子树里当 `useTheme()` 的返回值用） */
export const usePlayerTheme = (): LX.ActiveTheme => {
  const theme = useContext(ThemeContext)
  return useMemo(() => buildPlayerTheme(theme), [theme])
}

export { ThemeContext as PlayerThemeContext }
export { buildPlayerTheme }
