/**
 * 底部渐隐蒙层（鸿蒙 `C_MASK_BOTTOM` 的 RN 版）
 *
 * 鸿蒙侧底部悬浮页签栏/迷你栏是**半透明玻璃**，内容会从它底下穿过；
 * 为了让穿过的内容「淡出」而不是糊在栏上，底部压一层「透明 → 页面底色」的渐隐。
 * token 就是 `C_MASK_BOTTOM`（亮 `#F1F1F266` / 暗 `#12121466`）。
 *
 * RN 没有内置线性渐变，这里用**阶梯式多层**逼近：N 层等高分块，每层 alpha 递增。
 * 12 层、总高 120dp 时肉眼已看不出台阶（每层 10dp、alpha 步进 ~5%）。
 */
import { memo, useMemo } from 'react'
import { View } from 'react-native'
import { useTokens } from './useTokens'

/** 把 `#RRGGBBAA` 拆成 rgba(r,g,b,a) */
const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

interface BottomFadeProps {
  /** 总高度 */
  height?: number
  /** 分几层（越多越平滑） */
  layers?: number
  /** 最下面那层的最大 alpha（0–1）。默认取 maskBottom 自带的 alpha */
  maxAlpha?: number
  /**
   * 底部「实底」区高度
   *
   * 悬浮栏之间有 8dp 的缝，缝里会露出背后的列表内容 —— 只靠渐隐（最底 92%）
   * 仍然看得见。所以最底部这一段直接铺**不透明的页面底色**，
   * 高度盖住「栏离底距离 + 栏高」，两条栏的缝里就是干净的底色。
   */
  solidHeight?: number
}

export const BottomFade = memo(({
  height = 120,
  layers = 12,
  maxAlpha,
  solidHeight = 0,
}: BottomFadeProps) => {
  const t = useTokens()

  // maskBottom 形如 #RRGGBBAA，末两位是 alpha
  const tokenAlpha = useMemo(() => {
    const h = t.maskBottom.replace('#', '')
    if (h.length === 8) return parseInt(h.slice(6, 8), 16) / 255
    return 0.4
  }, [t.maskBottom])

  const top = maxAlpha ?? tokenAlpha
  const fadeHeight = Math.max(0, height - solidHeight)
  const layerHeight = fadeHeight / layers

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}
    >
      {Array.from({ length: layers }, (_, i) => {
        // i=0 是最上面那层（最淡），i=layers-1 是最下面（最浓）
        const alpha = (top * (i + 1)) / layers
        return (
          <View
            key={i}
            style={{
              height: layerHeight,
              backgroundColor: withAlpha(t.bg, alpha),
            }}
          />
        )
      })}
      {/* 最底部实底：盖住两条栏之间的缝，别让列表文字从缝里露出来 */}
      {solidHeight > 0 && (
        <View style={{ height: solidHeight, backgroundColor: t.bg }} />
      )}
    </View>
  )
})
