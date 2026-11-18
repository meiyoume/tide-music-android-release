import { memo, useCallback, useEffect, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Slider from '../../components/Slider'
import CheckBox from '@/components/common/CheckBox'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { useSoundEffectState } from '@/store/soundEffect/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { applySoundEffect, refreshSoundEffectStatus } from '@/core/soundEffect'

/**
 * 设备预设是英文名（安卓系统那套），映射到 i18n 文案；映射不到就原样显示英文。
 * 这套预设是系统效果库给的，各机型基本一致：标准 / 古典 / 舞曲 / 原声 / 民谣 /
 * 重金属 / 嘻哈 / 爵士 / 流行 / 摇滚。
 *
 * 接在它们后面的开源曲线（`经典·重低音` / `耳机·索尼 WH-1000XM4` …）没有对应的 i18n 键，
 * 会走 `presetKeyOf` 返回 undefined 的那条路原样显示 —— 这正是想要的。
 */
// `as const` 是必需的：i18n 的 t() 只接受字面量键的联合类型，宽化成 string 会报类型错
const PRESET_KEYS = {
  normal: 'sound_effect_preset_normal',
  classical: 'sound_effect_preset_classical',
  dance: 'sound_effect_preset_dance',
  flat: 'sound_effect_preset_flat',
  folk: 'sound_effect_preset_folk',
  'heavy metal': 'sound_effect_preset_heavy_metal',
  'hip hop': 'sound_effect_preset_hip_hop',
  jazz: 'sound_effect_preset_jazz',
  pop: 'sound_effect_preset_pop',
  rock: 'sound_effect_preset_rock',
} as const

/** 设备给的英文预设名 → 本地化文案；认不出来就原样显示英文 */
const presetKeyOf = (name: string) => PRESET_KEYS[String(name).toLowerCase() as keyof typeof PRESET_KEYS]

/**
 * 环境混响的可选档位。系统 PresetReverb 一共 7 档
 * （0=关 / 小房间 / 中房间 / 大房间 / 中厅 / 大厅 / 金属板），这里把「中厅」省掉让列表短一点。
 * 界面侧还有一份一样的表（music-ui-mobile/app.js），改这里记得一起改。
 */
const REVERB_OPTIONS = [
  { value: 0, key: 'sound_effect_off' },
  { value: 1, key: 'sound_effect_reverb_small' },
  { value: 2, key: 'sound_effect_reverb_medium' },
  { value: 3, key: 'sound_effect_reverb_large' },
  { value: 5, key: 'sound_effect_reverb_hall' },
  { value: 6, key: 'sound_effect_reverb_plate' },
] as const

const Item = ({ preset, name }: { preset: number, name: string }) => {
  const current = useSettingValue('player.soundEffectPreset')
  const isActive = useMemo(() => current === preset, [current, preset])
  const handleChange = useCallback(() => {
    updateSetting({ 'player.soundEffectPreset': preset })
    void applySoundEffect()
  }, [preset])
  return <CheckBox marginBottom={3} check={isActive} label={name} onChange={handleChange} need />
}

const Strength = ({ label, settingKey }: { label: string, settingKey: 'player.soundEffectBassBoost' | 'player.soundEffectVirtualizer' | 'player.soundEffectLoudness' }) => {
  const t = useI18n()
  const value = useSettingValue(settingKey)
  const handleChange = useCallback((next: number) => {
    updateSetting(settingKey === 'player.soundEffectBassBoost'
      ? { 'player.soundEffectBassBoost': next }
      : settingKey === 'player.soundEffectVirtualizer'
        ? { 'player.soundEffectVirtualizer': next }
        : { 'player.soundEffectLoudness': next })
    void applySoundEffect()
  }, [settingKey])
  return (
    <>
      <View style={styles.row}>
        <Text size={14}>{label}</Text>
        <Text size={13} color="rgba(128,128,128,1)">{value > 0 ? `${Math.round(value / 10)}%` : t('sound_effect_off')}</Text>
      </View>
      <Slider
        value={value}
        minimumValue={0}
        maximumValue={1000}
        step={100}
        onSlidingComplete={handleChange}
      />
    </>
  )
}

/** 环境混响：一排单选，0 = 关 */
const Reverb = () => {
  const t = useI18n()
  const current = useSettingValue('player.soundEffectReverb')
  return (
    <>
      <View style={styles.row}>
        <Text size={14}>{t('sound_effect_reverb')}</Text>
      </View>
      <View style={styles.list}>
        {
          REVERB_OPTIONS.map(({ value, key }) => (
            <ReverbItem key={value} value={value} label={t(key)} active={current === value} />
          ))
        }
      </View>
    </>
  )
}

const ReverbItem = ({ value, label, active }: { value: number, label: string, active: boolean }) => {
  const handleChange = useCallback(() => {
    updateSetting({ 'player.soundEffectReverb': value })
    void applySoundEffect()
  }, [value])
  return <CheckBox marginBottom={3} check={active} label={label} onChange={handleChange} need />
}

export default memo(() => {
  const t = useI18n()
  const info = useSoundEffectState()
  const enabled = useSettingValue('player.soundEffectEnabled')

  // 进设置页时取一次设备能力（预设列表）
  useEffect(() => {
    void refreshSoundEffectStatus()
  }, [])

  const presetList = useMemo(() => {
    return info.presets.map(({ index, name }) => {
      const key = presetKeyOf(name)
      return { index, name: key ? t(key) : name }
    })
  }, [info.presets, t])

  const handleToggle = useCallback((next: boolean) => {
    updateSetting({ 'player.soundEffectEnabled': next })
    void applySoundEffect()
  }, [])

  // 还没开始播放时拿不到播放会话，但预设列表仍然列得出来（原生侧会临时读一次）。
  // 这种情况下让用户照常选，选完等播放开始由原生侧自动挂上。
  //
  // 注意这里判的是**设备预设**（devicePresets）而不是合并后的 presets：
  // 开源曲线是本地常量，永远不为空，拿它判会导致「设备根本没有效果库」时也列出一堆
  // 选了没反应的项。设备预设为空 = 这台机器没有可用的均衡器。
  const canConfigure = info.available || info.devicePresets.length > 0

  return (
    <SubTitle title={t('setting_basic_sound_effect')}>
      <CheckBox marginBottom={3} check={enabled} label={t('sound_effect_enable')} onChange={handleToggle} need />
      {
        !info.loaded
          ? null
          : !canConfigure
              ? <Text size={13} color="rgba(128,128,128,1)">{info.reason || t('sound_effect_unavailable')}</Text>
              : (
              <>
                {
                  !info.available
                    ? <Text size={13} color="rgba(128,128,128,1)">{t('sound_effect_need_play')}</Text>
                    : null
                }
                <View style={styles.list}>
                  <Item preset={-1} name={t('sound_effect_off')} />
                  {
                    presetList.map(({ index, name }) => <Item key={index} preset={index} name={name} />)
                  }
                </View>
                <Strength label={t('sound_effect_bass_boost')} settingKey="player.soundEffectBassBoost" />
                <Strength label={t('sound_effect_virtualizer')} settingKey="player.soundEffectVirtualizer" />
                <Strength label={t('sound_effect_loudness')} settingKey="player.soundEffectLoudness" />
                <Reverb />
              </>
                )
      }
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
})
