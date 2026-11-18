/**
 * 开源均衡器预设（10 段曲线）+ 往设备频段上的重采样。
 *
 * 数据全部来自有正式仓库、可追溯的开源项目，没有一条是我编的：
 *
 *  1. **VLC 经典均衡预设**（18 套）
 *     `https://github.com/videolan/vlc/blob/master/modules/audio_filter/equalizer_presets.h`
 *     Copyright (C) 2004 VLC authors and VideoLAN，作者 Laurent Aimar，LGPL-2.1-or-later。
 *     频点用的是 VLC 那套 10 段：60 / 170 / 310 / 600 / 1k / 3k / 6k / 12k / 14k / 16k。
 *
 *  2. **AutoEq 耳机校正曲线**（19 条）
 *     `https://github.com/jaakkopasanen/AutoEq`（MIT，Copyright (c) 2018-2022 Jaakko Pasanen），
 *     取 `results/<来源>/<类型>/<型号>/<型号> FixedBandEQ.txt` 里的 `Preamp` 与 10 段 `Gain`。
 *     频点是 ISO 那套：31.25 / 62.5 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k。
 *
 * 关于「预放」：两个来源的含义不一样，所以处理方式也不同 ——
 *  - AutoEq 的 `Preamp` 是**削顶补偿**（正好抵掉最大的那个提升），必须叠进去，否则会爆音；
 *  - VLC 的 `f_preamp` 不是补偿，而是它自己「Global gain」滑块的默认值
 *    （见 VLC `modules/audio_filter/equalizer.c`：选预设只是 `var_SetFloat("equalizer-preamp", preset->f_preamp)`），
 *    所以这里**不采用**，改用统一的削顶保护（见 `MAX_BOOST_DB`）。
 *
 * 落到设备上的限制：安卓的 Equalizer 段数是各机型自己定的（常见 5 段：60 / 230 / 910 / 3600 / 14000），
 * 跟这里的 10 段对不上，所以要按**对数频率**把曲线插值到设备的频点上。插值出来是近似形状，
 * 不是逐段精确复刻 —— 段数越少越粗，这是硬件限制，不是能绕过去的。
 */

import { type SoundEffectPreset } from '@/utils/nativeModules/audioEffect'

export interface PresetCurve {
  /** 稳定 id，只用来认人；设置里存的是合并后的**下标**，所以别随意改数组顺序 */
  id: string
  /** 显示名 */
  name: string
  /** 各段中心频点（Hz），升序，与 gains 等长 */
  freqs: number[]
  /** 各段增益（dB），与 freqs 一一对应 */
  gains: number[]
  /**
   * 来源自带的削顶补偿（dB）。只有「作者本来就是按补偿设计」时才填 —— 目前只有 AutoEq。
   * 填了就用它整体平移曲线；没填就走 `MAX_BOOST_DB` 那套保护。
   */
  preamp?: number
}

export interface PresetGroup {
  id: string
  /** 分组名（界面上的页签） */
  name: string
  /** 内核设置页那种扁平列表用的短前缀 */
  short: string
  /** 来源说明，显示在分组里 */
  credit: string
  presets: PresetCurve[]
}

/** VLC 那套 10 段频点 */
const VLC_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]
/** AutoEq（ISO）那套 10 段频点 */
const ISO_FREQS = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

/**
 * VLC 的 18 套预设。
 * 注意原文件里那些 `-1.11022e-15f` 就是 0（浮点写法的零），这里直接写 0。
 */
