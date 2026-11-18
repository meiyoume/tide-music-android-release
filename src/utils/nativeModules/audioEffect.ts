import { NativeModules } from 'react-native'

export interface SoundEffectPreset {
  index: number
  name: string
}

export interface SoundEffectStatus {
  sessionId: number
  available: boolean
  supportsEqualizer: boolean
  supportsBassBoost: boolean
  supportsVirtualizer: boolean
  /** 响度增强（LoudnessEnhancer） */
  supportsLoudness?: boolean
  /** 环境混响（PresetReverb） */
  supportsReverb?: boolean
  presets: SoundEffectPreset[]
  presetCount?: number
  currentPreset?: number
  enabled?: boolean
  /** 各频段中心频点（Hz），用来把 10 段开源曲线插值到这台设备上；拿不到就是空 */
  bandCenters?: number[]
  /** 各段增益可调范围（毫贝），通常 [-1500, 1500] */
  bandMin?: number
  bandMax?: number
  /** 拿不到会话 / 设备没效果库时给的原因（中文，直接展示） */
  reason?: string
}

export interface SoundEffectConfig {
  enabled: boolean
  /** 设备预设下标，-1 = 不用预设 */
  preset: number
  /**
   * 自定义均衡曲线（毫贝，逐段对应设备的 bandCenters）。
   * 给了这个就不用 preset，原生侧直接 setBandLevel。
   */
  bands?: number[]
  /** 0~1000，0 = 关 */
  bassBoost: number
  /** 0~1000，0 = 关 */
  virtualizer: number
  /** 0~1000 映射到 0~1200 毫贝，0 = 关 */
  loudness?: number
  /** 系统混响预设下标，0 = 关 */
  reverb?: number
}

interface AudioEffectNativeModule {
  getStatus: () => Promise<SoundEffectStatus>
  apply: (config: SoundEffectConfig) => Promise<SoundEffectStatus & { ok: boolean }>
  release: () => Promise<boolean>
}

const mod = NativeModules.AudioEffectModule as AudioEffectNativeModule | undefined

/** 设备上有没有这个原生模块（没有就是旧包 / 不支持） */
export const soundEffectSupported = mod != null

export const getSoundEffectStatus = async(): Promise<SoundEffectStatus | null> => {
  if (!mod) return null
  return mod.getStatus()
}

export const applySoundEffectConfig = async(config: SoundEffectConfig): Promise<(SoundEffectStatus & { ok: boolean }) | null> => {
  if (!mod) return null
  return mod.apply(config)
}

export const releaseSoundEffect = async(): Promise<boolean> => {
  if (!mod) return false
  return mod.release()
}
