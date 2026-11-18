import { useEffect } from 'react'
import { View } from 'react-native'
import { useHorizontalMode } from '@/utils/hooks'

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { PLAYER_TOKENS } from '@/harmony/tokens'
import { PlayerThemeContext, buildPlayerTheme } from '@/harmony/PlayerTheme'
import { useContext, useMemo } from 'react'
import { ThemeContext } from '@/store/theme/state'

export default ({ componentId }: { componentId: string }) => {
  const isHorizontalMode = useHorizontalMode()
  const theme = useContext(ThemeContext)
  const playerTheme = useMemo(() => buildPlayerTheme(theme), [theme])

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 播放器**不用** `PageContent`，并且套一层深色主题
   *
   * 两个理由：
   *   1. `PageContent` 铺的是主题底色（亮色模式下浅灰 #F1F1F2），而鸿蒙的播放器
   *      恒为深色底 #0C0C0E（与深浅模式无关）；
   *   2. 光把根容器刷深还不够 —— 底座播放器里的文字/图标色是跟着主题走的，
   *      亮色主题下 `c-font` 是深灰，压在深底上就看不见了。
   *      所以用 `PlayerThemeContext` 覆盖整棵子树的主题（见 harmony/PlayerTheme.tsx）。
   */
  return (
    <PlayerThemeContext.Provider value={playerTheme}>
      <View style={{ flex: 1, backgroundColor: PLAYER_TOKENS.bg }}>
        <StatusBar />
        {
          isHorizontalMode
            ? <Horizontal componentId={componentId} />
            : <Vertical componentId={componentId} />
        }
      </View>
    </PlayerThemeContext.Provider>
  )
}
