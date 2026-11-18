import { Appearance, NativeModules } from 'react-native'

/**
 * 潮汐界面当前主题的底色。
 *
 * 界面（WebView 里那套 HTML/CSS）每次换主题都会通过 `setBootBackground` 把这个色
 * 写进原生的 SharedPreferences；这里同步读回来，给 RN 自己的那两层上色：
 *   - `navigation.ts` 里 RNN 根视图的 componentBackgroundColor
 *   - `TideShell` 里 WebView 外面那层 View
 *
 * 为什么必须同步：这两处都在 setRoot / 首次 render 时就要定下来，
 * 异步取完再设已经晚了一帧，那一帧就是闪屏本身。
 *
 * 主题模式（light / dark / system）也要一起看：
 *   - 写死明暗时，存下来的颜色就是准的，直接用（皮肤色也在里面）。
 *   - 「跟随系统」时存的那份可能是过期的 —— 用户关机时把手机切成深色，
 *     存下来的还是浅色底，照它上色就会「深 → 浅 → 深」闪两下。
 *     这种情况按系统当前的深浅色取默认主题的底色（与 values-night 一致）。
 *
 * 读不到（模块还没初始化、旧版本没这个常量）就用潮汐默认主题的底色兜底。
 */
export const TIDE_BOOT_BG_DARK = '#0A0B0F'
export const TIDE_BOOT_BG_LIGHT = '#F4F5F8'
export const TIDE_BOOT_BG_FALLBACK = TIDE_BOOT_BG_DARK

export function getTideBootBackground(): string {
  try {
    const mod = (NativeModules as any)?.UtilsModule
    const mode = mod?.bootBgMode

    if (mode !== 'light' && mode !== 'dark') {
      const sys = Appearance.getColorScheme()
      if (sys === 'light') return TIDE_BOOT_BG_LIGHT
      if (sys === 'dark') return TIDE_BOOT_BG_DARK
      // 问不到系统深浅（极少见）：退回存下来的颜色，总比乱猜好
    }

    const value = mod?.bootBackground
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value
  } catch (e) {
    // 拿不到就兜底，不影响启动
  }
  return TIDE_BOOT_BG_FALLBACK
}

/**
 * 这个底色是深色吗？（决定状态栏图标用亮色还是暗色）
 *
 * HomeScreen 现在是在内核主题初始化**之前**推出来的（见 src/app.ts），
 * 那一刻 `themeState.theme` 还是默认的浅色。深色皮肤的用户如果照它取状态栏样式，
 * 启动时会看到「深色底 + 深色图标」（看不见）。而启动底色是从原生偏好同步读的、
 * 一定准确 —— 直接按它的亮度判断就没有这个时间差。
 */
export function isDarkColor(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return true
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  // 感知亮度（ITU-R BT.601 加权），128 是通用的明暗分界
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}
