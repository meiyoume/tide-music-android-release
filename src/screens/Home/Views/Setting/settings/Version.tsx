import { memo, useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import Section from '../components/Section'
import SubTitle from '../components/SubTitle'
import Button from '../components/Button'
import { sizeFormate } from '@/utils'

import { useI18n } from '@/lang'
import { useVersionDownloadProgressUpdated, useVersionInfo } from '@/store/version/hook'
import Text from '@/components/common/Text'
import { showModal } from '@/core/version'

const currentVer = process.versions.app
export default memo(() => {
  const t = useI18n()
  const versionInfo = useVersionInfo()
  // const versionStatus = useVrsionUpdateStatus()
  const [title, setTitle] = useState('')
  const [tip, setTip] = useState('')
  const progress = useVersionDownloadProgressUpdated()
  const handleOpenVersionModal = () => {
    // setVersionInfo({ showModal: true })
    showModal()
  }

  useEffect(() => {
    if (versionInfo.isLatest) {
      setTitle(t('version_tip_latest'))
      setTip('')
    } else if (versionInfo.isUnknown) {
      setTitle(t('version_title_unknown'))
      setTip(t('version_tip_unknown'))
    } else {
      switch (versionInfo.status) {
        case 'downloading':
          setTitle(t('version_title_new'))
          setTip(t('version_btn_downloading', {
            total: sizeFormate(progress.total),
            current: sizeFormate(progress.current),
            progress: progress.total ? (progress.current / progress.total * 100).toFixed(2) : '0',
          }))
          break
        case 'downloaded':
          setTitle(t('version_title_update'))
          setTip('')
          break
        case 'checking':
          setTitle(t('version_title_checking'))
          setTip('')
          break
        case 'error':
          setTitle(t('version_title_failed'))
          setTip(t('version_tip_failed'))
          break
        // 本移植版启动不自动检查更新，所以「进来就是 idle」有两种情况，要分开：
        //   从没检查过（newVersion 还是 null）→ 提示可以手动检查；
        //   手动检查过了、而且发现了新版本（status 会回到 idle，isLatest=false）→ 照上游显示「发现新版本」。
        case 'idle':
          if (versionInfo.newVersion) {
            setTitle(t('version_title_new'))
            setTip('')
          } else {
            setTitle(t('version_title_idle'))
            setTip(t('version_tip_idle'))
          }
          break
        default:
          setTitle(t('version_title_new'))
          setTip('')
          break
      }
    }
  }, [t, versionInfo, progress])

  return (
    <Section title={t('setting_version')}>
      <SubTitle title={title}>
        <View style={styles.desc}>
          {
            // 没检查过 / 检查失败时 newVersion 是 null 或 0.0.0，显示出来只会让人困惑
            versionInfo.newVersion && !versionInfo.isUnknown
              ? <Text size={14}>{t('version_label_latest_ver')}{versionInfo.newVersion.version}</Text>
              : null
          }
          <Text size={14}>{t('version_label_current_ver')}{currentVer}</Text>
          {
            tip ? <Text size={14}>{tip}</Text> : null
          }
        </View>
        <View style={styles.btn}>
          <Button onPress={handleOpenVersionModal}>{t('setting_version_show_ver_modal')}</Button>
        </View>
      </SubTitle>
    </Section>
  )
})

const styles = StyleSheet.create({
  desc: {
    marginBottom: 8,
  },
  btn: {
    flexDirection: 'row',
  },
})