const VLC_PRESETS: PresetCurve[] = [
  { id: 'flat', name: '平坦', freqs: VLC_FREQS, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'classical', name: '古典', freqs: VLC_FREQS, gains: [0, 0, 0, 0, 0, 0, -7.2, -7.2, -7.2, -9.6] },
  { id: 'club', name: '俱乐部', freqs: VLC_FREQS, gains: [0, 0, 8, 5.6, 5.6, 5.6, 3.2, 0, 0, 0] },
  { id: 'dance', name: '舞曲', freqs: VLC_FREQS, gains: [9.6, 7.2, 2.4, 0, 0, -5.6, -7.2, -7.2, 0, 0] },
  { id: 'fullbass', name: '重低音', freqs: VLC_FREQS, gains: [-8, 9.6, 9.6, 5.6, 1.6, -4, -8, -10.4, -11.2, -11.2] },
  { id: 'fullbasstreble', name: '高低音增强', freqs: VLC_FREQS, gains: [7.2, 5.6, 0, -7.2, -4.8, 1.6, 8, 11.2, 12, 12] },
  { id: 'fulltreble', name: '清澈高音', freqs: VLC_FREQS, gains: [-9.6, -9.6, -9.6, -4, 2.4, 11.2, 16, 16, 16, 16.8] },
  { id: 'headphones', name: '耳机', freqs: VLC_FREQS, gains: [4.8, 11.2, 5.6, -3.2, -2.4, 1.6, 4.8, 9.6, 12.8, 14.4] },
  { id: 'largehall', name: '大厅', freqs: VLC_FREQS, gains: [10.4, 10.4, 5.6, 5.6, 0, -4.8, -4.8, -4.8, 0, 0] },
  { id: 'live', name: '现场', freqs: VLC_FREQS, gains: [-4.8, 0, 4, 5.6, 5.6, 5.6, 4, 2.4, 2.4, 2.4] },
  { id: 'party', name: '派对', freqs: VLC_FREQS, gains: [7.2, 7.2, 0, 0, 0, 0, 0, 0, 7.2, 7.2] },
  { id: 'pop', name: '流行', freqs: VLC_FREQS, gains: [-1.6, 4.8, 7.2, 8, 5.6, 0, -2.4, -2.4, -1.6, -1.6] },
  { id: 'reggae', name: '雷鬼', freqs: VLC_FREQS, gains: [0, 0, 0, -5.6, 0, 6.4, 6.4, 0, 0, 0] },
  { id: 'rock', name: '摇滚', freqs: VLC_FREQS, gains: [8, 4.8, -5.6, -8, -3.2, 4, 8.8, 11.2, 11.2, 11.2] },
  { id: 'ska', name: '斯卡', freqs: VLC_FREQS, gains: [-2.4, -4.8, -4, 0, 4, 5.6, 8.8, 9.6, 11.2, 9.6] },
  { id: 'soft', name: '轻柔', freqs: VLC_FREQS, gains: [4.8, 1.6, 0, -2.4, 0, 4, 8, 9.6, 11.2, 12] },
  { id: 'softrock', name: '柔摇滚', freqs: VLC_FREQS, gains: [4, 4, 2.4, 0, -4, -5.6, -3.2, 0, 2.4, 8.8] },
  { id: 'techno', name: '电子', freqs: VLC_FREQS, gains: [8, 5.6, 0, -5.6, -4.8, 0, 8, 9.6, 9.6, 8.8] },
]

/**
 * AutoEq 的耳机校正曲线。`preamp` 与 `gains` 都是文件里的原值（dB）。
 * 名字按中文习惯写了品牌，型号保持原样好对号入座。
 */
