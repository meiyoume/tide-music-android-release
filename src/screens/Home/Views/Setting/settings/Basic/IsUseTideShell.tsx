import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'


import CheckBoxItem from '../../components/CheckBoxItem'

/**
 * 使用潮汐界面（WebView 壳层）
 *
 * 界面是纯 HTML/CSS/JS，放在 `android/app/src/main/assets/tide/`，
 * 由 WebView 承载；播放、音源、榜单、歌单、歌词全部走内核现成接口。
 *
 * 优先级：潮汐 > 鸿蒙 > 安卓原版。关掉这一个会退回鸿蒙壳层，
 * 两个都关才回到洛雪安卓版原界面 —— 界面出问题时不用改代码就能逐级退回。
 *
 * 标签直接写中文而不是走 i18n：加一个语言键要动 lang/ 下十几个语言文件，
 * 而这一项只对本工程有意义。
 */
export default memo(() => {
  const tideShell = useSettingValue('tideShell')
  const setTideShell = (tideShell: boolean) => {
    updateSetting({ tideShell })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={tideShell} label="使用潮汐界面（WebView）" onChange={setTideShell} />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
