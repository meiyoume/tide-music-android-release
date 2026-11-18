/**
 * 图标名映射：鸿蒙系统符号 → react-native-vector-icons
 *
 * 鸿蒙版全部图标走系统符号库（`SymbolGlyph` + `$r('sys.symbol.xxx')`），RN 侧没有这套资源，
 * 所以按**语义**映射到 MaterialCommunityIcons（MCI）。映射表逐条对应
 * 鸿蒙 `ui/Icons.ets` 里的 68 个 `I_*` 常量。
 *
 * 为什么用 MCI 而不是继续用工程自带的 icomoon 字体：那份字体只有 52 个图标，
 * 缺「听书 / 云端 / 榜单 / 排序 / 多选 / 播放模式」等一大半语义，
 * 而 MCI 有 7000+ 个且与鸿蒙符号的语义最接近（同为 Material 风格）。
 */
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'

/** 鸿蒙语义名 → MCI 图标名 */
export const ICONS = {
  // ---------------- 导航与页面 ----------------
  home: 'home-outline',
  homeFill: 'home',
  person: 'account-outline',
  personFill: 'account',
  book: 'book-open-page-variant-outline',
  bookFill: 'book-open-page-variant',
  bookshelf: 'bookshelf',
  playlist: 'playlist-music-outline',
  playlistFill: 'playlist-music',
  gear: 'cog-outline',
  gearFill: 'cog',
  help: 'help-circle-outline',
  info: 'information-outline',

  // ---------------- 搜索与发现 ----------------
  search: 'magnify',
  identify: 'music-note-plus',
  sort: 'sort',
  disc: 'record-circle-outline',
  trophy: 'trophy-outline',
  doc: 'file-document-outline',
  star: 'star-outline',
  mic: 'microphone-outline',
  brush: 'brush',
  cache: 'harddisk',

  // ---------------- 播放控制 ----------------
  play: 'play',
  pause: 'pause',
  playCircle: 'play-circle',
  pauseCircle: 'pause-circle',
  prev: 'skip-previous',
  next: 'skip-next',
  repeat: 'repeat',
  repeatOne: 'repeat-once',
  orderPlay: 'playlist-play',
  shuffle: 'shuffle',
  queue: 'playlist-music',
  volume: 'volume-high',
  /** 迷你栏「播放中」那颗跳动符 */
  rhythm: 'waveform',

  // ---------------- 收藏与社交 ----------------
  heart: 'heart-outline',
  heartFill: 'heart',
  heartSlash: 'heart-off-outline',
  comment: 'message-outline',
  thumbUp: 'thumb-up-outline',
  share: 'share-variant-outline',
  cast: 'cast',
  bell: 'bell-outline',
  group: 'account-group-outline',

  // ---------------- 编辑与文件 ----------------
  plus: 'plus',
  minusCircle: 'minus-circle-outline',
  close: 'close',
  check: 'check',
  checkCircle: 'check-circle-outline',
  circle: 'circle-outline',
  trash: 'trash-can-outline',
  copy: 'content-copy',
  refresh: 'refresh',
  external: 'open-in-new',
  download: 'download-outline',
  downloadToLine: 'download',
  import: 'tray-arrow-down',
  addSonglist: 'playlist-plus',
  removeSonglist: 'playlist-minus',
  listPlay: 'playlist-play',
  selectAll: 'checkbox-multiple-marked-outline',
  folder: 'folder-outline',
  cloud: 'cloud-outline',
  clock: 'clock-outline',
  more: 'dots-horizontal',
  moreCircle: 'dots-horizontal-circle-outline',
  star2: 'star',

  // ---------------- 箭头 ----------------
  chevronDown: 'chevron-down',
  chevronRight: 'chevron-right',
  chevronLeft: 'chevron-left',
} as const

export type IconName = keyof typeof ICONS

export { MaterialCommunityIcons }
