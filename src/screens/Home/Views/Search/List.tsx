import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { InitState as SearchState } from '@/store/search/state'
import type { Source as MusicSource } from '@/store/search/music/state'
import type { Source as SongListSource } from '@/store/search/songlist/state'
import MusicList, { type MusicListType } from './MusicList'
import BlankView, { type BlankViewType } from './BlankView'
import SonglistList from './SonglistList'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

interface ListProps {
  onSearch: (keyword: string) => void
}
export interface ListType {
  loadList: (text: string, source: MusicSource | SongListSource, type: SearchState['searchType']) => void
}

/**
 * 综合（`both`）模式下左右两栏的宽度比例
 *
 * 歌曲那一栏要宽一点：它的行里有「序号 + 歌名 + 音质标签 + 歌手 + 时长 + 更多按钮」，
 * 固定占宽就有 38 + 44，太窄歌名会被截得很厉害；歌单那栏是封面宫格，
 * `Songlist` 自己会按栏宽算列数（最少 2 列），窄一点也能看。
 */
const BOTH_MUSIC_FLEX = 1.25

/** 综合模式下每栏顶部的小标题（让「左歌曲 / 右歌单」一眼可辨） */
const PaneHeader = ({ label }: { label: string }) => {
  const theme = useTheme()
  return (
    <View style={{ paddingLeft: 10, paddingTop: 6, paddingBottom: 2 }}>
      <Text size={13} color={theme['c-font-label']}>{label}</Text>
    </View>
  )
}

export default forwardRef<ListType, ListProps>(({ onSearch }, ref) => {
  const [listType, setListType] = useState<SearchState['searchType']>('both')
  const [showBlankView, setShowListView] = useState(true)
  // 两个列表各一个 ref：`both` 模式下它们**同时挂载**，共用一个 ref 会互相覆盖
  const musicRef = useRef<MusicListType>(null)
  const songlistRef = useRef<MusicListType>(null)
  const blankViewRef = useRef<BlankViewType>(null)
  const t = useI18n()
  const theme = useTheme()

  useImperativeHandle(ref, () => ({
    loadList(text, source, type) {
      if (text) {
        setShowListView(false)
        setListType(type)
        requestAnimationFrame(() => {
          // `both` = 两个都加载。上游是二选一，只加载被选中的那个。
          if (type != 'songlist') musicRef.current?.loadList(text, source)
          if (type != 'music') songlistRef.current?.loadList(text, source)
        })
      } else {
        setShowListView(true)
        requestAnimationFrame(() => {
          blankViewRef.current?.show(source)
        })
      }
    },
  }), [])

  if (showBlankView) return <BlankView ref={blankViewRef} onSearch={onSearch} />

  /**
   * 综合模式：**左歌曲 / 右歌单**并排
   *
   * 用户要求「搜索结果要歌单和歌曲一起搜出来，左边歌曲、右边歌单」。
   * 这里直接复用底座原有的 `MusicList` / `SonglistList`（各自带行内操作菜单、
   * 长按菜单、分页、下拉刷新），而不是重写两套列表 —— 重写会把那些交互全丢掉。
   * 两个列表都自带滚动，所以左右各自独立滚动。
   */
  if (listType == 'both') {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: BOTH_MUSIC_FLEX }}>
          <PaneHeader label={t('search_type_music')} />
          <MusicList ref={musicRef} />
        </View>
        {/* 中缝：hairline 竖线，3x 屏上也只占 1 个物理像素 */}
        <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: theme['c-border-background'] }} />
        <View style={{ flex: 1 }}>
          <PaneHeader label={t('search_type_songlist')} />
          <SonglistList ref={songlistRef} />
        </View>
      </View>
    )
  }

  return listType == 'songlist'
    ? <SonglistList ref={songlistRef} />
    : <MusicList ref={musicRef} />
})
