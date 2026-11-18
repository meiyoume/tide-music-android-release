import { Linking } from 'react-native'
import { errorDialog } from './utils'
import { handleMusicAction } from './musicAction'
import { handlePlayerAction, type PlayerAction } from './playerAction'
import { handleSonglistAction } from './songlistAction'
import { extname, stat } from '@/utils/fs'
import { handleFileMusicAction, handleFileJSAction, handleFileLXMCAction } from './fileAction'


/**
 * 本应用认的深链接 scheme
 *
 * `lxmusic` 是上游标准 scheme（与原版洛雪一致，共存版也注册了它，
 * 这样从浏览器点洛雪链接本移植版同样能接）；
 * `lxmusic-harmony` 是本移植版专属（想明确指定给这一版时用）。
 *
 * ⚠️ 解析时**必须把两个都剥掉**：`lxmusic-harmony://` 并不以 `lxmusic://` 开头
 * （第 9 个字符是 `-` 而不是 `:`），所以只 replace 后者会让 type/action 解析错位。
 */
const LINK_SCHEMES = ['lxmusic-harmony://', 'lxmusic://']

/** 去掉 scheme 前缀，返回 `type/action/...` 那一段 */
const stripScheme = (url: string): string => {
  for (const scheme of LINK_SCHEMES) {
    if (url.startsWith(scheme)) return url.slice(scheme.length)
  }
  return url
}

const handleLinkAction = async(link: string) => {
  // console.log(link)
  const [url, search] = link.split('?')
  const [type, action, ...paths] = stripScheme(url).split('/')
  const params: {
    paths: string[]
    data?: string
    [key: string]: any
  } = {
    paths: [],
  }
  if (search) {
    for (const param of search.split('&')) {
      const [key, value] = param.split('=')
      params[key] = value
    }
    if (params.data) params.data = JSON.parse(decodeURIComponent(params.data))
  }
  params.paths = paths.map(p => decodeURIComponent(p))
  console.log(params)
  switch (type) {
    case 'music':
      await handleMusicAction(action, params)
      break
    case 'songlist':
      await handleSonglistAction(action, params)
      break
    case 'player':
      await handlePlayerAction(action as PlayerAction)
      break
    // default: throw new Error('Unknown type: ' + type)
  }
}

const handleFileAction = async(link: string) => {
  const file = await stat(link)
  // console.log(file)
  switch (extname(file.name)) {
    case 'json':
    case 'lxmc':
      await handleFileLXMCAction(file)
      break
    case 'js':
      await handleFileJSAction(file)
      break
    case 'ogg':
    case 'flac':
    case 'wav':
    case 'mp3':
      await handleFileMusicAction(file)
      break
    default:
      if (!file.mimeType?.startsWith('audio/')) throw new Error('Unknown file type')
      await handleFileMusicAction(file)
      break
  }
}

// const handleHttpAction = async(link: string) => {
// }


const runLinkAction = async(link: string) => {
  // 两个 scheme 都算洛雪链接（见 LINK_SCHEMES 的说明）
  if (LINK_SCHEMES.some(scheme => link.startsWith(scheme))) {
    try {
      await handleLinkAction(link)
    } catch (err: any) {
      errorDialog(err.message)
      // focusWindow()
    }
  } else if (link.startsWith('file://') || link.startsWith('content://')) {
    try {
      await handleFileAction(link)
    } catch (err: any) {
      errorDialog(err.message)
      // focusWindow()
    }
  }
  //  else if (/^https?:\/\//.test(link)) {
  //   try {
  //     await handleHttpAction(link)
  //   } catch (err: any) {
  //     errorDialog(err.message)
  //     // focusWindow()
  //   }
  // }
}

export const initDeeplink = async() => {
  Linking.addEventListener('url', ({ url }) => {
    void runLinkAction(url)
    console.log('deeplink', url)
  })
  const initialUrl = await Linking.getInitialURL()
  if (initialUrl == null) return
  console.log('deeplink', initialUrl)
  void runLinkAction(initialUrl)
}