const AUTO_EQ_PRESETS: PresetCurve[] = [
  { id: 'ae-sony-wh1000xm5', name: '索尼 WH-1000XM5', freqs: ISO_FREQS, preamp: -9.0, gains: [-3.7, -1.6, -5.2, -3.3, 1.3, 1.8, 5.3, -2.4, 1.3, 9.0] },
  { id: 'ae-sony-wh1000xm4', name: '索尼 WH-1000XM4', freqs: ISO_FREQS, preamp: -5.8, gains: [-4.3, -1.8, -5.8, -1.4, 0.5, -0.6, 6.0, -0.8, 1.0, -2.2] },
  { id: 'ae-sony-wh1000xm3', name: '索尼 WH-1000XM3', freqs: ISO_FREQS, preamp: -4.4, gains: [-4.8, -2.6, -7.1, -1.1, -2.4, 2.3, 3.3, 3.8, -0.4, 2.4] },
  { id: 'ae-sony-wf1000xm4', name: '索尼 WF-1000XM4', freqs: ISO_FREQS, preamp: -11.1, gains: [-0.8, -1.2, -3.4, -3.3, -1.8, -0.5, 1.0, 1.6, 6.4, 10.8] },
  { id: 'ae-sennheiser-hd600', name: '森海塞尔 HD 600', freqs: ISO_FREQS, preamp: -7.5, gains: [6.9, 3.3, -1.1, -1.6, 0.6, -0.8, 0.1, -1.0, 3.9, -6.5] },
  { id: 'ae-sennheiser-hd650', name: '森海塞尔 HD 650', freqs: ISO_FREQS, preamp: -7.4, gains: [7.0, 2.6, -1.2, -2.2, 0.5, -1.0, 0.7, -1.2, 5.1, -3.6] },
  { id: 'ae-akg-k371', name: 'AKG K371', freqs: ISO_FREQS, preamp: -4.8, gains: [-3.0, 1.2, -1.4, -1.8, 0.8, -0.8, -0.3, 3.0, -0.2, 4.8] },
  { id: 'ae-beyer-dt770pro', name: '拜雅 DT 770 Pro', freqs: ISO_FREQS, preamp: -2.5, gains: [-4.1, -1.4, -1.8, 2.6, -0.4, -0.5, 0.1, 3.2, -4.1, -10.2] },
  { id: 'ae-philips-shp9500', name: '飞利浦 SHP9500', freqs: ISO_FREQS, preamp: -7.5, gains: [6.9, 3.5, -1.5, -0.6, 1.2, -1.5, 4.1, -2.6, -1.3, -4.3] },
  { id: 'ae-hifiman-he400se', name: '海菲曼 HE400se', freqs: ISO_FREQS, preamp: -7.0, gains: [6.6, 2.1, 0.2, -1.9, -0.8, -2.4, 5.3, -0.9, 0.3, -5.6] },
  { id: 'ae-apple-airpodsmax', name: '苹果 AirPods Max', freqs: ISO_FREQS, preamp: -4.2, gains: [-4.1, -0.9, -1.6, -2.1, -0.4, -2.9, 1.6, 2.9, 4.3, -10.6] },
  { id: 'ae-apple-airpodspro', name: '苹果 AirPods Pro', freqs: ISO_FREQS, preamp: -5.5, gains: [2.9, 1.7, 1.8, 0.3, -4.7, -0.8, -1.5, 2.3, 5.3, 0.4] },
  { id: 'ae-samsung-budspro', name: '三星 Galaxy Buds Pro', freqs: ISO_FREQS, preamp: -3.0, gains: [0.2, 0.0, -2.3, -2.2, -0.1, 2.7, 1.7, 0.7, -1.4, -10.5] },
  { id: 'ae-samsung-buds2pro', name: '三星 Galaxy Buds2 Pro', freqs: ISO_FREQS, preamp: -1.9, gains: [-2.4, 0.5, -0.3, -0.7, 0.0, 0.2, 0.6, -1.9, 2.6, -7.9] },
  { id: 'ae-moondrop-aria', name: '水月雨 Aria', freqs: ISO_FREQS, preamp: -2.4, gains: [-0.6, 0.4, -2.4, -1.7, 1.0, 0.5, -0.3, 1.0, 2.9, -10.9] },
  { id: 'ae-moondrop-chu', name: '水月雨 Chu', freqs: ISO_FREQS, preamp: -2.3, gains: [0.8, 2.3, -0.4, -1.0, 1.0, 0.5, -1.1, 0.2, 1.8, -5.3] },
  { id: 'ae-moondrop-blessing2', name: '水月雨 Blessing 2', freqs: ISO_FREQS, preamp: -3.9, gains: [3.4, 2.7, -0.2, -1.6, 1.0, 0.6, -2.2, 2.0, 1.9, -9.4] },
  { id: 'ae-7hz-zero', name: '7Hz Salnotes Zero', freqs: ISO_FREQS, preamp: -2.7, gains: [-0.4, 1.7, -0.6, -1.0, 0.4, 0.3, -1.2, 0.2, 2.8, -2.4] },
  { id: 'ae-truthear-zero', name: 'Truthear x Crinacle Zero', freqs: ISO_FREQS, preamp: -3.2, gains: [3.4, -0.6, -1.6, 1.4, 1.8, 0.8, -0.8, -1.8, 0.0, -4.2] },
]

export const PRESET_GROUPS: PresetGroup[] = [
  {
    id: 'vlc',
    name: '经典均衡',
    short: '经典',
    credit: 'VLC 经典预设（LGPL-2.1+）',
    presets: VLC_PRESETS,
  },
  {
    id: 'autoeq',
    name: '耳机校正',
    short: '耳机',
    credit: 'AutoEq 耳机校正曲线（MIT）· 挑自己的型号',
    presets: AUTO_EQ_PRESETS,
  },
]

/** 展平后的自定义预设，下标即「设备预设之后的第几个」 */
const FLAT = PRESET_GROUPS.flatMap(g => g.presets.map(curve => ({
  curve,
  groupId: g.id,
  groupName: g.name,
  groupShort: g.short,
})))

