import { type SoundEffectPreset } from '@/utils/nativeModules/audioEffect'

export interface InitState {
  /** 是否已经从原生侧取过一次状态 */
  loaded: boolean
  /** 这台设备能不能用（拿得到播放会话 + 有效果库） */
  available: boolean
  /** 不可用时的原因，直接展示给用户 */
  reason: string
  /**
   * 设备自带的均衡器预设（安卓系统那套：标准/古典/舞曲/…）。
   * 注意这是**原生报上来的原始列表**；给界面看的完整列表是 `presets`（见下）。
   */
  devicePresets: SoundEffectPreset[]
  /** 设备预设 + 开源自定义预设（VLC / AutoEq）拼成的完整列表，设置里存的下标就是这个列表的下标 */
  presets: SoundEffectPreset[]
  /** 设备预设数量；下标 >= 它的就是自定义曲线，要走 bands 那条路 */
  devicePresetCount: number
  /** 设备各频段中心频点（Hz）；空数组 = 设备没报，自定义曲线用不了 */
  bandCenters: number[]
  /** 各段增益可调范围（毫贝） */
  bandMin: number
  bandMax: number
  supportsBassBoost: boolean
  supportsVirtualizer: boolean
  supportsLoudness: boolean
  supportsReverb: boolean
}

const state: InitState = {
  loaded: false,
  available: false,
  reason: '',
  devicePresets: [],
  presets: [],
  devicePresetCount: 0,
  bandCenters: [],
  bandMin: -1500,
  bandMax: 1500,
  supportsBassBoost: false,
  supportsVirtualizer: false,
  supportsLoudness: false,
  supportsReverb: false,
}

export default state
