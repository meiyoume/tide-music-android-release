/**
 * 封面（鸿蒙 `ui/Widgets.ets` 的 `CoverArt` / `HeartCover` 的 RN 版）
 *
 * 鸿蒙侧有三种画法，按「有没有真封面」与「要不要洛雪那颗黑心占位」分：
 *   1. `HeartCover` —— 洛雪在封面加载出来之前用的黑色占位（黑底 + 白心 + 三颗金点）
 *   2. `CoverArt`   —— 有真封面画真封面，没有就用「按歌名 hash 取的渐变块 + 首字母」
 *   3. 迷你栏那颗   —— 淡圆底 + 应用图标兜底（不露黑底，避免切页签时先黑一下）
 *
 * 这里把三种合成一个组件，用 `variant` 选。
 */
import { memo, useMemo, useState } from 'react'
import { View, Text, Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useTokens } from './useTokens'
import { LxIcon } from './LxIcon'

/**
 * 占位封面配色（没有真实封面图时用）：按歌名 hash 循环取
 *
 * ⚠️ 这里**故意没有照搬**鸿蒙侧那套深色（`#2B2B33` / `#141417` 等近黑）。
 * 用户实测反馈：「加载不出来的时候黑色图标很难看，要改了」。
 *
 * 原因：鸿蒙那套近黑占位是给**深色为主的播放页 / 黑胶风列表**配的；
 * 而这个移植版的主界面是**浅灰底 + 纯白卡片**，一片片近黑方块铺在浅灰上
 * 非常突兀（截图里就是一排黑方块 + 白字）。所以改成同一色系的**明亮渐变**：
 * 取的是洛雪红与几个辅助色的浅色档，放在浅灰底上像正常的专辑色块。
 *
 * 若将来要回退成鸿蒙那套深色，把下面注释掉的那组替换回来即可。
 */
const PALETTES: string[][] = [
  ['#FF8A8A', '#E33B3B'], // 洛雪红
  ['#FFB27A', '#E86A2B'], // 橙
  ['#7FB6FF', '#3B7BD9'], // 蓝
  ['#8AD9A8', '#2F9E5B'], // 绿
  ['#C2A2FF', '#7A4FD9'], // 紫
  ['#FF9EC4', '#D9468A'], // 粉
]

/** 鸿蒙侧原本那套近黑占位（保留备查，当前不用） */
// const PALETTES_DARK: string[][] = [
//   ['#2B2B33', '#141417'],
//   ['#3A2E1E', '#191410'],
//   ['#1B2A33', '#0E1519'],
//   ['#2E2233', '#150F19'],
//   ['#33241F', '#1A1210'],
//   ['#1F2E24', '#101813'],
// ]

/** 与鸿蒙侧同一个 hash：sum = (sum*31 + charCode) % 9973 */
const paletteOf = (name: string): string[] => {
  let sum = 0
  for (let i = 0; i < name.length; i++) {
    sum = (sum * 31 + name.charCodeAt(i)) % 9973
  }
  return PALETTES[sum % PALETTES.length]
}

const initialsOf = (name: string): string => {
  const trimmed = name.trim()
  return trimmed.length === 0 ? '' : trimmed.substring(0, 1)
}

/** 与尺寸无关的固定样式，提到模块级避免每次 render 新建 */
const styles = StyleSheet.create({
  box: { overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  paletteLayer: { justifyContent: 'center', alignItems: 'center' },
  center: { justifyContent: 'center', alignItems: 'center' },
})

interface CoverArtProps {
  /** 封面地址（空串 / null = 没有真封面） */
  url?: string | null
  /** 歌名（取首字母与配色用） */
  name?: string
  /** 边长 */
  size: number
  /** 圆角（默认 R_COVER = 12；圆封面传 size/2） */
  radius?: number
  /**
   * 兜底画法：
   * - `palette`（默认）渐变块 + 首字母
   * - `heart` 洛雪那颗黑心占位
   * - `icon` 淡圆底 + 音符（迷你栏用，不露黑底）
   */
  fallback?: 'palette' | 'heart' | 'icon'
  style?: StyleProp<ViewStyle>
}

export const CoverArt = memo(({
  url,
  name = '',
  size,
  radius = 12,
  fallback = 'palette',
  style,
}: CoverArtProps) => {
  const t = useTokens()
  const [failed, setFailed] = useState(false)
  const showImage = !!url && !failed

  // 只依赖 name：不缓存的话，长列表里每一行每次重渲染都要重跑一遍 hash 循环
  const palette = useMemo(() => paletteOf(name), [name])
  const initials = useMemo(() => initialsOf(name), [name])

  const boxStyle = useMemo(() => [
    styles.box,
    {
      width: size,
      height: size,
      borderRadius: radius,
      // 兜底底色：跟随主题的浅一档填充。
      // **不再用近黑 `#1C1C1E`** —— 浅灰底的主界面上，一片黑方块很突兀
      // （用户反馈「加载不出来的时候黑色图标很难看」）。
      // 真封面加载失败时露出的是下面那层明亮渐变，这里只是渐变之外的缝隙。
      backgroundColor: fallback === 'icon' ? t.iconCircle : t.fillSoftStrong,
    },
    style,
  ], [size, radius, fallback, t.iconCircle, t.fillSoftStrong, style])

  const paletteLayerStyle = useMemo(
    () => [StyleSheet.absoluteFill, styles.paletteLayer, { backgroundColor: palette[0] }],
    [palette],
  )
  const paletteOverlayStyle = useMemo(
    () => [StyleSheet.absoluteFill, { backgroundColor: palette[1], opacity: 0.55 }],
    [palette],
  )
  const initialStyle = useMemo(
    () => ({ fontSize: size * 0.4, fontWeight: '700' as const, color: '#FFFFFFD9' }),
    [size],
  )
  const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: radius }), [size, radius])
  const imageSource = useMemo(() => ({ uri: url ?? '' }), [url])

  return (
    <View style={boxStyle}>
      {/* 兜底层：真封面加载失败或没有时露出来的就是它 */}
      {fallback === 'palette' && (
        <View style={paletteLayerStyle}>
          {/* 用第二档色做一个下压渐变感的色块（RN 无内置渐变，用半透明覆盖近似） */}
          <View style={paletteOverlayStyle} />
          <Text style={initialStyle}>{initials}</Text>
        </View>
      )}

      {fallback === 'heart' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0B' }]}>
          {/* 三颗金点 */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: size * 0.045,
              marginTop: size * 0.5 - size * 0.27,
            }}
          >
            <View style={{ width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06, backgroundColor: '#C9A227' }} />
            <View style={{ width: size * 0.17, height: size * 0.17, borderRadius: size * 0.085, backgroundColor: '#E2BB3C' }} />
            <View style={{ width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06, backgroundColor: '#C9A227' }} />
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: size * 0.5 - size * 0.31 + size * 0.05, alignItems: 'center' }}>
            <LxIcon name="heartFill" size={size * 0.62} color="#F4F4F6" />
          </View>
        </View>
      )}

      {fallback === 'icon' && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.iconCircle }]}>
          <LxIcon name="disc" size={size * 0.6} color={t.textSub} />
        </View>
      )}

      {/* 真封面 */}
      {showImage && (
        <Image
          source={imageSource}
          style={imageStyle}
          resizeMode="cover"
          onError={() => { setFailed(true) }}
        />
      )}
    </View>
  )
})
