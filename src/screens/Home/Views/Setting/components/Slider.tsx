
import { memo } from 'react'

import Slider, { type SliderProps } from '@react-native-community/slider'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTokens } from '@/harmony/useTokens'
import { createStyle } from '@/utils/tools'

export type {
  SliderProps,
}

/**
 * 设置页里的滑块
 *
 * 潮汐壳层开着时配色跟界面走：轨道用界面那两级填充色、滑块用强调色
 * （界面里 `.slider` / 播放页进度条就是这个关系）。关掉壳层退回内核主题配色。
 *
 * 与 Button / InputItem 一样，上一版这里没有分支 —— 调色板推过来了，
 * 滑块却还是内核那套配色，是「原生设置没变化」里最显眼的一处。
 */
export default memo(({ value, minimumValue, maximumValue, onSlidingStart, onSlidingComplete, onValueChange, step }: SliderProps) => {
  const theme = useTheme()
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()

  return (
    <Slider
      value={value}
      style={styles.slider}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      minimumTrackTintColor={harmonyShell ? t.red : theme['c-button-background-active']}
      maximumTrackTintColor={harmonyShell ? t.fillSoftStrong : theme['c-button-background']}
      thumbTintColor={harmonyShell ? t.red : theme['c-primary-light-100']}
      onSlidingStart={onSlidingStart}
      onSlidingComplete={onSlidingComplete}
      onValueChange={onValueChange}
      step={step}
    />
  )
})


const styles = createStyle({
  slider: {
    flexShrink: 0,
    flexGrow: 1,
    // width: '100%',
    maxWidth: 300,
    height: 40,
    marginTop: -6,
  },
})
