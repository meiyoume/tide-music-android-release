import { memo } from 'react'

import { View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useTokens } from '@/harmony/useTokens'
import { SET_GROUP_GAP, SET_LABEL_SIZE, SET_LABEL_TRACK } from '@/harmony/tokens'
import Text from '@/components/common/Text'

/**
 * 设置子页里的小分组标题
 *
 * 鸿蒙壳层开启时用潮汐界面那套（12px / 600 / 字距 .03em / 浅灰，见 Section.tsx 的说明），
 * 否则退回原样式。
 */
export default memo(({ title, children }: {
  title: string
  children: React.ReactNode | React.ReactNode[]
}) => {
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()

  if (harmonyShell) {
    return (
      <View style={harmonyStyles.container}>
        <Text style={[harmonyStyles.title, { color: t.textWeak }]}>{title}</Text>
        {children}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  )
})


const styles = createStyle({
  container: {
    paddingLeft: 25,
    marginBottom: 18,
  },
  title: {
    marginLeft: -10,
    marginBottom: 10,
    // lineHeight: 16,
  },
})

/** 潮汐形态：与 Section 的分组标题同一套取值（见 Section.tsx 的说明） */
const harmonyStyles = createStyle({
  container: {
    marginBottom: SET_GROUP_GAP,
  },
  title: {
    fontSize: SET_LABEL_SIZE,
    fontWeight: '600',
    letterSpacing: SET_LABEL_TRACK,
    paddingLeft: 4,
    paddingRight: 4,
    paddingBottom: 8,
  },
})
