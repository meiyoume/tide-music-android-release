/**
 * 「音源」二级页（「我的 · 音源切换 / 添加歌源」两行的落点）
 *
 * 直接复用底座设置里的 `Basic/Source` —— 那一块本来就是完整的音源管理：
 * 列表里点一下就是切换，底下那颗按钮里有「从本地导入 / 在线导入」，
 * 弹层里还能删掉不用的源、看脚本版本。
 *
 * 为什么不自己在潮汐界面里重做一份：文件选择、脚本格式校验、重复导入、
 * 版本与更新提醒这些底座都做完了，重写一遍只会两边各自漂移。
 * （潮汐界面只负责那一行的摘要文字，换源后由内核的 apiSourceUpdated 事件推回去。）
 *
 * `autoAdd` 给「添加歌源」那一行用：进来直接把导入弹层弹出来，
 * 用户点的是「添加」，不该先看到一张列表再自己找按钮。
 */
import { memo } from 'react'
import { ScrollView } from 'react-native'
import { PaneShell } from './Panes'
import Source from '@/screens/Home/Views/Setting/settings/Basic/Source'

export const ApiSourcePane = memo(({ topInset, onBack, autoAdd }: {
  topInset: number
  onBack: () => void
  autoAdd?: boolean
}) => {
  return (
    <PaneShell title="音源" topInset={topInset} onBack={onBack}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Source autoAdd={autoAdd} />
      </ScrollView>
    </PaneShell>
  )
})
