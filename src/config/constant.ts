export const HEADER_HEIGHT = 42
export const LIST_ITEM_HEIGHT = 54
export const LIST_SCROLL_POSITION_KEY = '__LIST_SCROLL_POSITION_KEY__'

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

// export const COMPONENT_IDS = {
//   home: 'home',
//   playDetail: 'playDetail',
// } as const
// export type COMPONENT_IDS_TYPE = keyof typeof COMPONENT_IDS
export enum COMPONENT_IDS {
  home = 'home',
  playDetail = 'playDetail',
  songlistDetail = 'songlistDetail',
  comment = 'comment',
}

export enum NAV_SHEAR_NATIVE_IDS {
  playDetail_pic = 'playDetail_pic',
  playDetail_header = 'playDetail_header',
  // playDetail_pageIndicator = 'playDetail_pageIndicator',
  playDetail_player = 'playDetail_player',
  songlistDetail_pic = 'songlistDetail_pic',
  songlistDetail_title = 'songlistDetail_title',
}


export const storageDataPrefix = {
  setting: '@setting_v1',
  userList: '@user_list',
  viewPrevState: '@view_prev_state',

  list: '@list__',
  listScrollPosition: '@list_scroll_position',
  listPrevSelectId: '@list_prev_select_id',

  lyric: '@lyric__',
  musicUrl: '@music_url__',
  musicOtherSource: '@music_other_source__',
  playInfo: '@play_info',

  /**
   * 播放历史（「我的 - 最近播放」的数据源）
   *
   * 安卓版底座**没有**播放历史这个能力：`playerState.playedList` 是
   * 「随机播放模式下已播过、别再随机到」的去重队列（见 `core/player/utils.ts`），
   * 只在随机模式写入、切列表就清空、且不持久化。所以「最近播放」页自己存一份。
   */
  playHistory: '@play_history',

  syncAuthKey: '@sync_auth_key',
  syncHost: '@sync_host',
  syncHostHistory: '@sync_host_history',

  openStoragePath: '@open_storage_path',
  selectedManagedFolder: '@selected_managed_folder',
  notificationTipEnable: '@notification_tip_enable',
  ignoringBatteryOptimizationTipEnable: '@ignoring_battery_optimization_tip_enable',

  searchHistoryList: '@search_history_list',
  listUpdateInfo: '@list_update_info',
  ignoreVersion: '@ignore_version',
  ignoreVersionFailTipTimeKey: '@ignore_version_fail_tip_time',
  leaderboardSetting: '@leaderboard_setting',
  songListSetting: '@songist_setting',
  searchSetting: '@search_setting',

  fontSize: '@font_size',

  /**
   * 用户是否在「设置 - 基本设置 - 语言」里**主动**选过语言
   *
   * 用途：这是中文移植版，英文系统上默认给简体中文；但用户主动选了英文之后
   * 就不能再被改回去，所以要有一个「是用户自己选的」标记来区分。
   */
  langUserChosen: '@lang_user_chosen',

  theme: '@theme',

  cheatTip: '@cheat_tip',
  remoteLyricTip: '@remote_lyric_tip',

  dislikeList: '@dislike_list',

  userApi: '@user_api__',

  /**
   * 移植版「一次性设置迁移」的标志位（见 `config/portMigration.ts`）
   *
   * 用途：`updateSetting()` 合并设置时**已存的值永远优先于新默认值**，
   * 所以改 `defaultSetting.ts` 只对全新安装生效、对已装过的设备无效。
   * 需要强制覆盖某几个键时，靠这个标志位保证只做一次（不覆盖用户后来的手动修改）。
   */
  portMigrated: '@harmony_port_migrated_v1',
} as const

// v0.x.x 版本的 data keys
export const storageDataPrefixOld = {
  setting: '@setting',
  list: '@list__',
  listPosition: '@listposition__',
  listSort: '@listsort__',
  // lyric: '@lyric__',
  // musicUrl: '@music_url__',
  playInfo: '@play_info',
  syncAuthKey: '@sync_auth_key',
  syncHost: '@sync_host',
  syncHostHistory: '@sync_host_history',
  notificationTipEnable: '@notification_tip_enable',
} as const

/**
 * FileProvider 的 authority（应用内「检查更新」下载完 APK 后靠它安装）
 *
 * ⚠️ 必须与 `AndroidManifest.xml` 里 `<provider android:authorities>` 一致。
 * manifest 用的是 `${applicationId}.provider`（会自动跟随 applicationId），
 * 而这里是**硬编码**的 —— 所以改了 `applicationId`（本移植版为了与原版共存
 * 改成了 `cn.toside.music.mobile.harmony`）之后，这里**必须同步改**，
 * 否则应用内更新会因为 authority 对不上而安装失败。
 */
export const APP_PROVIDER_NAME = 'cn.toside.music.mobile.harmony.provider'


export const NAV_MENUS = [
  { id: 'nav_search', icon: 'search-2' },
  { id: 'nav_songlist', icon: 'album' },
  { id: 'nav_top', icon: 'leaderboard' },
  { id: 'nav_love', icon: 'love' },
  // { id: 'download', icon: 'download-2' },
  { id: 'nav_setting', icon: 'setting' },
] as const

export type NAV_ID_Type = typeof NAV_MENUS[number]['id']

export const LXM_FILE_EXT_RXP = ['json', 'lxmc', 'bin']
export const USER_API_SOURCE_FILE_EXT_RXP = ['js']

export const MUSIC_TOGGLE_MODE = {
  listLoop: 'listLoop', // 列表循环
  random: 'random', // 列表随机
  list: 'list', // 顺序播放
  singleLoop: 'singleLoop', // 单曲循环
  none: 'none', // 禁用
} as const

export const MUSIC_TOGGLE_MODE_LIST = [
  MUSIC_TOGGLE_MODE.listLoop,
  MUSIC_TOGGLE_MODE.random,
  MUSIC_TOGGLE_MODE.list,
  MUSIC_TOGGLE_MODE.singleLoop,
  MUSIC_TOGGLE_MODE.none,
] as const

export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'kw' as LX.OnlineSource,
    boardId: 'kw__16',
  },

  songList: {
    source: 'kw' as LX.OnlineSource,
    sortId: 'new',
    tagName: '',
    tagId: '',
  },

  search: {
    temp_source: 'kw' as LX.OnlineSource,
    source: 'all' as LX.OnlineSource | 'all',
    // 移植版：默认 `both` —— 一次把歌曲和歌单都搜出来，左右并排显示
    // （用户要求「搜索结果要歌单和歌曲一起搜出来，左边歌曲、右边歌单」）。
    // 想恢复上游「二选一」的默认值改成 `'music'` 即可。
    type: 'both' as 'music' | 'songlist' | 'both',
  },

  viewPrevState: {
    id: 'nav_search' as NAV_ID_Type,
    // query: {},
  },
}
