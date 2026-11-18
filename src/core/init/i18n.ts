import { createI18n } from '@/lang/i18n'
import type { I18n } from '@/lang/i18n'
import { getDeviceLanguage } from '@/utils/tools'
import { setLanguage, updateSetting } from '@/core/common'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'


export default async(setting: LX.AppSetting) => {
  let lang = setting['common.langId']

  global.i18n = createI18n()

  // 用户是否主动选过语言（选过就完全尊重，不再按下面那套规则改）
  const userChosen = (await getData<boolean>(storageDataPrefix.langUserChosen)) ?? false

  if (!userChosen && lang === 'en_us') {
    // 存量数据修正：旧版在英文系统上会把 `common.langId` 落成 `en_us`（不是用户选的），
    // 只改默认值救不了这些已安装的设备 —— 实测「改了兜底、重装后设置页仍是英文」
    // 就是这个原因。这里把「非用户主动选择的 en_us」纠正回简体中文。
    lang = 'zh_cn'
    updateSetting({ 'common.langId': lang })
  } else if (!lang || !global.i18n.availableLocales.includes(lang)) {
    const deviceLanguage = (await getDeviceLanguage()).toLowerCase()
    // 设备语言是英文时**也**给简体中文
    //
    // 这是**鸿蒙版 UI 移植**工程：界面文案与鸿蒙侧一致，本来就是中文。
    // 而 Android 原生 `UtilsModule.getSystemLocales` 会把系统语言格式化成
    // `en_us` 这种**合法 locale 键**（`UtilsModule.java:293-304`），
    // 所以英文系统上会命中「设备语言可用」这一支、直接选中 en_us ——
    // 于是设置页整片英文（General / Theme / Automatically play music…），
    // 用户直接反馈「二级菜单也没优化」。
    //
    // 简体 / 繁体中文系统仍按系统语言走；英文（及其它语言）一律给简体中文，
    // 用户可在「设置 - 基本设置 - 语言」里自行切换。
    const isEnglish = deviceLanguage.startsWith('en')
    if (!isEnglish && typeof deviceLanguage == 'string' && global.i18n.availableLocales.includes(deviceLanguage as I18n['locale'])) {
      lang = deviceLanguage as I18n['locale']
    } else {
      lang = 'zh_cn'
    }
    updateSetting({ 'common.langId': lang })
  }
  setLanguage(lang)
}

/** 供「设置 - 语言」调用：记下这是用户主动选的，之后不再被默认规则覆盖 */
export const markLangUserChosen = () => {
  void saveData(storageDataPrefix.langUserChosen, true)
}