export const customPresetCount = FLAT.length

/** 合并后第 index 个预设（设备预设数 deviceCount 之后就是自定义的）对应的曲线 */
export const customCurveAt = (index: number, deviceCount: number): PresetCurve | null =>
  FLAT[index - deviceCount]?.curve ?? null

/**
 * 设备预设 + 自定义预设，拼成一个扁平列表给内核设置页用。
 * 自定义的名字带分组前缀（`经典·重低音`），因为那个页面没有分组页签，不加前缀分不清是哪套。
 */
export const mergePresets = (device: SoundEffectPreset[]): SoundEffectPreset[] => [
  ...device,
  ...FLAT.map((f, i) => ({
    index: device.length + i,
    name: `${f.groupShort}·${f.curve.name}`,
  })),
]

/** 给界面的分组结构：把每个预设的**合并下标**算出来，界面点哪个就存哪个 */
export const presetGroupsWithIndex = (deviceCount: number) => {
  let offset = 0
  return PRESET_GROUPS.map(g => {
    const base = deviceCount + offset
    offset += g.presets.length
    return {
      id: g.id,
      name: g.name,
      credit: g.credit,
      presets: g.presets.map((p, i) => ({ index: base + i, name: p.name })),
    }
  })
}

/**
 * 安卓系统预设的英文名 → 中文。各机型基本一致；认不出来就原样返回英文。
 *
 * 内核设置页有它自己的一份（`screens/.../SoundEffect.tsx` 里走 i18n，要跟中英繁三语），
 * 这里这份是给潮汐界面用的 —— 那边只有中文，没必要绕 i18n。
 */
const DEVICE_PRESET_NAMES: Record<string, string> = {
  normal: '标准',
  classical: '古典',
  dance: '舞曲',
  flat: '原声',
  folk: '民谣',
  'heavy metal': '重金属',
  'hip hop': '嘻哈',
  jazz: '爵士',
  pop: '流行',
  rock: '摇滚',
}

export const devicePresetName = (name: string): string =>
  DEVICE_PRESET_NAMES[String(name ?? '').toLowerCase()] ?? String(name ?? '')

/**
 * 允许的最大提升量（dB）。曲线里超过这个数的部分会被整体下移掉。
 *
 * 为什么要管：安卓的 Equalizer 只有各段增益，没有 VLC 那种单独的 preamp，
 * 而提升段太多、太大就会削顶（爆音）。整体下移**不改变曲线的形状**（预设的性格全在形状里），
 * 只是把绝对电平压低一点。AutoEq 那批自带补偿的走 `preamp`，不受这条影响。
 */
const MAX_BOOST_DB = 6

/**
 * 把一条 10 段曲线插值到目标频点上（对数频率线性插值）。
 * 目标频点超出曲线两端时取端值（不外推，免得高频段被无限拉高）。
 */
export const mapCurveToBands = (freqs: number[], gains: number[], centersHz: number[]): number[] =>
  centersHz.map(f => {
    if (f <= freqs[0]) return gains[0]
    const last = freqs.length - 1
    if (f >= freqs[last]) return gains[last]
    let i = 0
    while (i < last - 1 && freqs[i + 1] < f) i++
    const lo = Math.log(freqs[i])
    const hi = Math.log(freqs[i + 1])
    const t = (Math.log(f) - lo) / (hi - lo)
    return gains[i] + (gains[i + 1] - gains[i]) * t
  })

/**
 * 算出某个自定义预设在这台设备上该用的逐段增益（**毫贝**，安卓那套单位）。
 *
 * @param curve     预设曲线
 * @param centersHz 设备各频段中心频点（原生侧 `bandCenters` 给的）
 * @param minMb/maxMb 设备各段增益的可调范围（原生侧 `bandMin` / `bandMax`）
 * @returns 与 centersHz 等长的毫贝数组；设备没报频段布局时返回 null（调用方应回落到不用曲线）
 */
export const resolvePresetBands = (
  curve: PresetCurve,
  centersHz: number[],
  minMb: number,
  maxMb: number,
): number[] | null => {
  if (!centersHz.length) return null
  const shift = curve.preamp != null
    ? curve.preamp
    : Math.min(0, MAX_BOOST_DB - Math.max(...curve.gains))
  return mapCurveToBands(curve.freqs, curve.gains.map(g => g + shift), centersHz)
    .map(db => Math.round(Math.min(maxMb, Math.max(minMb, db * 100))))
}
