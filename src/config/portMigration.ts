/**
 * 移植版的**一次性设置迁移**
 *
 * ## 为什么需要这个文件
 *
 * 改 `config/defaultSetting.ts` 里的默认值，**只对全新安装生效**。
 * 看 `config/setting.ts` 的 `mergeSetting()`：它拿新默认值当底、把**已存的值**盖上去 ——
 * 也就是「用户存过的值永远优先」。所以对已经装过本移植版的手机来说，
 * 无论怎么改默认值，读出来的还是手机上那份旧值。
 *
 * 实测踩到的三个后果（都是用户反馈的现象）：
 *
 * | 键 | 手机上存的旧值 | 现象 |
 * |---|---|---|
 * | `common.isAgreePact` | `false` | **每次启动都弹「许可协议」**（点弹窗外面关掉的话不会写回 true，于是下次还弹） |
 * | `search.isShowHistorySearch` | `false` | 搜索页空白、没有「历史搜索」；而且 `addHistoryWord()` 会因为它是 false **根本不记历史** |
 * | `search.type`（存在另一个 key 里） | `'music'` | 搜索结果只有歌曲，没有歌单 |
 *
 * ## 做法
 *
 * 在设置读出来之后**强制覆盖**这几个键，并用 `storageDataPrefix.portMigrated` 标志位
 * 保证**只做一次** —— 之后用户自己改回来（比如把「历史搜索」关掉）不会再被覆盖。
 */
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { forceSearchType } from '@/utils/data'

/**
 * 需要强制覆盖的 `LX.AppSetting` 键
 *
 * 只放「不改就等于功能坏了」的键，不放纯口味项。
 */
const FORCED_SETTING: Partial<LX.AppSetting> = {
  /** 见上表：false 会让「许可协议」每次启动都弹 */
  'common.isAgreePact': true,
  /** 搜索页空白态要显示历史 + 热搜（与鸿蒙 `discoverPane()` 一致） */
  'search.isShowHistorySearch': true,
  'search.isShowHotSearch': true,
}

/**
 * 跑一次性迁移
 *
 * @param setting 已经过 `updateSetting()` 合并的设置对象，**会被就地修改**
 * @returns 是否真的改了（改了的话调用方需要把设置存回去）
 */
export const migratePortSetting = async(setting: LX.AppSetting): Promise<boolean> => {
  const migrated = await getData<boolean>(storageDataPrefix.portMigrated)
  if (migrated) return false

  for (const key of Object.keys(FORCED_SETTING) as Array<keyof LX.AppSetting>) {
    // @ts-expect-error 逐个键赋值，类型在这里收窄不了
    setting[key] = FORCED_SETTING[key]
  }

  // 搜索类型存在 `@search_setting` 这个**独立 key** 里，不在 AppSetting 里
  await forceSearchType('both')

  await saveData(storageDataPrefix.portMigrated, true)
  return true
}
