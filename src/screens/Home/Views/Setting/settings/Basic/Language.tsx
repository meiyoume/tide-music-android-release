import { memo, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import type { I18n } from '@/lang'
import { useI18n, langList } from '@/lang'
import { setLanguage } from '@/core/common'
import { markLangUserChosen } from '@/core/init/i18n'
import { useSettingValue } from '@/store/setting/hook'

const useActive = (id: I18n['locale']) => {
  const activeLangId = useSettingValue('common.langId')
  const isActive = useMemo(() => activeLangId == id, [activeLangId, id])
  return isActive
}

const Item = ({ id, name }: {
  id: I18n['locale']
  name: string
}) => {
  const isActive = useActive(id)
  // const [toggleCheckBox, setToggleCheckBox] = useState(false)
  return <CheckBox marginRight={8} check={isActive} label={name} onChange={() => {
    // 记下「这是用户主动选的」：否则英文系统上会被启动逻辑按「非主动选择」纠正回中文
    markLangUserChosen()
    setLanguage(id)
  }} need />
}

export default memo(() => {
  const t = useI18n()

  return (
    <SubTitle title={t('setting_basic_lang')}>
      <View style={styles.list}>
        {
          langList.map(({ locale, name }) => <Item name={name} id={locale} key={locale} />)
        }
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
