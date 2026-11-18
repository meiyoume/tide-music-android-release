/**
 * 首页（界面壳层的落点）
 *
 * 现在有三套壳层，按优先级依次回退：
 *   1. 潮汐界面 `tideShell`（默认）—— WebView 承载 `assets/tide/` 里的纯 Web 界面
 *   2. 鸿蒙壳层 `harmonyShell` —— 悬浮玻璃页签栏 + 迷你播放栏
 *   3. 安卓原版界面 —— 顶栏 + 抽屉 + 普通 TabBar
 *
 * 逐级回退是刻意的：界面出问题时不用改代码、重新打包就能退回上一个能用的壳层。
 * 设置项在「设置 - 基础设置」里。
 */
import { useCallback, useEffect, useState } from 'react'
import { View, StyleSheet, BackHandler, Platform } from 'react-native'
import { useHorizontalMode } from '@/utils/hooks'
import PageContent from '@/components/PageContent'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
import { navigations } from '@/navigation'
import settingState from '@/store/setting/state'
import { useSettingValue } from '@/store/setting/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { Shell } from '@/harmony/Shell'
import { SubPageHost } from '@/harmony/SubPageHost'
import { TideShell } from '@/tide/TideShell'
import { setNavActiveId } from '@/core/common'


interface Props {
  componentId: string
}


export default ({ componentId }: Props) => {
  const isHorizontalMode = useHorizontalMode()
  const useHarmonyShell = useSettingValue('harmonyShell')
  const useTideShell = useSettingValue('tideShell')
  const topInset = useStatusbarHeight()

  /**
   * 潮汐界面里点「洛雪原生设置」「最近播放」「本地音乐」这类入口时，
   * 用原生页面整屏盖在 WebView 上
   *
   * 不这么做的话，音源管理、音质、下载这些内核设置就没有入口 ——
   * 潮汐界面自己那套设置只负责外观，不重复实现内核设置。
   */
  const [nativePage, setNativePage] = useState<string | null>(null)

  useEffect(() => {
    setComponentId(COMPONENT_IDS.home, componentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // 潮汐界面自己就是播放页，开机直接弹原生播放详情页会跟它打架
    if (!useTideShell && settingState.setting['player.startupPushPlayDetailScreen']) {
      navigations.pushPlayDetailScreen(componentId, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 原生设置页开着时，返回键先关它 */
  useEffect(() => {
    if (Platform.OS !== 'android' || !nativePage) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setNativePage(null)
      return true
    })
    return () => { sub.remove() }
  }, [nativePage])

  const openPlayer = useCallback(() => {
    navigations.pushPlayDetailScreen(componentId, true)
  }, [componentId])

  const openQueue = useCallback(() => {
    // 播放列表：RN 侧没有半模态，用播放详情页承接（那里有列表入口）
    navigations.pushPlayDetailScreen(componentId, true)
  }, [componentId])

  const navigate = useCallback((action: string) => {
    // 子页面（设置 / 关于 / 本地音乐 …）由壳层自己承接：
    // 它内部有 subPage 状态，会整屏压上一个带返回栏的子页面。
    // 详情类（board: / playlist: / userlist:）本次未接入，先忽略。
    void action
  }, [])

  const openSearch = useCallback(() => {
    setNavActiveId('nav_search')
  }, [])

  const openNativePage = useCallback((page: string) => {
    setNativePage(page)
  }, [])

  return (
    <PageContent>
      {
        useTideShell
          ? (
            <View style={styles.fill}>
              <TideShell onOpenNativePage={openNativePage} />
              {nativePage != null && (
                <View style={StyleSheet.absoluteFill}>
                  <SubPageHost
                    page={nativePage}
                    topInset={topInset}
                    onBack={() => { setNativePage(null) }}
                  />
                </View>
              )}
            </View>
            )
          : useHarmonyShell
            ? (
              <Shell
                openPlayer={openPlayer}
                openQueue={openQueue}
                navigate={navigate}
                openSearch={openSearch}
              />
              )
            : (
                isHorizontalMode
                  ? <Horizontal />
                  : <Vertical />
              )
      }
    </PageContent>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
