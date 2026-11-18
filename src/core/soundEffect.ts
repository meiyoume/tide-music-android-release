/**
 * 音效（均衡器 / 低音增强 / 环绕声 / 响度增强 / 环境混响）。
 *
 * 实现在原生侧（`android/app/src/main/java/cn/toside/music/mobile/audiofx/AudioEffectModule.java`），
 * 用的是安卓系统自带的效果器。
 *
 * 均衡器有两条路：
 *   1. **设备预设** —— 系统那套公认预设（标准 / 古典 / 舞曲 / …），直接把下标丢给原生；
 *   2. **开源自带的曲线** —— VLC 的 18 套经典曲线 + AutoEq 的耳机校正曲线
 *      （见 `utils/soundEffectPresets.ts`，附来源与许可）。这套要走 `bands`：
 *      把 10 段曲线按对数频率插值到**这台设备**的频点上，逐段下发。
 *
 * 为了两套东西在界面上是同一个列表、存同一个下标，这里把自定义预设**接在设备预设后面**
 * 拼成 `soundEffectState.presets`（`devicePresetCount` 就是分界线）。内核设置页直接渲染
 * 这个列表，所以那边不用改结构就能看到并选中开源曲线。
 *
 * 这里只负责两件事：
 *   1. 把「这台设备能用哪些效果、有哪些预设、频段怎么排」取回来给界面用；
 *   2. 把用户存的设置下发下去（该解析曲线的在这里解析）。
 *
 * 注意「什么时候挂上去」不需要这里操心：原生侧会记住设置，
 * 等播放器把音频会话建出来（或换了会话）时自动重挂 —— 见 AudioSessionHolder 的回调。
 */
import { applySoundEffectConfig, getSoundEffectStatus, releaseSoundEffect, soundEffectSupported } from '@/utils/nativeModules/audioEffect'
import { customCurveAt, mergePresets, resolvePresetBands } from '@/utils/soundEffectPresets'
import soundEffectActions from '@/store/soundEffect/action'
import soundEffectState from '@/store/soundEffect/state'
import settingState from '@/store/setting/state'
import { bootLog } from '@/utils/bootLog'

/** 取设备能力（预设列表 / 频段布局等）。启动时与进设置页时各调一次。 */
export const refreshSoundEffectStatus = async(): Promise<void> => {
  if (!soundEffectSupported) {
    soundEffectActions.setState({ loaded: true, available: false, reason: '本安装包不含音效模块' })
    return
  }
  try {
    const status = await getSoundEffectStatus()
    const devicePresets = status?.presets ?? []
    soundEffectActions.setState({
      loaded: true,
      available: !!status?.available,
      reason: status?.reason ?? '',
      devicePresets,
      presets: mergePresets(devicePresets),
      devicePresetCount: devicePresets.length,
      bandCenters: status?.bandCenters ?? [],
      bandMin: status?.bandMin ?? -1500,
      bandMax: status?.bandMax ?? 1500,
      supportsBassBoost: !!status?.supportsBassBoost,
      supportsVirtualizer: !!status?.supportsVirtualizer,
      supportsLoudness: !!status?.supportsLoudness,
      supportsReverb: !!status?.supportsReverb,
    })
  } catch (err) {
    bootLog(`Sound effect status failed: ${(err as Error).message}`)
    soundEffectActions.setState({ loaded: true, available: false, reason: (err as Error).message })
  }
}

/** 全部关掉并释放（音效全关时用，免得一直占着效果器） */
export const releaseAllSoundEffect = async(): Promise<void> => {
  if (!soundEffectSupported) return
  await releaseSoundEffect()
}

/** 把当前设置下发给原生侧。用户改设置时、以及每次开始播放时调。 */
export const applySoundEffect = async(): Promise<void> => {
  if (!soundEffectSupported) return
  const setting = settingState.setting
  const {
    devicePresetCount, presets, bandCenters, bandMin, bandMax,
  } = soundEffectState

  // 存的是完整列表的下标，换设备 / 预设数量变了就可能越界 —— 越界按「关闭」处理
  let preset = setting['player.soundEffectPreset']
  if (preset >= 0 && presets.length && preset >= presets.length) preset = -1

  // 下标 >= 设备预设数量的就是开源曲线，解析成这台设备上的逐段毫贝
  let bands: number[] | undefined
  if (preset >= 0 && presets.length && preset >= devicePresetCount) {
    const curve = customCurveAt(preset, devicePresetCount)
    const resolved = curve ? resolvePresetBands(curve, bandCenters, bandMin, bandMax) : null
    if (resolved) bands = resolved
    // 认不出这条曲线、或设备没报频段布局时当作没选：
    // 千万别把「完整列表的下标」当「设备预设下标」丢给原生，那样会 usePreset 到另一个预设上。
    else preset = -1
  }

  const enabled = setting['player.soundEffectEnabled']
  const bassBoost = setting['player.soundEffectBassBoost']
  const virtualizer = setting['player.soundEffectVirtualizer']
  const loudness = setting['player.soundEffectLoudness']
  const reverb = setting['player.soundEffectReverb']
  // 全关着就别占着效果器 —— 每次开始播放都会走这里，没必要白建一遍再关掉
  if (!enabled || (preset < 0 && !bands && bassBoost <= 0 && virtualizer <= 0 && loudness <= 0 && reverb <= 0)) {
    await releaseAllSoundEffect()
    return
  }
  try {
    const result = await applySoundEffectConfig({
      enabled,
      // 走 bands 时 preset 传 -1：原生侧按曲线逐段设，不要再去套系统预设
      preset: bands ? -1 : preset,
      bands,
      bassBoost,
      virtualizer,
      loudness,
      reverb,
    })
    if (result && !result.ok) bootLog(`Sound effect not applied: ${result.reason ?? ''}`)
  } catch (err) {
    bootLog(`Sound effect apply failed: ${(err as Error).message}`)
  }
}
