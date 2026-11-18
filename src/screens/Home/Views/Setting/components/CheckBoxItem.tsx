import { memo, useCallback } from 'react'

import { View, Text as RNText, TouchableOpacity } from 'react-native'

import CheckBox, { type CheckBoxProps } from '@/components/common/CheckBox'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useTokens } from '@/harmony/useTokens'
import TideSwitch from '@/harmony/TideSwitch'
import { SET_ROW_MIN_H, SET_ROW_PAD_X, SET_ROW_PAD_Y, SET_ROW_SIZE } from '@/harmony/tokens'

/**
 * 设置项（勾选 / 开关）
 *
 * 两种形态：
 *   - **鸿蒙壳层开启**：整行 = 文字 + 右侧开关，版式对齐潮汐界面的 `.s-row`
 *     （最小高 54 / 内边距 12×16 / 字号 14.5），开关用 `TideSwitch`
 *     （48×29 胶囊 + 23px 白钮，与界面 `.switch` 一致）。
 *   - 关掉壳层：退回安卓版原样式（方框勾选）。
 *
 * 为什么不直接用 RN 的 `Switch`：Android 上是原生 SwitchCompat（约 36×20），
 * 形状与界面那套对不上，详见 `@/harmony/TideSwitch`。
 *
 * 为什么改共享组件而不是逐个设置项改：设置树里有 35 个文件、75 处引用，
 * 逐个改既容易漏也会把上游代码改烂；改这一个即可全覆盖，且开关一关就回退。
 */
export default memo((props: CheckBoxProps) => {
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()

  const handleToggle = useCallback(() => {
    props.onChange(!props.check)
  }, [props])

  if (harmonyShell) {
    // 潮汐的开关行：文字在左、开关在右，整行可点
    const label = props.label ?? props.children
    return (
      <TouchableOpacity
        style={harmonyStyles.row}
        activeOpacity={0.6}
        onPress={handleToggle}
        disabled={props.disabled}
      >
        <View style={harmonyStyles.labelWrap}>
          {typeof label === 'string'
            ? <RNText style={[harmonyStyles.label, { color: props.disabled ? t.textWeak : t.text }]}>{label}</RNText>
            : label}
        </View>
        <TideSwitch
          value={!!props.check}
          onValueChange={props.onChange}
          disabled={props.disabled}
        />
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <CheckBox {...props} />
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingLeft: 25,
    // marginTop: -10,
    // marginBottom: 0,
  },
})

/** 潮汐形态：整行 + 右侧开关（版式抄界面 `.s-row`） */
const harmonyStyles = createStyle({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SET_ROW_MIN_H,
    paddingLeft: SET_ROW_PAD_X,
    paddingRight: SET_ROW_PAD_X,
    paddingTop: SET_ROW_PAD_Y,
    paddingBottom: SET_ROW_PAD_Y,
  },
  labelWrap: {
    flex: 1,
    paddingRight: 12,
  },
  label: {
    fontSize: SET_ROW_SIZE,
    lineHeight: 21,
  },
})
