const defaultSetting: LX.AppSetting = {
  version: '2.0',
  'common.isAutoTheme': false,
  'common.langId': null,
  'common.apiSource': '',
  'common.sourceNameType': 'alias',
  'common.shareType': 'system',
  // 移植版改动：默认视为已同意「许可协议」，启动时不再弹协议弹窗
  // （用户反馈每次打开都要点一遍）。协议正文仍可在「设置 - 关于 - 许可协议」里查看。
  // 想恢复上游行为改回 false。
  'common.isAgreePact': true,
  'common.autoHidePlayBar': true,
  'common.drawerLayoutPosition': 'left',
  'common.homePageScroll': true,
  'common.allowProgressBarSeek': true,
  'common.showBackBtn': false,
  'common.showExitBtn': true,
  'common.useSystemFileSelector': true,
  'common.alwaysKeepStatusbarHeight': false,

  'player.startupAutoPlay': false,
  'player.startupPushPlayDetailScreen': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  'player.isSavePlayTime': false,
  'player.volume': 1,
  'player.playbackRate': 1,
  'player.cacheSize': '1024',
  'player.timeoutExit': '',
  'player.timeoutExitPlayed': true,
  'player.isAutoCleanPlayedList': false,
  'player.isHandleAudioFocus': true,
  'player.isEnableAudioOffload': true,
  'player.isShowLyricTranslation': false,
  'player.isShowLyricRoma': false,
  'player.isShowNotificationImage': true,
  'player.isS2t': false,
  'player.isShowBluetoothLyric': false,
  'player.isShowBluetoothFullLyric': false,

  // 音效（均衡器 / 低音增强 / 环绕声 / 响度增强 / 环境混响）。
  // 预设存的是**完整预设列表的下标**（-1 = 关闭）。完整列表 = 设备预设 + 开源自带的那些
  // （见 utils/soundEffectPresets.ts）：设备那套是 标准 / 古典 / 舞曲 / 原声 / 民谣 /
  // 重金属 / 嘻哈 / 爵士 / 流行 / 摇滚，后面接 VLC 经典曲线与 AutoEq 耳机校正曲线。
  'player.soundEffectEnabled': true,
  'player.soundEffectPreset': -1,
  'player.soundEffectBassBoost': 0,
  'player.soundEffectVirtualizer': 0,
  // 响度增强：0~1000 映射到 0~1200 毫贝（+12dB）
  'player.soundEffectLoudness': 0,
  // 环境混响：系统 PresetReverb 的下标，0 = 关
  'player.soundEffectReverb': 0,

  // 'playDetail.isZoomActiveLrc': false,
  // 'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.align': 'left',
  'playDetail.vertical.style.lrcFontSize': 210,
  'playDetail.horizontal.style.lrcFontSize': 220,
  'playDetail.isShowLyricProgressSetting': false,

  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  'desktopLyric.width': 100,
  'desktopLyric.maxLineNum': 5,
  'desktopLyric.isSingleLine': false,
  'desktopLyric.showToggleAnima': true,
  'desktopLyric.position.x': 0,
  'desktopLyric.position.y': 0,
  'desktopLyric.textPosition.x': 'left',
  'desktopLyric.textPosition.y': 'top',
  'desktopLyric.style.fontSize': 180,
  'desktopLyric.style.opacity': 100,
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.6)',

  // 移植版改动：搜索页空白时显示「历史搜索」与「热门搜索」。
  // 上游默认两个都是 false ⇒ 搜索页只有一个「搜我所想」的空态，用户反馈
  // 「搜索界面要有最近搜索」。想恢复改回 false。
  'search.isShowHotSearch': true,
  'search.isShowHistorySearch': true,

  'list.isClickPlayList': false,
  'list.isShowSource': true,
  'list.isShowAlbumName': false,
  'list.isShowInterval': true,
  'list.isSaveScrollLocation': true,
  'list.addMusicLocationType': 'top',

  'download.fileName': '歌名 - 歌手',

  'sync.enable': false,

  // 使用鸿蒙移植版壳层（悬浮玻璃页签栏 + 迷你播放栏）；关掉退回安卓版原界面
  harmonyShell: true,

  // 使用潮汐界面（WebView 壳层，界面在 assets/tide/）
  // 优先级高于 harmonyShell：关掉它退回鸿蒙壳层，两个都关才回到安卓原版界面
  tideShell: true,

  // 'theme.id': 'blue_plus',
  'theme.id': 'lx_red',
  'theme.lightId': 'lx_red',
  'theme.darkId': 'lx_dark',
  'theme.hideBgDark': false,
  'theme.dynamicBg': false,
  'theme.fontShadow': false,
}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'lx_red'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 18, 34, 1)'
}

export default defaultSetting
