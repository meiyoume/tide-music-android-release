/**
 * 潮汐版开关（48×29 胶囊 + 23px 白色圆钮），照抄 Web 界面 `styles.css` 的 `.switch`
 *
 * 为什么不用 RN 自带的 `Switch`：Android 上它是原生 `SwitchCompat`（约 36×20），
 * 圆角、尺寸、按压涟漪都对不上；用 `transform: scale` 拉大会把圆钮压成椭圆
 * （横竖缩放比例不同），越看越不像。
 *
 * 自己拼两个 View 就能精确对上界面，还能跟着界面推来的主题色走（`t.red` 就是
 * 界面推过来的那个 accent，见 tokens.ts 的 setTidePalette）。
 */
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet } from 'react-native'
import { useTokens } from './useTokens'
import { SET_SWITCH_H, SET_SWITCH_KNOB, SET_SWITCH_PAD, SET_SWITCH_W } from './tokens'

interface Props {
  value: boolean
  onValueChange?: (value: boolean) => void
  disabled?: boolean
}

/** 与界面那边 `.switch` 的 `--t3`（.2s）同档 */
const DURATION = 180

/** 圆钮要走的距离：48 - 23 - 3×2 = 19（与界面 `.switch.is-on::after` 的 translateX 一致） */
const TRAVEL = SET_SWITCH_W - SET_SWITCH_KNOB - SET_SWITCH_PAD * 2

export default memo(({ value, onValueChange, disabled }: Props) => {
  const t = useTokens()
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current
  const mounted = useRef(false)

  useEffect(() => {
    /* 首帧不要动画：列表刚画出来时每个开关都从「关」滑到自己的位置，很乱 */
    if (!mounted.current) {
      mounted.current = true
      return
    }
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: DURATION,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      // 轨道底色也要一起插值，颜色不能走原生驱动
      useNativeDriver: false,
    }).start()
  }, [value, anim])

  return (
    <Pressable
      onPress={() => { if (!disabled) onValueChange?.(!value) }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Animated.View
        style={[styles.track, {
          backgroundColor: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [t.fillSoftStrong, t.red],
          }),
        }]}
      >
        <Animated.View
          style={[styles.knob, {
            transform: [{
              translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }),
            }],
          }]}
        />
      </Animated.View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  track: {
    width: SET_SWITCH_W,
    height: SET_SWITCH_H,
    borderRadius: SET_SWITCH_H / 2,
    padding: SET_SWITCH_PAD,
  },
  knob: {
    width: SET_SWITCH_KNOB,
    height: SET_SWITCH_KNOB,
    borderRadius: SET_SWITCH_KNOB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
})
