import { initSetting, showPactModal, updateSetting } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import installBuiltinSources from '@/harmony/builtinSources'
import { initHistory } from '@/harmony/playHistory'
import { initDeeplink } from './deeplink'
import { setApiSource } from '@/core/apiSource'
import { applySoundEffect, refreshSoundEffectStatus } from '@/core/soundEffect'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'

let isFirstPush = true

/**
 * 启动时检查更新
 *
 * 2026-11-18 改回 `true`：更新源已经从「上游洛雪」换成了本移植版自己的
 * GitHub Release（见 `src/utils/version.js` 的 REPO_OWNER/REPO_NAME），
 * 版本号也是本包的 1.9.x —— 原来关掉它的理由（永远落后上游、下载到原版 APK）
 * 都不成立了。检查是异步的、不挡启动；失败只按「每 7 天提示一次」处理。
 */
const CHECK_UPDATE_ON_STARTUP: boolean = true

/**
 * 移植版：启动时**不再弹「许可协议」**
 *
 * 上游只在 `common.isAgreePact` 为 false 时弹，看起来是「首次一次」。
 * 但**点弹窗外面（bgClose）关掉不会把 `isAgreePact` 写回 true** ——
 * 于是每次启动都再弹一次，这正是用户反馈的「每次打开都有提示弹窗」。
 *
 * 这里两道保险：
 *   ① 代码层面启动不再调 `showPactModal()`（不管存的是什么值）；
 *   ② 顺手把 `isAgreePact` 落盘成 true，免得「设置 - 关于」里的状态与启动行为不一致。
 *
 * 协议正文没有丢：**「设置 - 关于 - 许可协议」随时可以打开**（那条路径照旧）。
 * 想恢复上游行为改成 `true` 即可。
 */
const SHOW_PACT_MODAL_ON_STARTUP: boolean = false

const handlePushedHomeScreen = async() => {
  await cheatTip()

  if (!settingState.setting['common.isAgreePact']) {
    if (SHOW_PACT_MODAL_ON_STARTUP) {
      showPactModal()
    } else {
      // 不弹窗，但把「已同意」落盘，保持状态一致
      updateSetting({ 'common.isAgreePact': true })
    }
  }

  if (isFirstPush) {
    isFirstPush = false
    if (CHECK_UPDATE_ON_STARTUP) void checkUpdate()
    void initDeeplink()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')

  // 播放历史：底座没有这个能力（`playerState.playedList` 是随机播放的去重队列，
  // 默认模式下恒空且不持久化），所以移植层自己记一份，「我的 - 最近播放」用它。
  initHistory()
  bootLog('Play history inited.')

  await dataInit(setting)
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}

let isBackgroundInited = false
/**
 * 首屏用不到的初始化：装内置音源 + 音源沙箱 + 恢复上次播放。
 *
 * 为什么拆出来（2026-11-17 冷启动优化）：实测这三步在模拟器上要 **~460ms**
 * （装内置音源 183ms、initUserApi 43ms、initPlayer 234ms），而它们挡在
 * `Navigation.setRoot` 前面 —— 用户就在白色启动底色上多等半秒。
 * 首页第一屏根本用不到它们：要播放、看音源列表、看本地库才会碰。
 *
 * 谁在什么时候调：界面加载完、`home` 命令（首屏数据）回来之后，
 * 由 `src/tide/background.ts` 触发（见 bridge.ts 的 home 命令）。
 * 也有兜底：4 秒内界面没起来（WebView 加载失败等）app.ts 会自己调一次，
 * 免得播放器/音源永远初始化不上。
 */
export const initBackground = async() => {
  if (isBackgroundInited) return
  isBackgroundInited = true
  bootLog('Background init start.')
  const setting = settingState.setting

  // 内置音源：必须在 initUserApi **之前**装好 ——
  // initUserApi 只负责读一次列表并接上沙箱，装晚了这次启动就认不到新脚本。
  const builtin = await installBuiltinSources()
  bootLog(`Builtin sources inited.${builtin.installedNames.length ? ` Installed: ${builtin.installedNames.join(', ')}` : ''}`)

  await initUserApi(setting)
  bootLog('User Api inited.')

  // 「装好了音源」与「正在用这个音源」是两件事，这里补上后者。
  //
  // 洛雪 1.9.1 的官方音源列表是**空的**（`api-source-info.ts` 是 `[]`），
  // 而 `common.apiSource` 默认是 `''`。此时即使内置音源已经装进「音源管理」，
  // 点歌也只会报 `Api is not found`（`api-source.js` 只在 id 以 `user_api` 开头时
  // 才走自定义音源）。实测确认过：装好音源后直接点搜索结果，日志就是
  // `[Error: Api is not found]` → `Failed to change the source`。
  //
  // `selectedId` 由 builtinSources 按三条规则算好（没选过 / 选的是我们上次自动选的 /
  // 其他情况不动），这里只负责落地 —— 规则与理由都写在那边。
  if (builtin.selectedId) {
    setApiSource(builtin.selectedId)
    bootLog(`Builtin source auto-selected: ${builtin.selectedId}`)
  }

  await initPlayer(setting)
  bootLog('Player inited.')

  // 音效：取一次设备能力（有哪些系统预设），并把用户存的设置下发给原生侧。
  // 这时播放器还没建出音频会话，真正挂上去是播放开始后由原生侧自动完成的。
  void refreshSoundEffectStatus()
  void applySoundEffect()
  bootLog('Sound effect inited.')
}
