import { useEffect, useMemo, useState } from 'react'
import { ScrollView, TouchableOpacity } from 'react-native'

import { createStyle } from '@/utils/tools'
import { type SearchType } from '@/store/search/state'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { getSearchSetting } from '@/utils/data'
import { BorderWidths } from '@/theme'

/**
 * 搜索结果类型
 *
 * 移植版把 `both`（综合）放在**第一位**并作为默认值：一次同时搜歌曲与歌单，
 * 结果左右并排（左歌曲 / 右歌单）。见 `List.tsx` 与 `Search/index.tsx`。
 */
const SEARCH_TYPE_LIST = [
  'both',
  'music',
  'songlist',
] as const

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [type, setType] = useState<SearchType>('both')

  useEffect(() => {
    void getSearchSetting().then(info => {
      setType(info.type)
    })
  }, [])

  const list = useMemo(() => {
    return SEARCH_TYPE_LIST.map(type => ({ label: t(`search_type_${type}`), id: type }))
  }, [t])

  const handleTypeChange = (type: SearchType) => {
    setType(type)
    global.app_event.searchTypeChanged(type)
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps={'always'} horizontal={true}>
      {
        list.map(t => (
          <TouchableOpacity style={styles.button} onPress={() => { handleTypeChange(t.id) }} key={t.id}>
            <Text style={{ ...styles.buttonText, borderBottomColor: type == t.id ? theme['c-primary-background-active'] : 'transparent' }} color={type == t.id ? theme['c-primary-font-active'] : theme['c-font']}>{t.label}</Text>
          </TouchableOpacity>
        ))
      }
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    height: '100%',
    flexGrow: 0,
    flexShrink: 1,
    // paddingLeft: 5,
    // paddingRight: 5,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  button: {
    // height: 38,
    // lineHeight: 38,
    justifyContent: 'center',
    paddingLeft: 8,
    paddingRight: 8,
    // width: 80,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  buttonText: {
    // height: 38,
    // lineHeight: 38,
    textAlign: 'center',
    paddingLeft: 2,
    paddingRight: 2,
    // paddingTop: 10,
    paddingTop: 3,
    paddingBottom: 3,
    borderBottomWidth: BorderWidths.normal3,
    // width: 80,
  },
})
