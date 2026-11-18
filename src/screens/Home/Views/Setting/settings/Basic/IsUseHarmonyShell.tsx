import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'


import CheckBoxItem from '../../components/CheckBoxItem'

/**
 * 使用鸿蒙移植版界面（悬浮玻璃页签栏 + 迷你播放栏）
 *
 * 关掉即退回洛雪安卓版原界面（顶栏 + 抽屉 + 普通 TabBar）。
 * 这是本次 UI 移植的回退保险：界面出问题时不用改代码就能退回原版。
 */
export default memo(() => {
  const t = useI18n()
  const harmonyShell = useSettingValue('harmonyShell')
  const setHarmonyShell = (harmonyShell: boolean) => {
    updateSetting({ harmonyShell })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={harmonyShell} label={t('setting_harmony_shell')} onChange={setHarmonyShell} />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
    // marginBottom: 15,
  },
})
