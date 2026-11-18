/**
 * 我的页（鸿蒙 `views/MineView.ets` 的 RN 版）
 *
 * 结构照华为音乐的「我的」：
 *   上面一排快捷入口（本地音乐 / 最近播放 / 收藏 / 下载管理 / 云端音乐）
 *   中间一张歌单卡（自建歌单 + 收藏歌单 两段）
 *   下面一张设置卡（设置 / 帮助和反馈）
 *
 * 平板：歌单卡与设置卡按 2:1 并排（鸿蒙 5.5 的排布）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useTokens } from './useTokens'
import { CoverArt } from './CoverArt'
import { LxIcon, type IconName } from './LxIcon'
import { F_SECTION, F_ITEM, F_SUB, R_CARD } from './tokens'
import { isWideWindow } from './Layout'
import { useMyList } from '@/store/list/hook'
import { getListMusics } from '@/core/list'
import playerState from '@/store/player/state'
import { useWindowSize } from '@/utils/hooks'
import { LIST_IDS } from '@/config/constant'

/** 快捷入口（顺序照华为音乐：本地 / 最近播放 / 收藏 / 下载 / 云端） */
const ENTRIES: Array<{ icon: IconName, label: string, action: string }> = [
  { icon: 'folder', label: '本地音乐', action: 'local' },
  { icon: 'clock', label: '最近播放', action: 'history' },
  { icon: 'heartFill', label: '收藏', action: 'favorites' },
  { icon: 'download', label: '下载管理', action: 'downloads' },
  { icon: 'cloud', label: '云端音乐', action: 'cloud' },
]

/** 设置卡的两行 */
const LINKS: Array<{ icon: IconName, label: string, action: string }> = [
  { icon: 'gear', label: '设置', action: 'settings' },
  { icon: 'help', label: '帮助和反馈', action: 'about' },
]

interface MinePageProps {
  /** 状态栏高度：标题栏是沉浸式的，内容要让出这一段 */
  topInset: number
  onNavigate: (action: string) => void
}

