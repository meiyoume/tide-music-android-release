import { version } from '../../../package.json'

export interface ProgressInfo {
  total: number
  current: number
}

export interface VersionInfo {
  version: string
  desc: string
  history?: LX.VersionInfo[]
}

export interface InitState {
  showModal: boolean
  versionInfo: {
    version: string
    newVersion: VersionInfo | null
    showModal: boolean
    isUnknown: boolean
    isLatest: boolean
    reCheck: boolean
    status: LX.UpdateStatus
  }
  ignoreVersion: string | null
  progress: ProgressInfo
}

const state: InitState = {
  showModal: false,
  versionInfo: {
    version,
    newVersion: null,
    showModal: false,
    reCheck: false,
    isUnknown: false,
    isLatest: false,
    // 上游这里初始是 'checking' —— 因为启动时会立刻跑一次 checkUpdate() 把它改掉。
    // 本移植版**启动不做更新检查**（core/init/index.ts 的 CHECK_UPDATE_ON_STARTUP），
    // 于是它会永远停在「检查更新中…」。改成 idle，由「设置 - 软件更新」显示「未检查更新」。
    status: 'idle',
  },
  ignoreVersion: null,
  progress: {
    total: 0,
    current: 0,
  },
}


export default state
