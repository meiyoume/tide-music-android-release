/**
 * 歌曲行（鸿蒙 `views/SongListPane.ets` 的行 + 歌单详情的行，RN 版）
 *
 * 尺寸取自 HARMONY_UI_SPEC.md：
 *   - 歌单 / 在线详情 / 搜索结果：封面 50、圆角 12、行高 72
 *   - 播放列表：封面 44、圆角 12、行高 66
 *
 * 行尾按「当前是否在播」显示跳动符，右侧是「更多」钮（长按也能出行菜单）。
 */
import { memo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTokens } from './useTokens'
import { CoverArt } from './CoverArt'
import { LxIcon } from './LxIcon'
import { F_ITEM, F_SUB } from './tokens'

interface SongRowProps {
  name: string
  singer: string
  /** 封面地址 */
  pic?: string | null
  /** 是否当前正在播的这首 */
  isCurrent?: boolean
  /** 序号（不传则不显示序号列） */
  index?: number
  /** 行高（默认 72；播放列表传 66） */
  height?: number
  /** 封面边长（默认 50；播放列表传 44） */
  coverSize?: number
  onPress?: () => void
  onLongPress?: () => void
  /** 行尾「更多」钮 */
  onMore?: () => void
  /** 行尾额外内容（如时长） */
  trailing?: React.ReactNode
  style?: React.ComponentProps<typeof View>['style']
}

export const SongRow = memo(({
  name,
  singer,
  pic,
  isCurrent = false,
  index,
  height = 72,
  coverSize = 50,
  onPress,
  onLongPress,
  onMore,
  trailing,
  style,
}: SongRowProps) => {
  const t = useTokens()

  return (
    <View style={[{ height, flexDirection: 'row', alignItems: 'center' }, style]}>
      <TouchableOpacity
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, gap: 12 }}
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.6}
      >
        {index !== undefined && (
          <Text style={{ width: 24, textAlign: 'center', fontSize: 13, color: t.textWeak }}>
            {index + 1}
          </Text>
        )}
        <CoverArt url={pic} name={name} size={coverSize} radius={12} />
        <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: F_ITEM, color: isCurrent ? t.red : t.text }}
          >
            {name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: F_SUB, color: t.textWeak }}>
            {singer}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
        {trailing}
        {isCurrent && <LxIcon name="volume" size={19} color={t.red} />}
        {onMore && (
          <TouchableOpacity
            onPress={onMore}
            style={{ paddingHorizontal: 10, paddingVertical: 10 }}
            activeOpacity={0.6}
          >
            <LxIcon name="more" size={18} color={t.textSub} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
})

/** 行间分割线（起止内缩，与鸿蒙的 startMargin 一致） */
export const RowDivider = ({ inset = 0 }: { inset?: number }) => {
  const t = useTokens()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth < 1 ? 0.6 : StyleSheet.hairlineWidth,
        backgroundColor: t.divider,
        marginLeft: inset,
      }}
    />
  )
}