export const MinePage = ({ topInset, onNavigate }: MinePageProps) => {
  const t = useTokens()
  const { width: winWidth } = useWindowSize()
  const allList = useMyList()
  const [playlistTab, setPlaylistTab] = useState(0)

  const wide = isWideWindow(winWidth)

  // useMyList() 返回 allList（默认列表 / 收藏列表 / 自建歌单 混在一起），
  // 按 id 挑出要用的两类
  const userList = useMemo(
    () => allList.filter(
      (item): item is LX.List.UserListInfo =>
        item.id !== LIST_IDS.DEFAULT && item.id !== LIST_IDS.LOVE && item.id !== LIST_IDS.TEMP,
    ),
    [allList],
  )
  // 收藏的歌（内置那张收藏歌单）的曲目数
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  /** 最近播放的条数（播放历史） */
  const [historyCount, setHistoryCount] = useState(0)

  const refreshCounts = useCallback(() => {
    void getListMusics(LIST_IDS.LOVE).then(list => { setFavoriteCount(list.length) })
    for (const list of userList) {
      void getListMusics(list.id).then(musics => {
        setCounts(prev => (prev[list.id] === musics.length ? prev : { ...prev, [list.id]: musics.length }))
      })
    }
  }, [userList])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts])

  // 最近播放：订阅播放历史变更
  useEffect(() => {
    const update = (playedList: Array<unknown>) => { setHistoryCount(playedList.length) }
    setHistoryCount(playerState.playedList.length)
    global.state_event.on('playPlayedListChanged', update)
    return () => {
      global.state_event.off('playPlayedListChanged', update)
    }
  }, [])

  const playlistCard = (
    <View
      style={{
        width: '100%',
        borderRadius: R_CARD,
        backgroundColor: t.card,
        overflow: 'hidden',
      }}
    >
      {/* 段头 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 54,
          paddingLeft: 14,
          paddingRight: 14,
        }}
      >
        <TouchableOpacity onPress={() => { setPlaylistTab(0) }} activeOpacity={0.6}>
          <Text
            style={{
              fontSize: F_SECTION,
              fontWeight: playlistTab === 0 ? '700' : '500',
              color: playlistTab === 0 ? t.text : t.textSub,
            }}
          >
            自建歌单
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: F_SUB, color: t.textWeak }}>{userList.length}</Text>
        <Text style={{ fontSize: F_SECTION, color: t.divider, paddingHorizontal: 2 }}>|</Text>
        <TouchableOpacity onPress={() => { setPlaylistTab(1) }} activeOpacity={0.6}>
          <Text
            style={{
              fontSize: F_SECTION,
              fontWeight: playlistTab === 1 ? '700' : '500',
              color: playlistTab === 1 ? t.text : t.textSub,
            }}
          >
            收藏歌单
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: F_SUB, color: t.textWeak }}>0</Text>
        <View style={{ flex: 1 }} />
      </View>

      {playlistTab === 0 ? (
        <View>
          {/* 动作区：新建歌单 / 歌单导入 */}
          <View style={{ width: '100%', paddingLeft: 14, paddingRight: 14, paddingBottom: 10 }}>
            <View
              style={{
                width: '100%',
                height: 64,
                borderRadius: 16,
                backgroundColor: t.fillSoft,
                overflow: 'hidden',
                flexDirection: 'row',
              }}
            >
              <CardAction icon="plus" label="新建歌单" onPress={() => { onNavigate('newPlaylist') }} />
              <CardAction icon="import" label="歌单导入" onPress={() => { onNavigate('importPlaylist') }} />
            </View>
          </View>

          {userList.length === 0 ? (
            <Text
              style={{
                fontSize: F_SUB,
                color: t.textWeak,
                paddingLeft: 14,
                paddingRight: 14,
                paddingTop: 4,
                paddingBottom: 18,
                lineHeight: 20,
              }}
            >
              还没有歌单，点上面的「新建歌单」建一个，或者用「歌单导入」粘贴一张分享链接
            </Text>
          ) : (
            userList.map((list, index) => (
              <View key={list.id}>
                {index > 0 && (
                  <View style={{ height: 0.6, backgroundColor: t.divider, marginLeft: 72 }} />
                )}
                <PlaylistRow
                  name={list.name}
                  count={counts[list.id] ?? 0}
                  onPress={() => { onNavigate(`userlist:${list.id}`) }}
                />
              </View>
            ))
          )}
        </View>
      ) : (
        // 收藏歌单（收藏的线上歌单）—— RN 侧未实现该能力，给明确空态
        <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 28, gap: 6 }}>
          <LxIcon name="heartFill" size={28} color={t.textWeak} />
          <Text style={{ fontSize: F_SUB, color: t.textSub }}>还没有收藏的歌单</Text>
          <Text style={{ fontSize: 11.5, color: t.textWeak, textAlign: 'center', paddingHorizontal: 24 }}>
            在推荐页点开一张歌单，点里面的「收藏歌单」就会收进来
          </Text>
        </View>
      )}
    </View>
  )

  const linksCard = (
    <View
      style={{
        width: '100%',
        borderRadius: R_CARD,
        backgroundColor: t.card,
        overflow: 'hidden',
      }}
    >
      {LINKS.map((link, index) => (
        <View key={link.action}>
          {index > 0 && (
            <View style={{ height: 0.6, backgroundColor: t.divider, marginLeft: 50 }} />
          )}
          <TouchableOpacity
            style={{
              height: 58,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingLeft: 14,
              paddingRight: 14,
            }}
            onPress={() => { onNavigate(link.action) }}
            activeOpacity={0.6}
          >
            <LxIcon name={link.icon} size={22} color={t.text} />
            <Text style={{ flex: 1, fontSize: F_ITEM, color: t.text }}>{link.label}</Text>
            <LxIcon name="chevronRight" size={18} color={t.chevron} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: topInset + 8,
          paddingBottom: 96,
          gap: 14,
        }}
      >
        {/* 标题 */}
        <Text style={{ fontSize: 29, fontWeight: '700', color: t.text }}>我的</Text>

        {/* 快捷入口卡 */}
        <View
          style={{
            width: '100%',
            borderRadius: R_CARD,
            backgroundColor: t.card,
            flexDirection: 'row',
            paddingTop: 16,
            paddingBottom: 14,
          }}
        >
          {ENTRIES.map(entry => (
            <QuickEntry
              key={entry.action}
              icon={entry.icon}
              label={entry.label}
              // 规格要求 5 个入口**都显示条数**（缺一个会让这一排的行高参差）。
              // 底座能拿到真实条数的：最近播放（播放历史）/ 收藏（内置收藏歌单）；
              // 本地音乐、下载管理、云端音乐在安卓版底座里没有对应的计数接口，
              // 这里统一显示 0 而不是留空 —— 留空会让「收藏」那一格独高，视觉不齐。
              count={
                entry.action === 'history'
                  ? historyCount
                  : entry.action === 'favorites'
                    ? favoriteCount
                    : 0
              }
              onPress={() => { onNavigate(entry.action) }}
            />
          ))}
        </View>

        {/* 宽屏：歌单卡 2 份 + 设置卡 1 份并排；窄屏上下堆叠 */}
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            <View style={{ flex: 2 }}>{playlistCard}</View>
            <View style={{ flex: 1 }}>{linksCard}</View>
          </View>
        ) : (
          <>
            {playlistCard}
            {linksCard}
          </>
        )}
      </ScrollView>
    </View>
  )
}

// ---------------------------------------------------------------- 子组件

const QuickEntry = ({
  icon,
  label,
  count,
  onPress,
}: {
  icon: IconName
  label: string
  count?: number
  onPress: () => void
}) => {
  const t = useTokens()
  return (
    <TouchableOpacity
      style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 4 }}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 15,
          backgroundColor: t.redTint,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <LxIcon name={icon} size={23} color={t.red} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 13, color: t.text }}>{label}</Text>
      {/* 条数行始终占位（没有条数也给个空串），这样 5 个入口的图标/文字基线一致 */}
      <Text style={{ fontSize: 11, color: t.textWeak }}>{count ?? ''}</Text>
    </TouchableOpacity>
  )
}

const CardAction = ({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) => {
  const t = useTokens()
  return (
    <TouchableOpacity
      style={{ flex: 1, height: '100%', justifyContent: 'center', alignItems: 'center', gap: 6 }}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <LxIcon name={icon} size={23} color={t.text} />
      <Text style={{ fontSize: 13, color: t.text }}>{label}</Text>
    </TouchableOpacity>
  )
}

const PlaylistRow = ({
  name,
  count,
  onPress,
}: {
  name: string
  count: number
  onPress: () => void
}) => {
  const t = useTokens()
  return (
    <TouchableOpacity
      style={{
        height: 70,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 14,
        paddingRight: 14,
      }}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          backgroundColor: t.redTint,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <LxIcon name="playlist" size={22} color={t.red} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={1} style={{ fontSize: F_ITEM, color: t.text }}>{name}</Text>
        <Text style={{ fontSize: F_SUB, color: t.textWeak }}>{count} 首</Text>
      </View>
      <LxIcon name="chevronRight" size={18} color={t.chevron} />
    </TouchableOpacity>
  )
}
