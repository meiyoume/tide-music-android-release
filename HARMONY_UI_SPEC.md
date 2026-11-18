# 聆听（洛雪音乐鸿蒙移植版）UI 实现规格 —— React Native 复刻依据

> 来源：`D:\lxmusic-harmony-upstream`（HarmonyOS ArkTS 工程）。
> 本文件是**唯一实现依据**：所有尺寸单位一律为 **vp / dp**（1:1 映射到 RN 的 `dp`），
> 所有色值均已从 ArkTS 的 `#AARRGGBB` 转成 RN 可用的 `#RRGGBBAA` / `rgba()` 形式。
> 未标注来源的数值均直接取自源码常量。

---

## 0. 跨平台映射速查（先读这一节）

### 0.1 色值格式陷阱（**必须遵守**）

ArkTS 的 8 位色值是 `#AARRGGBB`（透明度在**前**），React Native 是 `#RRGGBBAA`（透明度在**后**）。
本文件所有色值已转换完毕，可直接使用。转换示例：

| ArkTS 原值 | 含义 | RN 值 |
|---|---|---|
| `#1AFFFFFF` | 10% 白 | `#FFFFFF1A` |
| `#B8FFFFFF` | 72% 白 | `#FFFFFFB8` |
| `#14E33B3B` | 洛雪红 8% 底 | `#E33B3B14` |
| `#66F1F1F2` | 页面底色 40% | `#F1F1F266` |

### 0.2 结构映射

| ArkTS 概念 | RN 对应做法 |
|---|---|
| `Column` / `Row` | `View` + `flexDirection: 'column' / 'row'` |
| `Stack` | `View` + `position: 'absolute'` 子项，或 `alignItems/justifyContent` |
| `List` + `LazyForEach` | `FlatList`（`keyExtractor` 用源码里的 key 规则） |
| `List.lanes(n)` | `FlatList` + `numColumns={n}`（n 变化时需改 `key` 强制重建） |
| `ListItemGroup({header, footer})` | `FlatList` 的 `ListHeaderComponent` / `ListFooterComponent` |
| `ListItemGroup({style: CARD})` | 外层 `View` 给卡片底 + 圆角 + `overflow:'hidden'` |
| `Divider` | `View` 高 `StyleSheet.hairlineWidth` 或固定 0.6 |
| `bindSheet` | `@gorhom/bottom-sheet` 或 `Modal` + 自定义拖拽（`detents` → `snapPoints`） |
| `bindMenu` | `react-native-popup-menu` / `@react-native-menu/menu` |
| `showAlertDialog` | `Alert.alert`（按钮 `fontColor` 对应 `style: 'destructive'`） |
| `showToast` | `ToastAndroid` 或 `react-native-root-toast` |
| `Refresh` | `FlatList` 的 `refreshing` / `onRefresh` |
| `Swiper` | `react-native-pager-view` 或 `FlatList horizontal pagingEnabled` |
| `SwiperController` | `PagerView` 的 `setPage()` |
| `symbolEffect(replaceEffect)` | 图标交叉淡入（`Animated` opacity/scale 120ms） |
| `Toggle(Switch)` | `Switch`（`trackColor.true = C_RED`） |
| `Slider` | `@react-native-community/slider` |
| `TextInput` | `TextInput` |
| `Search` | 自绘 `View` + `TextInput` + 放大镜图标 |
| `Progress(Ring)` | `react-native-svg` 的 `Circle` + `strokeDasharray` |
| `LoadingProgress` | `ActivityIndicator` |
| `AttributeModifier`（玻璃） | 普通 `View` 样式对象（见第 6 章） |
| `AppStorage` + `@StorageLink` | Zustand / Redux / Context（键名沿用源码里的 `K_*`） |

### 0.3 全局常量（源码常量名 → 值）

| 常量 | 值 | 用途 |
|---|---|---|
| `HDS_TITLE_BAR_HEIGHT` | `60` | 子页面标题栏高度（不含状态栏） |
| `HDS_BAR_HEIGHT` | `56` | 底部悬浮页签栏 / 迷你栏 / 页内迷你栏高度 |
| `R_PILL` | `30` | 底部悬浮胶囊圆角 |
| `R_CARD` | `16` | 卡片圆角 |
| `R_COVER` | `12` | 列表封面默认圆角 |
| `F_TITLE` | `29` | 页面大标题字号 |
| `F_SECTION` | `17` | 分组标题字号 |
| `F_ITEM` | `16.5` | 列表主标题字号 |
| `F_SUB` | `12.5` | 列表副标题字号 |
| `F_TAB` | `10.5` | 底部导航文字 / 多选底栏文字字号 |
| `ROW_H` | `46` | 设置页单行高度 |
| `SLIDER_W` | `116` | 设置页滑块轨道宽度 |
| `PAGE_BAR_BOTTOM_GAP` | `10` | 页内迷你栏离手势条距离 |
| `CONTENT_MAX_WIDTH` | `720` | 表单类控件最大宽度 |
| `HOME_ROW_MIN_WIDTH` | `360` | 宽屏一行最小宽度 |
| `HOME_COLUMNS_MAX` | `4` | 宽屏最大列数 |
| `BP_COMPACT` / `BP_MEDIUM` / `BP_EXPANDED` | `440` / `600` / `840` | 宽屏断点 |

---

## 1. 应用壳层结构

### 1.1 层级关系图

```
Stack (alignContent: Bottom, backgroundColor: C_BG, 铺满全屏含状态栏与手势条)
│
├── HdsNavigation (pathStack, mode: Stack, titleMode: MINI, hideBackButton: true)
│   │  标题栏 = homeTitleBar()：纯透明，maskExtraHeight=0，enableScrollEffect=false
│   │  └── content.stackBuilder → homeHeader()（见 1.3）
│   │
│   ├── HdsTabs (barPosition: End, vertical: false, barMode: Fixed,
│   │            barOverlap: true, scrollable: true, barHeight: 56, zIndex: 1)
│   │   ├── TabContent → WidePane → RecommendView      .tabBar(tabBarItem('home'))
│   │   ├── TabContent → WidePane → ListenView         .tabBar(tabBarItem('listen'))  ← 可隐藏
│   │   └── TabContent → WidePane → MineView           .tabBar(tabBarItem('mine'))
│   │   └── .barFloatingStyle({ barWidth, barBottomMargin, systemMaterialEffect, miniBar })
│   │
│   ├── .bindSheet(playerOpen)  → 全屏播放器 PlayerView
│   └── .navDestination(destination) → 各子页面 HdsNavDestination
│
├── 状态提示条（toast.length > 0 时）
│      align: Bottom, margin { left:16, right:16, bottom: bottomInset + 92 }
│
├── 音源沙箱  Column 1×1 @ (0,0)
├── 听书沙箱  Column 1×1 @ (0,0)
│
├── DustLayer（全局唯一的删除粒子层）
│
├── Column 1×1 @ (0,0)  .bindSheet(syncModeOpen) → 同步方式选择半模态
│
└── .bindSheet(queueOpen) → 播放列表半模态 PlayQueueContent
```

**关键点**：
- 播放器半模态挂在 **HdsNavigation 节点**上，播放列表半模态挂在 **最外层 Stack** 上 —— 两者必须挂不同节点，同一节点叠两个 `bindSheet` 会互相干扰。
- 音源沙箱与听书沙箱是两个**独立**的 1×1 页面（一个禁 eval、一个要 eval），不能合并。

### 1.2 底部悬浮页签栏

**页签定义**（`key` 是身份，与「第几栏」无关；听书可隐藏，隐藏后栏位下标整体前移）：

| key | 未选中图标 | 选中图标 | 文字 |
|---|---|---|---|
| `home` | `house` | `house_fill` | **推荐** |
| `listen` | `book_pages` | `book_pages_fill` | **听书** |
| `mine` | `person` | `person_fill` | **我的** |

**单个页签（`tabBarItem`）**：
```
Column, space: 4, justifyContent: center, alignItems: center, borderRadius: 16
├── Icon  22×22, fontWeight Regular, 颜色 = 选中 ? C_RED : C_ICON
└── Text  字号 11, 颜色 = 选中 ? C_RED : C_ICON
```

**栏体几何**：

| 项 | 值 |
|---|---|
| 高度 | `56`（`HDS_BAR_HEIGHT`，必须与迷你栏等高） |
| 窄屏宽度 `smallWidth` | `windowWidth - 96`；窗口宽读到 0 时兜底 `264` |
| 中档宽度 `mediumWidth` | `72 × 可见页签数`（3 个 = 216，2 个 = 144） |
| 大档宽度 `largeWidth` | `80 × 可见页签数`（3 个 = 240，2 个 = 160） |
| 离底距离 `barBottomMargin` | `max(16, bottomInset)` |
| 左右边距 | 见 5.2 `barSideMarginFor()` |
| 页签栏与迷你栏之间的缝 | `8` |

> **不要**自己算迷你栏宽度塞给框架（会顶掉让位动画）。宽度只声明页签栏那一档，
> 迷你栏多宽、怎么让位由框架按形态自己算。

### 1.3 首页标题栏（页头）

```
Row, space: 10, width: '100%', padding { left: 16, right: 16 }
├── PageTitle  文本 = 当前页签 label，字号 29, Bold, C_TEXT
├── Blank（弹性占位）
└── 仅「推荐」页签：
    ├── sourcePicker()   来源下拉胶囊
    ├── RoundIconButton  icon=identify_song, boxSize 40, iconSize 21, label「听歌识曲」
    └── RoundIconButton  icon=magnifyingglass, boxSize 40, iconSize 21, label「搜索」
```

「我的」页签的动作全在页面卡片里，标题栏这一行不再挂东西。

**来源下拉胶囊 `sourcePicker()`**：
```
Row, space: 3, height: 36, padding { left: 14, right: 10 }
背景 = materialFirstGlass(radius 18)   ← 材质优先，材质可用时只留圆角 + 透明底
├── Text  平台名, 字号 14.5, Medium, C_TEXT, maxLines 1
└── Icon  chevron_down, 14, C_TEXT_SUB
```
菜单项：酷我 / 酷狗 / 咪咕 / QQ / 网易云（`LIST_PLATFORMS`）。

### 1.4 迷你播放栏（MiniBar）

折叠与展开**画同一份内容**，只有封面尺寸与留白不同。

**折叠态**：HDS 只给一颗圆钮的宽度，右侧内容被裁掉，视觉上就是一颗圆封面。

**展开态结构**：
```
Row, space: 8, width: '100%', height: '100%', alignItems: Center
padding { left: 6, right: 16, top: 6, bottom: 6 }   ← 页签里那条
│
├── coverView()  Stack(center)，尺寸 = coverSide()
│   ├── 淡圆底        width/height = coverSide, borderRadius = coverSide/2, backgroundColor: C_ICON_CIRCLE
│   ├── 应用图标      app.media.startIcon, objectFit Cover, 同上尺寸与圆角（加载期露的就是它）
│   ├── 真封面        仅 cover.length > 0 时叠加（优先画已解好的位图，避免切页签时先黑一下）
│   ├── 进度环        Progress(Ring), 尺寸同上, backgroundColor C_SLIDER_TRACK, color C_RED,
│   │                 strokeWidth 1.8, blendMode OVERLAY
│   └── 跳动符        仅 status==='playing' && !buffering，symbol `rhythm`, 24, C_TEXT
│
└── aside()  Column, layoutWeight 1, alignItems Start
    ├── Column, space: 0
    │   ├── Text 歌名  12, Bold, lineHeight 16, C_TEXT, maxLines 1, ellipsis
    │   └── Text 歌手  10, lineHeight 13, C_TEXT_SUB, maxLines 1, ellipsis
    │       └── 点击 → 打开全屏播放器
    └── Row, space: 16（CONTROL_GAP）
        ├── 播放/暂停  24，playing 时 pause_circle_fill，否则 play_circle_fill，色 C_TEXT
        │               loading/buffering 时换成 ActivityIndicator 24，色 C_TEXT
        ├── 下一首     forward_end_fill, 24, C_ICON
        └── 播放列表   music_note_list, 24, C_ICON
```

**尺寸常量**：

| 常量 | 值 | 说明 |
|---|---|---|
| `COVER_COLLAPSED` | `56` | 折叠态封面边长（正好填满圆钮） |
| `COVER_EXPANDED` | `44` | 展开态封面边长 |
| `COVER_INSET_V` | `6` | 封面上下留白（56 = 6 + 44 + 6） |
| `CONTROL_SIZE` | `24` | 控制钮图标大小 |
| `CONTROL_GAP` | `16` | 控制钮间距 |
| `FORCE_EXPANDED_SIDE_INSET` | `4` | **页内那条**迷你栏的左右留白（不是页签里那条） |
| `TITLE_SIZE` / `TITLE_LINE` | `12` / `16` | 歌名字号 / 行高 |
| `SINGER_SIZE` / `SINGER_LINE` | `10` / `13` | 歌手字号 / 行高 |

**折叠态左右留白按窗口分档**（`sideInsetFor`，与派音 `BreakpointType(16,24,32,32)` 一致）：

| 窗口宽度 | 留白 |
|---|---|
| `< 600` | `16` |
| `600 – 840` | `24` |
| `≥ 840` | `32` |

**手势**：竖直 `PanGesture`，`onActionEnd` 时若 `offsetY < -10` → 打开全屏播放器。

### 1.5 全屏播放器弹出方式

系统底部半模态 `bindSheet`，挂在 HdsNavigation 节点上：

| 参数 | 值 |
|---|---|
| `preferType` | `BOTTOM` |
| `detents` | `[LARGE]`（接近满屏，顶部留一条） |
| `detentSelection` | `LARGE` |
| `dragBar` | `false`（播放器自己的顶栏就是头部） |
| `showClose` | `false` |
| `onWillAppear` | 状态栏字色 → 白 |
| `onDisappear` | 状态栏字色 → 按深浅模式 |

传给 `PlayerView` 的 `topInset` 是 **0**（半模态顶边已在状态栏下方，再让一次会多出空白），
`bottomInset` 照常传手势条高度。

### 1.6 播放列表半模态

| 参数 | 值 |
|---|---|
| `preferType` | `BOTTOM` |
| `detents` | `[MEDIUM, LARGE]`，默认停 `MEDIUM` |
| `dragBar` | `true` |
| `showClose` | `true` |
| `title` | 标题 **播放列表**，副标题 `共 ${queueCount} 首` |
| `blurStyle` | 材质不可用时 `COMPONENT_ULTRA_THICK`，可用时 `undefined` |
| `backgroundColor` | 材质可用时 `transparent`，否则 `undefined`（默认白，会盖住材质） |
| `systemMaterial` | 材质可用时 `immersiveMaterialForDialog(level)` |

`isShow` 双向绑定：下滑或点关闭钮时状态位自动收回。

### 1.7 提示条（Toast）

```
Column
├── Text  字号 F_SUB(12.5), C_TEXT, maxLines 3, ellipsis
constraintSize { maxWidth: '86%' }
padding { left: 14, right: 14, top: 10, bottom: 10 }
玻璃 = thinGlass(radius 18, tint = C_GLASS_SOLID)
align Bottom, margin { left: 16, right: 16, bottom: bottomInset + 92 }
transition = OPACITY, 200ms
自动消失：3200ms
```

### 1.8 子页面标题栏（HDS）

**常规态**（`titleBarOptions(title, scroller?)`）：
- `avoidLayoutSafeArea: true`
- `enableScrollEffect: false`（**必须关**，否则一滑就变灰白）
- `blurStrategy: DISABLE`，`backgroundColor: transparent`，`maskExtraHeight: 0`
- `systemMaterialEffect: buildTitleMaterial(materialLevel)`（只作用于**按钮**）
- 标题与图标色 `sys.color.font_primary`
- `title` 传空串时只留返回键（歌单详情 / 在线详情 / 书籍详情，名字已写在封面下方）

**多选态**（`pageTitleBar`，`selectBarActive === true` 时整条换掉）：

| 槽位 | 内容 |
|---|---|
| `title` | `已选中 ${selectBarCount} 项`，字号 `TITLE_ML` |
| `backIcon` | 图标 `xmark`，label **取消**，action → 退出多选 |
| `menu` | 图标 `checkmark_square_on_square`，label `selectBarAll ? '取消全选' : '全选'` |

三样都走 HDS 自己的槽位，样式与常规态**一个字都不改**，所以叉与全选的玻璃动效与返回键同源。

**内容让位**：`HDS_TITLE_BAR_HEIGHT + topInset`（= `60 + 状态栏高度`）。

---

## 2. 页面规格

### 2.1 推荐页 RecommendView

**整体**：
```
Stack (alignContent: TopStart), backgroundColor: C_BG
├── Column
│   ├── Refresh
│   │   └── List, space: 0
│   │       ├── ListItemGroup
│   │       │   ├── header = listHeader()   ← 通栏（分栏模式下组头自己占满整行）
│   │       │   ├── 每条 = playlistRow(item)
│   │       │   └── footer = listFooter()   ← 通栏
│   │       ├── lanes = contentColumnsFor(windowWidth)
│   │       ├── contentStartOffset = topInset + 6
│   │       └── onReachEnd → loadMore()
│   │   .layoutWeight(1)
│   └── TopFade  fadeHeight = topInset + 10
```

**`listHeader()` 三段**：

1）**在线榜单区**（`boards.length > 0` 时）：

```
Row, space: 8, width: '100%', padding { left:16, right:16, top:8, bottom:12 }
├── SectionTitle  「在线榜单」字号 17, Bold, C_TEXT
├── Text  平台名, 字号 12, C_RED, padding {8,8,2,2}, borderRadius 9, backgroundColor C_RED_TINT
└── Blank

List (horizontal), space: 12, width: '100%', height: 212, padding { left:16, right:16 }
└── ListItem → RankCard
```

**RankCard 规格**：

| 项 | 值 |
|---|---|
| 卡片尺寸 | 宽 `columns > 1 ? 216 : 180`，高 `212` |
| 圆角 / 裁剪 | `borderRadius 22`, `clip: true` |
| 阴影 | `radius 16, color #0000001F, offsetX 0, offsetY 6` |
| 主渐变 | `angle 160`, `colorA → colorB` |
| 底部压暗层 | 高 `58%`, `angle 0`, `#00000000 → #00000066` |
| 左上角标 | `Circle 17` 白底 + `mic` 图标 11 色 `#E2432F`；平台文字 11.5 `#FFFFFFE6`；`padding { left:13, top:13 }` |
| 中央大标题 | 字号 `34`, Bold, 白, `textShadow { radius:12, color:#00000033, offsetY:3 }` |
| 底部信息条 | 高 `80`, `padding { left:13, right:13 }` |
| 底部歌名 | 字号 `18`, Bold, 白, maxLines 1 |
| 底部副标题 | 字号 `11.5`, `#FFFFFFB3`（固定文案 **在线排行榜**） |
| 播放圆钮 | `Stack 38×38`，内含 `Circle 34` 白 + `play_fill` 19 色 `#1A1A1A` |
| 信息条内间距 | `space: 8`；文字列 `space: 3` |

**榜单配色循环表**（按榜单顺序取，同榜每次进入颜色不变）：
```
['#7B6CF6','#4E3FD6']  ['#3FD07A','#17A94F']  ['#FF7A59','#E2432F']
['#4FA8FF','#1E6FD9']  ['#FFB13D','#E0810F']  ['#F26DB4','#C22C86']
```

2）**推荐歌单标题行**：

```
Row, space: 8, width: '100%'
padding { left:16, right:16, top: 有榜单 ? 22 : 4, bottom: 10 }
├── SectionTitle  「推荐歌单」17, Bold, C_TEXT
├── Blank
├── 加载中…  仅 loadingMore 时，字号 12, C_TEXT_WEAK
└── 排序下拉（sorts.length > 1 时）
    Row, space: 3, height: 30, padding { left:12, right:8 }
    背景 = thinGlass(radius 15)
    ├── Text  当前排序名, 13, Medium, C_RED, maxLines 1
    └── Icon  chevron_down, 13, C_RED
```

排序项由平台决定（各平台给了几个就用几个，只有一个时不显示）。

3）**歌单行 `playlistRow`**：

```
Row, space: 12, width: '100%', height: 78, padding { left:16, right:16 }
├── CoverArt  boxSize 58, radius 14
├── Column, space: 5, layoutWeight 1, alignItems Start
│   ├── Text 歌名  字号 F_ITEM(16.5), C_TEXT, maxLines 2, ellipsis
│   └── Text meta  字号 F_SUB(12.5), C_TEXT_SUB, maxLines 1, ellipsis
│        meta = [作者, 播放量, `${total} 首`] 用 ' · ' 连接（有谁显示谁）
└── Icon  chevron_right, 17, C_CHEVRON
```
行与行之间**不画分隔线**。

**`listFooter()`**：

| 情况 | 内容 |
|---|---|
| `playlists.length === 0` | 状态块：`Column space 10`, `padding { left:32, right:32, top:40, bottom:30 }` |
| └ 加载中 | `正在加载${平台名}的推荐…` 字号 14.5, C_TEXT_SUB |
| └ 出错 | 错误文字 13.5 C_TEXT_SUB + 「点击重试」14 Medium C_RED，`padding {18,18,8,8}`, `borderRadius 18`, `backgroundColor C_RED_TINT` |
| └ 空 | `这个来源暂时没有推荐内容` 14.5, C_TEXT_SUB |
| 有数据 + 出错 | 错误 13 C_TEXT_WEAK + 「点击重试」13.5 C_RED，`padding { top:14, bottom:14 }` |
| 有数据正常 | 状态行 13 C_TEXT_WEAK 居中，`padding { top:16, bottom:16 }`：`正在加载更多…` / `没有更多了` / `上拉加载更多` |
| 末尾 | 底部占位 `height = bottomInset + 12` |

**分页**：一页 30 条；`onReachEnd` 拉下一页；某页返回空即置 `noMore`。

---

### 2.2 我的页 MineView

**整体**：
```
Stack (TopStart), backgroundColor: C_BG
├── Column
│   ├── Scroll, scrollBar off, align Top, layoutWeight 1
│   │   └── Column, space: 14, padding { left:16, right:16, bottom: bottomInset + 16 }
│   │       ├── 顶部占位  height = topInset + 6
│   │       ├── quickCard()
│   │       ├── 宽屏：Row space 14 alignItems Top
│   │       │   ├── playlistCard()  layoutWeight 2
│   │       │   └── linksCard()     layoutWeight 1
│   │       └── 窄屏：playlistCard() → linksCard()（上下）
│   └── TopFade  fadeHeight = topInset + 10
├── bindSheet(editOpen)   → 新建/重命名歌单
└── 1×1 节点 bindSheet(importOpen) → 导入歌单
```

**快捷入口卡 `quickCard()`**：

```
Row, width: '100%', padding { top:16, bottom:14 }
borderRadius R_CARD(16), backgroundColor C_CARD
└── 5 个入口，每个 layoutWeight 1, justifyContent Center, borderRadius 14
    Column, space: 6
    ├── Stack 44×44
    │   ├── 图标底  44×44, borderRadius 15, backgroundColor C_RED_TINT
    │   └── Icon    iconSize 23, color C_RED
    ├── Text 名称   字号 F_SUB + 0.5 = 13, C_TEXT, maxLines 1
    └── Text 条数   字号 11, C_TEXT_WEAK
    按压态：backgroundColor C_PRESSED
```

| 顺序 | 图标 | 名称 | 条数来源 | action |
|---|---|---|---|---|
| 1 | `folder` | **本地音乐** | `LocalMusic.songsForUi().length` | `local` |
| 2 | `clock` | **最近播放** | `PlaySession.history.length` | `history` |
| 3 | `heart_fill` | **收藏** | 内置收藏歌单曲目数 | `favorites` |
| 4 | `download` | **下载管理** | `DownloadManager.list().length` | `downloads` |
| 5 | `cloud` | **云端音乐** | `WebDavLibrary.songsForUi().length` | `cloud` |

**歌单卡 `playlistCard()`**：

```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
│
├── 段头 Row, space: 6, height: 54, padding { left:14, right:14 }
│   ├── Text「自建歌单」字号 F_SECTION(17)，选中(Bold, C_TEXT) / 未选中(Medium, C_TEXT_SUB)
│   ├── Text 自建数量  字号 F_SUB, C_TEXT_WEAK
│   ├── Text「|」      字号 F_SECTION, C_DIVIDER, padding { left:2, right:2 }
│   ├── Text「收藏歌单」字号 F_SECTION，同样两态
│   ├── Text 收藏数量  字号 F_SUB, C_TEXT_WEAK
│   └── Blank
│
├── 段 0（自建歌单）：
│   ├── 动作区（外层带内边距的容器，**不要**给 width:100% 的行叠 margin）
│   │   Column, width: '100%', padding { left:14, right:14, bottom:10 }
│   │   └── Row, width: '100%', height: 64, borderRadius 16, backgroundColor C_FILL_SOFT, clip: true
│   │       ├── cardAction(0)  layoutWeight 1, height 100%, justifyContent Center
│   │       │   Column, space: 6：Icon `plus` 23 C_TEXT + Text「新建歌单」13 C_TEXT
│   │       └── cardAction(1)  同上：Icon `square_and_arrow_down` 23 C_TEXT + Text「歌单导入」13 C_TEXT
│   │       按压态：backgroundColor C_PRESSED
│   ├── 歌单为空：Text「还没有歌单，点上面的「新建歌单」建一个，或者用「歌单导入」粘贴一张分享链接」
│   │             字号 F_SUB, C_TEXT_WEAK, padding { left:14, right:14, top:4, bottom:18 }
│   └── 否则 playlistRow(item, index > 0)
│
└── 段 1（收藏歌单）：
    ├── 空：Column space 6, padding { top:16, bottom:28 }, alignItems Center
    │   ├── Icon `heart_fill` 28 C_TEXT_WEAK
    │   ├── Text「还没有收藏的歌单」字号 F_SUB, C_TEXT_SUB
    │   └── Text「在推荐页点开一张歌单，点里面的「收藏歌单」就会收进来」字号 11.5, C_TEXT_WEAK
    └── 否则 collectedRow(entry, index > 0)
```

**歌单行 `playlistRow`**：

```
Column, width: '100%'
├── Divider  仅 showDivider 时：strokeWidth 0.6, C_DIVIDER, margin { left: 72 }
└── Row, space: 12, width: '100%', height: 70, padding { left:14, right:14 }
    ├── Stack 46×46
    │   ├── 占位底  46×46, borderRadius 14, backgroundColor C_RED_TINT
    │   └── Icon `music_note_list` 22 C_RED
    ├── Column, space: 4, layoutWeight 1, alignItems Start
    │   ├── Text 歌单名  字号 F_ITEM, C_TEXT, maxLines 1
    │   └── Text `${count} 首`  字号 F_SUB, C_TEXT_WEAK
    └── Icon `chevron_right` 18, C_CHEVRON（装饰，读屏跳过）
长按菜单：添加到收藏 / 重命名 / 删除
```

**收藏歌单行 `collectedRow`**：与歌单行同构，把占位封面换成 `CoverArt(boxSize 46, radius 14)`，
第二行文案 = `${平台名} · ${收藏时的 meta}`；长按菜单只有 **取消收藏歌单**。

**设置卡 `linksCard()`**：

```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
└── 2 行
    Column
    ├── Divider  仅非首行：strokeWidth 0.6, C_DIVIDER, margin { left: 50 }
    └── Row, space: 14, width: '100%', height: 58, padding { left:14, right:14 }
        ├── Icon  iconSize 22, C_TEXT
        ├── Text  label 字号 F_ITEM, C_TEXT, layoutWeight 1
        └── Icon `chevron_right` 18, C_CHEVRON
        按压态：backgroundColor C_PRESSED
```
| 行 | 图标 | 文案 | action |
|---|---|---|---|
| 1 | `gearshape` | **设置** | `settings` |
| 2 | `questionmark_circle` | **帮助和反馈** | `about` |

**新建 / 重命名面板 `editSheet()`**（半模态 `detents: [MEDIUM]`, `dragBar: true`, `showClose: false`,
标题 `新建歌单` / `重命名`）：

```
Column, space: 12, width: '100%', padding { left:16, right:16, top:16, bottom:8 }
├── Text  标题「新建歌单」/「重命名歌单」，字号 F_ITEM, Medium, C_TEXT
├── TextInput  placeholder「歌单名称」, 字号 14, 高 46, backgroundColor C_FILL_SOFT
├── Row, space: 12
│   ├── Button「取消」layoutWeight 1, 高 40, backgroundColor C_FILL_SOFT, fontColor C_TEXT
│   └── Button「确定」layoutWeight 1, 高 40, backgroundColor C_RED
└── 底部占位  height = bottomInset + 8
```

**删除歌单确认框**：
- 标题 `删除歌单`
- 正文 `确定要删除「${name}」吗？删除会同步到其它设备。`
- 按钮：取消 / **删除**（红色），确认后撒删除粒子

---

### 2.3 搜索页 SearchView

**整体**：
```
Column, width/height 100%, backgroundColor C_BG
alignItems: HorizontalAlign.Start
padding { top: topInset }   ← 用普通内边距让位，搜索栏是钉在顶部的固定控件
├── 搜索栏 Row, space: 10, width: '100%'
│   constraintSize { maxWidth: 宽屏(columns>1) ? 720 : 不限 }
│   padding { left:16, right:16, top:8, bottom:10 }
│   ├── searchField()
│   └── Text「搜索」/「搜索中」15, Medium, 颜色 = searching ? C_TEXT_WEAK : C_RED
└── 三选一：
    ├── keyword.trim() === ''            → discoverPane()  历史 + 热搜
    ├── keyword.trim() !== searchedText  → suggestPane()   联想
    └── 否则                              → resultPane()    结果
```

**`searchField()`**：
```
Row, space: 8, layoutWeight 1, height: 44, padding { left:14, right:12 }
玻璃 = thinGlass(radius 23)
├── Icon `magnifyingglass` 18 C_TEXT_SUB（装饰）
├── TextInput  placeholder「歌名 / 歌手」字号 15, 透明底, padding 0, 高 28,
│             enterKeyType: Search
└── Icon `xmark` 16 C_TEXT_WEAK，仅 keyword.length > 0（清空关键词）
```

**`discoverPane()`（空输入）**：
```
Scroll, scrollBar off, layoutWeight 1, constraintSize { maxWidth: 宽屏 ? 720 : 不限 }
└── Column, space: 24, padding { left:16, right:16, top:6, bottom: bottomInset + 20 }
    ├── 搜索历史（history.length > 0）
    │   Column, space: 2, alignItems Start
    │   ├── Row, space: 8：SectionTitle「搜索历史」+ Blank + Icon `trash` 17 C_TEXT_WEAK
    │   └── Flex wrap：wordChip(word, removable = true)
    ├── 热门搜索（hots.length > 0）
    │   Column, space: 2：SectionTitle「热门搜索」+ Flex wrap：wordChip(word, false)
    └── 两者都空 → EmptyState
        icon = `magnifyingglass`, text = 「搜一首歌试试」, topPadding = 56
        hint = 「一次搜酷我、酷狗、咪咕、QQ、网易五个平台，结果合起来按相关度排；
                输入歌名时还会给出不同歌手 / 不同版本的联想词。」
```

**词胶囊 `wordChip`**：
```
Text  字号 13, C_TEXT, maxLines 1, constraintSize { maxWidth: 240 }
padding { left:13, right:13, top:7, bottom:7 }
backgroundColor C_FILL_SOFT, borderRadius 16, margin { right:9, top:9 }
长按（仅历史词）→ 删除该词
```

**`suggestPane()`（输入中未搜）**：
```
Column, layoutWeight 1, constraintSize { maxWidth: 宽屏 ? 720 : 不限 }
├── Row, padding { left:16, right:16, top:4, bottom:6 }：SectionTitle「联想搜索」
├── suggestions.length > 0：
│   List, layoutWeight 1, padding { bottom: bottomInset }
│   divider { strokeWidth: 0.6, color: C_DIVIDER, startMargin: 42, endMargin: 16 }
│   └── suggestRow(word)：
│       Row, space: 12, height: 46, padding { left:16, right:16 }
│       ├── Icon `magnifyingglass` 16 C_TEXT_WEAK
│       └── Text word  字号 15, C_TEXT, maxLines 1, layoutWeight 1
└── 否则：Text 字号 F_SUB, C_TEXT_SUB, padding { left:16, right:16, top:8 }
        文案 = suggesting ? 「正在联想…」 : `按回车或点「搜索」搜「${keyword}」`
```

联想防抖 **250ms**（`SUGGEST_DEBOUNCE_MS`），三平台并发、轮流取一条交错合并；
去重键忽略空格 / 连字符 / 大小写。联想词不进历史。

**`resultPane()`（已搜）**：
```
Column, layoutWeight 1
├── 结果栏 Row, space: 8, padding { left:16, right:16, top:4, bottom:6 }
│   ├── SectionTitle「搜索结果」
│   ├── Blank
│   └── filterPill()  仅 mergedInfos.length > 0
├── Text status  字号 F_SUB, C_TEXT_SUB, padding { left:16, right:16, bottom: 有结果 ? 6 : 0 }
├── searching → Column padding { top:60 }：ActivityIndicator 38, color C_RED
├── results.length === 0 → EmptyState(icon `magnifyingglass`, text/hint 见下, topPadding 56)
└── 否则 SongListPane（layoutWeight 1）
```

**`filterPill()`（平台筛选下拉）**：
```
Row, space: 3, height: 30, padding { left:12, right:8 }
玻璃 = thinGlass(radius 15)
├── Text  filterLabel()  字号 13, Medium, 颜色 = 全部 ? C_TEXT : C_RED
└── Icon  chevron_down 13, 颜色 = 全部 ? C_TEXT_SUB : C_RED
```
菜单项：
- `全部平台（${mergedInfos.length}）`
- 每个平台：失败时 `${平台名}（失败）`，否则 `${平台名}（${countOf(id)}）`

**状态行文案**：
- 搜索中：`正在聚合搜索「${text}」…`
- 成功：`共 ${mergedInfos.length} 首 —— ${summaryText()}`
  - `summaryText()` = 各平台 `平台名 数量` 用 ` · ` 连接，失败平台写 `${平台名} 失败`
- 全平台失败：`五个平台都没搜通，检查一下网络`
- 无结果：`没有搜到「${text}」`

**空态文案**：
- `filter !== 全部`：text = `${平台名} 没有结果`
- 否则 text = `没有搜到结果`
- hint：有失败平台时 = `本次 ${summaryText()}。失败的平台多半是网络或接口变了，可以只切到通了的平台看。`
- 否则 = `换个关键词试试，或者少写几个字。`

**列表尾部状态行**（`footerStatus()`）：
- `正在加载更多…` / `上拉加载更多` / `共 ${results.length} 首`

**分页与筛选规则**：
- 每平台每页 **30** 条（`PER_PLATFORM_LIMIT`）
- 五平台并发（`Promise.allSettled`），合并 → 去重 → 按相关度排序
- 翻页是「旧的往后接」，不重排整表
- 切筛选只换现成列表，不重新联网
- 筛选会记住（换关键词也还在），但筛的平台这次一条都没有时自动退回「全部」

---

### 2.4 全屏播放器 PlayerView

**整体（窄屏）**：
```
Stack (alignContent: Top), backgroundColor #0C0C0E
├── 背景层
│   ├── 渐变  linearGradient { angle: 205, ['#33333A' 0.0, '#0C0C0E' 1.0] }
│   ├── 封面模糊图（cover 非空时）objectFit Cover, blur 70, opacity 0.5
│   └── 压暗层  backgroundColor #40000000
├── 主体 Column, padding { bottom: bottomInset + 12 }
│   ├── 顶栏 Row
│   │   height: 56 + topInset, padding { left:18, right:18, top: topInset }
│   │   ├── Icon `chevron_down` 26, #FFFFFFE6  → 关闭
│   │   ├── Blank
│   │   ├── pageIndicator()  仅 !wide
│   │   ├── Blank
│   │   └── Stack 36×36：Circle 36 fill #FFFFFF26 + Icon `share` 20 #FFFFFFE6
│   ├── 窄屏：Swiper [coverPage(), lyricPage()]
│   │   index: pageIndex, loop: false, indicator: false, duration: 280, curve: Friction
│   │   onChange → pageIndex + syncKeepScreenOn
│   │   onAnimationEnd(index===1) → alignLyricScroll()
│   ├── 窄屏：controlBar()
│   └── 宽屏：Row → 左 wideLeftPane() layoutWeight 1 / 右 lyricPage() layoutWeight 1
└── 覆盖层（按需）：
    ├── moreOpen    → moreOverlay()
    ├── qualityOpen → qualityOverlay()
    ├── matchOpen   → matchOverlay()
    └── commentOpen → commentOverlay()
整页手势：PanGesture(vertical, distance 12)，offsetY > 70 且无面板打开时关闭播放器
```

**页码指示 `pageIndicator()`**：
```
Row, space: 5, animation { duration: 200, curve: EaseInOut }
├── Column  宽 = pageIndex===0 ? 20 : 6, 高 6, borderRadius 3
│           颜色 = pageIndex===0 ? #FFFFFF : #FFFFFF59
└── Column  宽 = pageIndex===1 ? 20 : 6, 同上
点击 → 切到另一页
```

**封面页 `coverPage()`**：
```
Column, space: 26, width/height 100%, clip: true
├── Blank
├── coverBlock()
├── Blank
└── onSizeChange → 记录封面区高度（推到下一个任务里改状态，避免卷进当帧动画）
```

**`coverBlock()`**：
```
Column, space: 26, width: '100%', padding { left:30, right:30 }
├── Stack  尺寸 = coverBoxSize()，borderRadius = coverRadius
│   ├── CoverArt  appIcon: true, pending: (status === 'loading')
│   │   shadow { radius: 40, color: #00000066, offsetX: 0, offsetY: 18 }
│   └── scale { x/y: coverSpringScale, centerX/Y: '50%' }
├── Row, space: 12, width: '100%', padding { left:4, right:4 }
│   ├── Column, space: 7, layoutWeight 1, alignItems Start
│   │   ├── Text 歌名  字号 22, Bold, 白, maxLines 1
│   │   └── Text 歌手  字号 13.5, #FFFFFFA6, maxLines 1
│   └── FavoriteHeart  iconSize 25, colorOn #FF5A5A, colorOff #FFFFFFCC
└── miniLyricBlock()  仅 !wide 且开关打开且当前行存在
```

**封面尺寸算法 `coverBoxSize()`**（伪代码）：
```js
function coverBoxSize() {
  let size = 252;                                   // COVER_SIZE_PHONE
  if (wide()) {                                     // windowWidth >= 600
    const byWidth = Math.round(windowWidth * 0.2);
    size = Math.max(252, Math.min(300, byWidth));    // [COVER_SIZE_MIN=252? 见注, COVER_SIZE_MAX=300]
    const paneFit = Math.round(windowWidth / 2) - 60; // COVER_SIDE_PADDING = 60
    if (paneFit > 0) size = Math.min(size, paneFit);
  }
  if (coverAreaHeight > 0) {
    size = Math.min(size, Math.round(coverAreaHeight) - 84); // COVER_BLOCK_CHROME = 84
  }
  return Math.max(120, size);                        // COVER_SIZE_MIN = 120
}
```
> 注：宽屏分支的下限用的是 `COVER_SIZE_PHONE = 252`，最终下限是 `COVER_SIZE_MIN = 120`。

**小歌词 `miniLyricBlock()`**：
```
Column, space: 3, width: '100%', padding { left:4, right:4 }
├── Text 当前句   字号 lyricFontSize, Medium, #FFFFFFF2, maxLines 2
│                 对齐 = lyricCentered ? Center : Start
└── Text 翻译     字号 max(11, lyricFontSize * 0.72), #FFFFFF99, maxLines 2（翻译非空时）
```

**歌词页 `lyricPage()`**：
```
Stack
├── 仅 !lyricBlur 时：纯深色底  Column 100%×100%, backgroundColor #0C0C0E
└── Column, justifyContent Center, padding { left:26, right:26 }
    ├── lyricStatus === 'loading'：Column space 10
    │   ActivityIndicator 28 #FFFFFF8C + Text「正在加载歌词…」13 #FFFFFF8C
    ├── lyricLines.length === 0：Column space 8
    │   Text「暂无歌词」16 #FFFFFF8C
    │   Text  当前歌为 null ? 「先点一首歌」: 「音源和内置平台都没取到这首的歌词」12.5 #FFFFFF59
    └── 否则 List(scroller = lyricScroller)
        ├── 顶部占位 ListItem 高 200
        ├── ForEach lyricLines → lyricLine(line, index)
        └── 底部占位 ListItem 高 200
        scrollBar off, edgeEffect Spring
```

**歌词行 `lyricLine(line, index)`**：
```
Column, space: 3, width: '100%', padding { top:11, bottom:11 }
├── Text 正文  字号 lyricFontSize
│   fontWeight = index === activeLine ? Bold : Normal
│   color = index === activeLine ? #FFFFFF
│         : (index < activeLine ? #FFFFFFB3 : #FFFFFF59)
│   textAlign = lyricCentered ? Center : Start
│   animation { duration: 240, curve: EaseInOut }
├── Text 翻译  字号 max(11, lyricFontSize * 0.72)（翻译非空时）
│   color = active ? #FFFFFFB3 : #FFFFFF40
└── 点击 → seek(line.time)（line.time >= 0 时）
```
当前行由 `scrollToIndex(index + 1, true, CENTER)` 滚到中间（+1 是因为首行是占位）。
歌词滚动跟随只在**行号变化**时触发；页面可见时另做一次无条件对齐（延迟 80ms 补一次）。

**控制区 `controlBar()`**：
```
Column, space: 0, width: '100%', padding { left:24, right:24 }
│
├── 进度条 Stack（宽 100%）
│   ├── bufferTrack()  自绘三段
│   │   Stack(alignContent: Start), height 3, padding { left:4.5, right:4.5 }
│   │   ├── 底段    width 100%,  height 3, borderRadius 1.5, backgroundColor #FFFFFF33
│   │   ├── 缓冲段  width `${bufferPercent}%`, 同上, backgroundColor #FFFFFF80, animation 260ms Linear
│   │   └── 已播段  width `${progressPercent}%`, 同上, backgroundColor #FFFFFF, animation 260ms Linear
│   └── Slider
│       value: progress, min 0, max: duration > 0 ? duration : 1, style OutSet
│       trackThickness 3, blockSize 9×9, blockColor #FFFFFF
│       selectedColor transparent, trackColor transparent
│       enabled = status === 'playing' || status === 'paused'
│       onChange(mode !== Begin) → seek(value)
│
├── Row, width: '100%', padding { top:6, bottom:4 }
│   ├── Text 当前时间  字号 11.5, #FFFFFFA6（格式 mm:ss）
│   ├── Blank
│   ├── qualityButton()
│   ├── Blank
│   └── Text 总时长    字号 11.5, #FFFFFFA6
│
├── 播放控制 Row, width: '100%'   ← 5 个等分格，每格 layoutWeight 1, height 84
│   ├── 播放模式  iconSize 23, #FFFFFFCC（图标见下表），点击切换 + Toast 报模式名
│   ├── 上一首    backward_end_fill, 30, #FFFFFF
│   ├── playButton()
│   ├── 下一首    forward_end_fill, 30, #FFFFFF
│   └── 播放列表  music_note_list, 24, #FFFFFFCC
│
└── 底部功能 Row, width: '100%', padding { top:8, bottom:6 }  ← 4 等分，每格 layoutWeight 1, height 44
    ├── AVCastPicker 44×44（图标 statusbar_cast 23, #FFFFFF8C）
    ├── 评论   message 22, #FFFFFF8C
    ├── 下载   download 22, #FFFFFF8C
    └── 更多   dot_grid_1x2_circle 22, #FFFFFF8C
```

**播放模式图标映射**：

| `playMode` | 图标 | 中文名 |
|---|---|---|
| `list`（默认） | `repeat` | 列表循环 |
| `order` | `order_play` | 顺序播放 |
| `single` | `repeat_1` | 单曲循环 |
| `shuffle` | `shuffle` | 随机播放 |

**播放钮 `playButton()`**：
```
Stack(center), width/height 100%
├── HdsEdgeFlowLight  radius 36, colorA #FFFFFF66, colorB #FF6B6B33, lightOpacity 0.5
├── 圆底 Column 72×72, borderRadius 36, backgroundColor #F4F4F6
│        shadow { radius: 26, color: #FFFFFF66, offsetX: 0, offsetY: 0 }
├── loading/buffering → ActivityIndicator 30, color #8A8A90
└── 否则 Icon  playing ? pause_fill : play_fill, 26, #17171A
        播放时 offset.x = 0，暂停时 offset.x = 2（视觉居中补偿）
```

**音质钮 `qualityButton()`**：
```
Row, space: 3, padding { left:12, right:12, top:5, bottom:5 }
borderRadius 10, backgroundColor #FFFFFF26
├── Text 音质名  字号 11.5, #FFFFFFCC
└── Icon chevron_down 12, #FFFFFFCC   ← 仅可切档 > 1 时
```

**音质面板 `qualityPanel()`**（与「更多」同一套自绘底部面板）：
```
Column, width: '100%', padding { bottom: bottomInset + 4 }
borderRadius { topLeft: 20, topRight: 20 }, backgroundColor #232326
transition = translate({ y: 320 }) 240ms Curve.Friction
├── Text「播放音质」13, #FFFFFF8C, padding { top:16, bottom:4 }, 居中
├── Text「当前：${音质名}」12, #FFFFFF66, padding { bottom:10 }, 居中
├── 可切档 > 1：
│   ├── 每档 qualityItem(quality)：Row space 6, 高 54, justifyContent Center
│   │   Text 16, 颜色 = 当前档 ? C_RED : #FFFFFFF2
│   │   Icon `checkmark_circle_fill` 15 C_RED（当前档）
│   └── 说明 11.5, #FFFFFF59, lineHeight 16, padding { left:24, right:24, top:4, bottom:10 }
│       文案：「换档会用新音质把这个位置重新解析一次（中间会重新缓冲一小会儿）；
│              选中的这一档同时成为以后播放的音质（设置 - 播放设置）。」
├── 否则：说明 13, #FFFFFF8C, lineHeight 19, padding { left:24, right:24, top:2, bottom:16 }
└── Divider 0.5 #FFFFFF26, margin { top:8 } + Text「取消」16 #FFFFFF8C 高 54 居中
遮罩：backgroundColor #8A000000，点面板外收起
```

**「更多」面板 `morePanel()`**：结构与音质面板完全同款，内容为：

| 项 | 触发 |
|---|---|
| （标题）当前歌名 13 #FFFFFF8C，padding { top:16, bottom:10 } | — |
| **播放** | 从头重放当前这首 |
| **添加到播放列表** | 追加到队尾 |
| **添加到下一个播放** | 插到当前歌之后 |
| **查看评论** | 打开评论层 |
| **匹配歌词**（仅本地 / 云端歌） | 打开匹配面板 |
| **取消** | 收起 |

**「匹配歌词」面板 `matchOverlay()`**：遮罩 `#8A000000`，面板高 `62%`，
`borderRadius { topLeft: 20, topRight: 20 }`，`backgroundColor C_BG`，`clip: true`。

**评论层 `commentOverlay()`**：铺满播放器（100% × 100%），内容见 2.9。

**关闭手势**：竖直 Pan，`offsetY > 70` 且 `!moreOpen && !qualityOpen && !commentOpen` 时关闭。

---

### 2.5 歌单详情 PlaylistDetailView

**整体**：
```
Stack (alignContent: Bottom), backgroundColor C_BG
├── 鸿蒙7：Tabs(barPosition End) → TabContent → pageBody()  .tabBar(miniBarTabBar())
│          .vertical(false) .barMode(Fixed) .scrollable(false) .barOverlap(true)
│          .barHeight(56) .barBackgroundColor(transparent) .barFloatingStyle(floatBarStyle())
├── 鸿蒙6：Column → pageBody()  +  fallbackMiniBar()
└── bindSheet(pickerOpen) → AddToPlaylistSheet（detents [MEDIUM, LARGE], 标题「添加到歌单」）
```

**`pageBody()`**：
```
Column, width/height 100%
└── List(scroller), lanes = contentColumnsFor(windowWidth)
    contentStartOffset = topInset + 6（多选时也是同一段偏移，列表不会整体下移）
    scrollBar off, layoutWeight 1
    └── ListItemGroup(header = listHeader(), footer = listFooter())
        └── LazyForEach songs → ListItem
            ├── songRow(item, index)
            └── Divider 0.6 C_DIVIDER, margin { left: 78 }（非最后一行）
```

**组头 `listHeader()` = `header()` + `playAllRow()`**：

`header()`：
```
Row, space: 14, width: '100%', padding { left:16, right:16, top:12, bottom:16 }
├── CoverArt  url ''（无封面图，走占位）, boxSize 86, radius 18
├── Column, space: 8, layoutWeight 1, alignItems Start
│   ├── Text 歌单名  字号 20, Bold, C_TEXT, maxLines 2
│   └── Text `${songs.length} 首`  字号 F_SUB, C_TEXT_SUB
```

`playAllRow()`：
```
Row, space: 12, width: '100%', height: 70, padding { left:16, right:16 }
├── Icon `play_circle_fill` 46, C_RED
├── Text「播放全部」字号 F_ITEM, Medium, C_TEXT
├── Text `${songs.length}`  字号 F_SUB, C_TEXT_WEAK, layoutWeight 1
└── 下载钮 Row, padding { left:9, right:9, top:6, bottom:6 }
        borderRadius 16, backgroundColor C_RED_TINT, Icon `download` 19 C_RED
整行点击 → playFrom(0)
```

**歌曲行 `songRow`**：
```
Row, space: 12, width: '100%', height: 72, padding { left:16, right:16 }
├── CoverArt  boxSize 50, radius 12
├── Column, space: 4, layoutWeight 1, alignItems Start
│   ├── Text 歌名  字号 F_ITEM, 颜色 = 当前播 ? C_RED : C_TEXT, maxLines 1
│   └── Text 歌手  字号 F_SUB, C_TEXT_WEAK, maxLines 1（非空时）
└── 行尾：
    ├── 多选态：Icon  已选 ? checkmark_circle_fill : circle, 22,
    │                  颜色 = 已选 ? C_RED : C_TEXT_WEAK（装饰）
    └── 普通态：
        ├── Icon `speaker_wave_3` 19 C_RED（仅当前播）
        ├── FavoriteHeart（默认 iconSize 22）
        └── Icon `dot_grid_1x2_circle` 22 C_TEXT_WEAK → bindMenu(rowMenu)
行点击 → 多选态切换勾选；否则 playFrom(index)
长按 → 进多选并勾上这一条
```

**行菜单 `rowMenu`**：播放 / 下载（非本地非云端时）/ 添加到歌单 / 添加到播放列表 /
添加到下一个播放 / `isBuiltin() ? '取消收藏' : '从歌单中删除'`
（字号 16，`menuItemDivider` 0.5、`startMargin/endMargin` 14）

**组尾 `listFooter()`**：
```
Column, width: '100%'
├── songs.length === 0 → EmptyState
│   text = 「这个歌单还没有歌曲」
│   hint = 「可以在洛雪桌面端 / 移动端把歌加进来，同步后就会出现」
│   topPadding = 56
└── 底部让位  height = bottomInset + 56 + 26
```

**页内迷你栏 `floatBarStyle()`**：

| 字段 | 值 |
|---|---|
| `barSideMargin` | `barSideMarginFor(windowWidth)`（12 / 16 / 24） |
| `barBottomMargin` | `bottomInset + 10` |
| `maskColor` | `#F1F1F266`（**必须显式给**，默认是 `#CCF1F3F5`，会重得多） |
| `maskHeight` | `104` |
| `systemMaterial` | `immersiveMaterialForBar(materialLevel)` |
| `barWidth` | 三档同值：宽屏 = `K_BAR_MINI_WIDTH`（壳层算好的迷你栏宽度）；窄屏 = `windowWidth - side*2`；`windowWidth === 0` 时**不给** |

栏内**只放内容不给底**：平时 `MiniBarView({ forceExpanded: true })`，
多选时换成 `SelectionActions`。

**多选**（6 个可多选页面之一）：

| 项 | 值 |
|---|---|
| 批量操作（底栏从左到右） | 收藏 / 添加到歌单 / 添加到播放列表 / 下一个播放 / 下载 / **从歌单中删除** |
| 内置收藏歌单 | 去掉「收藏」，主操作变 **取消收藏** |
| 批量删除确认框 | 标题 = `取消收藏` / `从歌单中删除`；正文 = `把勾选的 N 首从收藏里去掉？下载与本地文件都不受影响。` / `从「${title}」里删掉这 N 首？收藏与下载都不受影响。`；按钮 = 取消 / **移出**（红）或 **删除**（红） |

**下载全部确认框**：
- 标题 `下载全部`
- 正文 `确定要把「${title}」里的 ${count} 首歌全部加入下载吗？可以在「我的 - 下载管理」里看进度。`
- 按钮：取消 / **下载**（红）

---

### 2.6 在线榜单 / 在线歌单详情 OnlineListView

结构与歌单详情同构（同一个组件，`kind` 区分取数接口），差异如下：

**头部 `header()`**（居中版式）：
```
Column, space: 12, width: '100%', alignItems Center
padding { left:20, right:20, top:18, bottom:14 }
├── CoverArt  boxSize 132, radius 24
├── Text 标题  字号 20, Bold, C_TEXT, maxLines 2, 居中
├── Row, space: 8, justifyContent Center
│   ├── Text 平台名  字号 12, C_RED, padding { left:8, right:8, top:3, bottom:3 },
│   │                borderRadius 9, backgroundColor C_RED_TINT
│   ├── Text 作者  字号 F_SUB, C_TEXT_SUB, maxLines 1（非空时）
│   └── Text `· ${播放量}`  字号 F_SUB, C_TEXT_WEAK（非空时）
└── Text 简介  字号 12.5, C_TEXT_WEAK, maxLines 3, padding { left:4, right:4 }（非空时）
```

**动作行 `actionRow()`**：
```
Row, space: 12, width: '100%', padding { left:16, right:16, bottom:8 }
├── 播放全部钮  layoutWeight 1, height 46, borderRadius 23, backgroundColor C_RED
│   Row, space: 6, justifyContent Center
│   ├── Icon `play_circle_fill` 22, 白
│   ├── Text「播放全部」15, Medium, 白
│   └── Text `${songs.length}` 12.5, #FFFFFFD9
├── 收藏歌单钮（仅 kind === 'playlist'）
│   Row, space: 6, height 46, padding { left:16, right:16 }, borderRadius 23,
│       backgroundColor C_RED_TINT
│   ├── Icon  已收藏 ? heart_fill : heart, 20, C_RED
│   └── Text  已收藏 ? 「已收藏」: 「收藏歌单」15, C_RED
└── 下载全部钮  Row 46×46, borderRadius 23, backgroundColor C_RED_TINT
    Icon `download` 20, C_RED
```

**歌曲行**：与歌单详情一致（封面 50, radius 12, 行高 72），但行菜单**没有**
「从歌单中删除」（在线列表的歌不在自己库里）。

**多选操作**：添加到歌单 / 添加到播放列表 / 下一个播放 / **收藏**（红字主操作）。
没有「从歌单中删除」这类。

**组尾 `listFooter()`**：
- `songs.length === 0` → 状态块（`padding { left:32, right:32, top:50, bottom:20 }`）
  - 加载中：`正在加载…` 15 C_TEXT_SUB
  - 出错：错误 14 C_TEXT_SUB + 「点击重试」14 Medium C_RED（`padding {18,18,8,8}`, `borderRadius 18`, 底 `C_RED_TINT`）
  - 空：`列表里还没有歌曲` 15 C_TEXT_SUB
- 有数据 + 出错：错误 13 C_TEXT_WEAK + 「点击重试」13.5 C_RED
- `hasMore()`：`正在加载更多…` / `上拉加载更多` 13 C_TEXT_WEAK 居中
- 否则：`共 ${songs.length} 首` 12.5 C_TEXT_WEAK 居中
- 底部让位 `height = bottomInset + 56 + 26`

**分页上限**：一次最多往队列放 **500** 首（`MAX_SONGS`）。
`hasMore() = songs.length > 0 && songs.length < total && songs.length < 500`。

**下载全部确认框**：正文 = `确定要把这一页的 ${count} 首歌全部加入下载吗？可以在「我的 - 下载管理」里看进度。`

**收藏歌单规则**：
- 已导入到自建歌单里的不再让收藏 → 提示 `「${title}」已经导入到我的歌单里了，不用再收藏`
- 收藏成功提示 `已收藏「${title()}」，在「我的 - 收藏歌单」里看`
- 榜单（`kind === 'board'`）没有这颗钮

---

### 2.7 播放列表 PlayQueueSheet

外层半模态参数见 1.6。内容 `PlayQueueContent`：

```
Column, width/height 100%
├── items.length === 0：
│   Column, layoutWeight 1, justifyContent Center
│   └── EmptyState  icon `music_note_list`, text「播放列表是空的」
│                   hint「在歌单或搜索结果里点一首歌，就会进到这里」
├── 否则 List, padding { left:16, right:16 }, layoutWeight 1, scrollBar off
│   └── ListItemGroup(CARD)
│       divider { strokeWidth: 0.6, color: C_DIVIDER, startMargin: 72 }
│       └── LazyForEach → ListItem
│           ├── songRow(item, index)
│           └── .swipeAction({ end: { builder: deleteAction(index), onAction: deleteAt(index) } })
└── 底部占位  height = bottomInset + 8
```

**歌曲行 `songRow`**：
```
Row, space: 12, width: '100%', height: 66, padding { left:16, right:16 }
├── CoverArt  boxSize 44, radius 12
├── Column, space: 3, layoutWeight 1, alignItems Start
│   ├── Text 歌名  字号 16, 颜色 = 当前播 ? C_RED : C_TEXT, maxLines 1
│   └── Text 歌手  字号 F_SUB, C_TEXT_WEAK, maxLines 1
└── 行尾：
    ├── Icon `speaker_wave_3` 19 C_RED（仅当前播）
    └── Icon `trash` 19 C_TEXT_SUB → 删除这一条
点击 → playAt(index)
长按 → 行菜单
```

**左滑删除块 `deleteAction`**：
```
Row, width: 76, height: '100%', justifyContent Center, backgroundColor C_RED
└── Icon `trash` 21, 白
```

**行菜单 `rowMenu`**：`收藏` / `取消收藏`（按当前状态）→ 下载（非本地非云端）→
**不喜欢的歌曲** → **移出播放列表**

删除时撒删除粒子。

---

### 2.8 歌曲评论 CommentSheet

**配色（这一层是深色，与播放器一致，与深浅模式无关）**：

| 常量 | 值 | 用途 |
|---|---|---|
| `C_PANEL_BG` | `#0C0C0E` | 面板底 |
| `C_PANEL_TEXT` | `#FFFFFFF2` | 正文 |
| `C_PANEL_SUB` | `#FFFFFF8C` | 次要文字 |
| `C_PANEL_WEAK` | `#FFFFFF5E` | 更弱文字 |
| `C_PANEL_LINE` | `#FFFFFF1F` | 虚线分隔 |

**整体**：
```
Column, width/height 100%, backgroundColor #0C0C0E
├── header()   高 50, padding { left:6, right:6 }
│   ├── Icon `chevron_left` 22 C_PANEL_TEXT, padding { left:6, right:10, top:6, bottom:6 } → 关闭
│   ├── Text  歌名非空 ? `「${songName}」的评论` : 「评论」
│   │         字号 16, C_PANEL_TEXT, maxLines 1, layoutWeight 1, 居中
│   └── Icon `arrow_2_circlepath` 20 C_PANEL_SUB, padding { left:10, right:6, top:6, bottom:6 } → 刷新
├── tabs()  仅 target() !== null
│   Row, width: '100%', padding { left:6, right:12 }
│   ├── tabItem(0, '热门' + 总数)  高 38, padding { left:12, right:12 }, justifyContent Center
│   │   Column, space: 4
│   │   ├── Text  字号 15，选中 Bold #FFFFFFFF / 未选中 Normal C_PANEL_SUB
│   │   └── Column  宽 = 选中 ? 18 : 0, 高 2, borderRadius 1, backgroundColor #FFFFFFFF
│   └── tabItem(1, '最新' + 总数)
│   └── Blank
├── body()
└── 底部占位  height = bottomInset + 8
```

页签文案：`总数 > 0 ? '${label} (${total})' : label`。

**`body()` 分支**：

| 条件 | 内容 |
|---|---|
| `resolving` | Text `needsMatch ? '正在匹配这首歌的平台版本…' : '正在准备评论…'` 13.5 C_PANEL_SUB，`padding { top:40 }` 居中 |
| `target() === null` | EmptyState(icon `message`, text/hint 见下) |
| 首次加载中 | Text「正在加载评论…」13.5 C_PANEL_SUB，`padding { top:40 }` 居中 |
| 无评论无错 | EmptyState(icon `message`, text「还没有人评论」, hint「来听这首歌的人还不多，过些时候再看看。」) |
| 有评论 | List, `padding { left:16, right:16 }`，每条 CommentRow，末尾 ListItem 放 footer()；`onReachEnd` 加载下一页 |

**看不到评论的文案**：
- `targetJson.length > 0`：text = 「这个平台看不到评论」，hint = 「评论来自音乐平台，目前支持酷我、酷狗、QQ 音乐、咪咕与网易。」
- `needsMatch`：text = 「这首歌还没匹配到平台上的版本」，hint = 「评论只存在于音乐平台上，本地音乐与云端音乐要先匹配到平台的那一首：播放页「更多 - 匹配歌词」里搜一次并选中正确的版本，之后评论与歌词都会用它。」
- 否则：text = 「这首歌看不到评论」，hint 同上第一条

**`footer()`**：
- 有错：错误 13 C_PANEL_WEAK maxLines 2 居中 + 「点击重试」13.5 #FFFFFFFF，`padding { top:14, bottom:14 }`
- `hasMore()`：`正在加载更多…` / `上拉加载更多` 13 C_PANEL_WEAK 居中
- 否则：`共 ${comments.length} 条` 12.5 C_PANEL_WEAK 居中

**一条评论 `CommentRow`**：
```
Row, space: 10, width: '100%', alignItems Top
padding { top:14, bottom:14 }
底边框 dashed 0.6 C_PANEL_LINE
├── CoverArt 头像  boxSize = nested ? 28 : 36, radius = nested ? 14 : 18
└── Column, layoutWeight 1, alignItems Start
    ├── meta Row, space: 8, width: '100%'
    │   ├── Text 昵称  字号 nested ? 13.5 : 14.5, C_PANEL_SUB, maxLines 1, layoutWeight 1
    │   └── Row, space: 3（likedCount >= 0 时，装饰）
    │       Icon `hand_thumbsup` 12 C_PANEL_WEAK + Text 点赞数 12 C_PANEL_WEAK
    ├── subLine Row, space: 10, padding { top:3 }（时间或 IP 非空时）
    │   ├── Text 时间  字号 11.5, C_PANEL_WEAK
    │   └── Text `IP属地：${location}` 字号 11.5, C_PANEL_WEAK, maxLines 1
    ├── Text 正文  字号 nested ? 13.5 : 14.5, C_PANEL_TEXT
    │              lineHeight = nested ? 20 : 21, padding { top:5 }
    ├── Text「展开」/「收起」12.5 C_PANEL_SUB, padding { top:4 }（正文 > 140 字时）
    ├── images()  Flex wrap（有图时）
    │   每张 Stack：底 #FFFFFF1F + Image objectFit Contain
    │   尺寸 = nested ? 88×88 : 110×110, borderRadius 8, clip, margin { top:8, right:8 }
    └── 楼中楼（reply.length > 0）
        Column, margin { top:10 }, padding { top:10 }
        上边框 dashed 0.6 C_PANEL_LINE
        └── 每条 CommentRow({ comment: reply, nested: true })
```

`TEXT_LIMIT = 140`；每页 **15** 条（`COMMENT_PAGE_SIZE`）。

---

### 2.9 导入歌单 ImportPlaylistSheet

```
Column, space: 12, width/height 100%
padding { left:16, right:16, top:12 }
backgroundColor C_CARD
├── 粘贴区（presetId 为空时）linkInput()
│   Column, space: 10, width: '100%'
│   ├── Text「把歌单分享内容整段粘贴进来（长按输入框可粘贴），会自动识别平台与歌单」
│   │        字号 F_SUB, C_TEXT_SUB
│   ├── TextArea  placeholder「例如：分享歌单《周杰伦》https://music.163.com/#/playlist?id=123456」
│   │             字号 13.5, 高 88, borderRadius 12, backgroundColor C_FILL_SOFT
│   └── Row, space: 12
│       ├── Button「解析歌单」/「解析中…」layoutWeight 1, 高 42, 字号 15,
│       │        backgroundColor C_RED, enabled = !busy && 有内容
│       └── Button「清空」高 42, 字号 15, backgroundColor C_FILL_SOFT_STRONG, fontColor C_TEXT
├── 否则（从在线详情页进来）：Text「把这张${平台名}在线歌单导入到「我的歌单」」F_SUB C_TEXT_SUB
├── status 非空：Text 字号 F_SUB, C_TEXT_SUB
├── error 非空：Text 字号 F_SUB, C_RED
├── Scroll, layoutWeight 1, scrollBar off
│   └── Column, space: 12, width: '100%'
│       ├── previewCard()（link 非空且 info.name 非空时）
│       └── busy 时 Row, space: 10：ActivityIndicator 20 C_RED + Text「正在处理，大歌单需要一点时间…」F_SUB C_TEXT_WEAK
├── 底部主按钮 Row, space: 10, width: '100%', height: 46, justifyContent Center,
│   borderRadius 23, backgroundColor C_RED, opacity = canImport() ? 1 : 0.4
│   ├── Icon `download` 19, 白
│   └── Text  existing !== null ? `更新「${existing.name}」` : 「导入到我的歌单」15, Medium, 白
└── 底部占位  height = bottomInset + 8
```

**`previewCard()`**：
```
Column, space: 10, width: '100%', padding 14, borderRadius 16, backgroundColor C_CARD
├── Row, space: 12, width: '100%'
│   ├── CoverArt  boxSize 62, radius 14
│   └── Column, space: 5, layoutWeight 1, alignItems Start
│       ├── Text 歌单名  字号 F_ITEM, Medium, C_TEXT, maxLines 2
│       ├── Row, space: 8, width: '100%'
│       │   ├── Text 平台名  字号 11.5, C_RED, padding { left:7, right:7, top:2, bottom:2 },
│       │                   borderRadius 8, backgroundColor C_RED_TINT
│       │   └── Text 作者  字号 F_SUB, C_TEXT_SUB, layoutWeight 1, maxLines 1
│       └── Text `${total} 首`  字号 F_SUB, C_TEXT_WEAK
├── 预览列表（preview.length > 0）Column, space: 4, padding { top:2 }
│   每行 Text  `${index + 1}. ${歌名}${歌手 ? ' - ' + 歌手 : ''}`
│            字号 12.5, C_TEXT_SUB, maxLines 1
│   total > preview.length 时再一行：`… 其余 ${total - preview.length} 首导入时一并拉取`
│            字号 12, C_TEXT_WEAK
├── TextInput  placeholder「导入成的歌单名」字号 14, 高 44, backgroundColor C_FILL_SOFT
└── existing !== null 时：
    Text「「${existing.name}」已经导入过这个歌单，导入会用它替换线上最新数据（不会新建列表）」
         字号 F_SUB, C_TEXT_SUB
```

`PREVIEW_SONGS = 6`。导入过程状态文案：
- `正在解析链接…`
- `已识别：${平台名} · 歌单 id ${id}`
- `正在获取歌单歌曲…` / `正在获取歌曲 ${loaded}/${total}…`
- `支持网易云 / QQ / 酷狗 / 酷我 / 咪咕的歌单分享链接`（初始）
- 错误：`请先粘贴歌单分享内容` / `这个歌单里没有取到歌曲（可能是私密歌单、已失效，或该平台接口暂时不可用）` / `获取歌单失败：${msg}` / `导入失败：${msg}` / `这些歌曲没法导入（缺少歌曲信息）`

导入成功回调文案：`已用线上数据更新「${name}」共 ${count} 首` / `已导入「${name}」共 ${count} 首`

---

### 2.10 设置页 SettingsView 及其子页

#### 2.10.1 设置主页 SettingsView

```
Stack (TopStart), backgroundColor C_BG
├── Column
│   └── Scroll, layoutWeight 1, align Top, scrollBar off
│       └── Flex   direction = 宽屏 ? Row : Column
│                 wrap = 宽屏 ? Wrap : NoWrap
│                 alignItems: Start
│                 space { main: 14, cross: 14 }
│       ├── 顶部占位  height = topInset + 6
│       ├── Search  placeholder「搜索设置」字号 15, 高 48, width 100%, backgroundColor C_CARD
│       ├── 登录卡（见下）
│       ├── 音源组  Column space 14, width = cardWidthOf
│       │   ├── cardGroup([{ I_DISC, '音源设置', 'source' }])
│       │   └── hint「当前音源：${sourceSummary}」
│       ├── 同步组  cardGroup([{ I_REFRESH, '同步设置', 'sync' }])
│       │   + hint「与洛雪同步服务连接后，试听列表 / 收藏 / 歌单 / 不喜欢的歌曲可与其它设备互通」
│       ├── 播放组  cardGroup([
│       │       { I_VOLUME,   '播放设置', 'play' },
│       │       { I_CACHE,    '缓存',     'cache' },
│       │       { I_DOWNLOAD, '下载设置', 'download' },
│       │       { I_PERSON,   'WebDAV 云端音乐', 'webdav' }])
│       ├── 外观组  cardGroup([{ I_BRUSH, '外观', 'appearance' }])
│       │   + hint「玻璃材质档位、封面取色、深浅模式都在这一页；标题栏与底部页签栏用的是同一档材质」
│       ├── 听书组  cardGroup([{ I_BOOK, '听书', 'listen' }])
│       │   + hint「可以在这里把「听书」页签从底部导航栏里隐藏掉；页签隐藏之后，这一页就是把它找回来的入口」
│       └── 关于组  cardGroup([{ I_INFO, '关于', 'about' }])
│       .padding { left:16, right:16, bottom: bottomInset + 16 }
└── TopFade  fadeHeight = topInset + 10
```

**登录卡**：
```
Row, space: 14, width: '100%', height: 88, padding { left:16, right:14 }
borderRadius R_CARD, backgroundColor C_CARD
├── Stack 52×52
│   ├── 圆底 52×52, borderRadius 26, backgroundColor C_FILL_SOFT_STRONG
│   └── Icon `person` 34, 白
├── Column, space: 5, layoutWeight 1, alignItems Start
│   ├── Text「登录音乐」18, Bold, C_TEXT
│   └── Text「网易云 / QQ / 酷狗账号，扫码或 Cookie 登录」F_SUB, C_TEXT_WEAK, maxLines 1
└── Icon `chevron_right` 18, C_CHEVRON
```

**`SettingRow`（自绘行，**不用** HdsListItemCard）**：
```
Column, width: '100%'
├── Row, space: 13, width: '100%', height: 63, padding { left:14, right:14 }
│   ├── Stack 34×34
│   │   ├── 圆底 34×34, borderRadius 17, backgroundColor C_ICON_CIRCLE
│   │   └── Icon  iconSize 20, color C_TEXT
│   ├── Text 标题  字号 F_ITEM, C_TEXT, layoutWeight 1
│   └── Icon `chevron_right` 18, C_CHEVRON
│   按压态：backgroundColor C_PRESSED
└── Divider 0.6 C_DIVIDER, margin { left: 61 }（非最后一行）
```

**`cardGroup`**：`Column, width: '100%', borderRadius R_CARD(16), backgroundColor C_CARD, clip: true`，
行之间显示分隔线。

搜索词按 `title.includes(keyword)` 过滤各组。

#### 2.10.2 通用设置控件（SettingWidgets）

| 组件 | 规格 |
|---|---|
| `ROW_H` | `46`（开关 / 滑块 / 只读行的统一行高） |
| `SLIDER_W` | `116` |
| `RowLabel` | Text 字号 15, C_TEXT, maxLines 1, layoutWeight 1 |
| `HintText` | Text 字号 11.5, C_TEXT_WEAK, width 100%, padding { left:4, right:4 } |
| `SettingLabel` | Row, space 10, 高 46：左标题 15 C_TEXT（`flexShrink: 0`）+ 右值 F_SUB C_TEXT_WEAK（右对齐、省略号） |
| `ToggleSetting` | Row, space 10, 高 46：RowLabel + Switch（`trackColor.true = C_RED`） |
| `OptionSetting` | Column, space 8：标题 15 C_TEXT + `SegPills` + 可选 HintText |
| `SliderSetting` | Row, space 6, 高 46：标题 15 C_TEXT + Blank + 当前值 F_SUB C_TEXT_WEAK + Slider |

**`SegPills`（分段胶囊）**：
```
Row, width: '100%', padding: 3, borderRadius 18, backgroundColor C_SEG_BG
└── 每项 Text
    字号 13，选中 Bold / 未选中 Medium
    颜色 = 选中 ? C_ON_ACCENT(#FFFFFF) : C_SEG_UNSELECTED
    textAlign Center, maxLines 1, layoutWeight 1
    height: 30, borderRadius: 15
    backgroundColor = 选中 ? C_RED : transparent
    animation { duration: 200, curve: EaseInOut }
```

**`SliderSetting` 的 Slider**：
`trackThickness 3`, `blockSize 16×16`, `blockColor #FFFFFF`,
`minimumTrackTintColor C_RED`, `maximumTrackTintColor C_SLIDER_TRACK`, 宽 116, step 1。
拖动实时回调，松手 / 点击轨道才落盘。

**设置类页面的统一外壳**：
```
Column, width/height 100%, backgroundColor C_BG
└── Scroll, layoutWeight 1, align Top, scrollBar off
    └── Flex  direction = 宽屏 ? Row : Column
              wrap = 宽屏 ? Wrap : NoWrap
              alignItems: Start
              space { main: 14, cross: 14 }
              padding { left:16, right:16, top:8, bottom: bottomInset + 16 }
    ├── 顶部占位  height = topInset + 6
    └── 每组 = Column, space: 14, width = cardWidthOf(windowWidth)
        卡本体：padding { left:16, right:16, top:8, bottom:8 }, borderRadius R_CARD, backgroundColor C_CARD
```

> **重要**：「卡 + 它下面那行说明」必须包在同一个 `Column` 里当**一个单元** ——
> 说明文字本身铺满宽度，不包起来会把换行打断，两张卡就并不到一排去。

#### 2.10.3 外观 AppearanceSettingsView

| 项 | 控件 | 选项 | 默认 |
|---|---|---|---|
| 深浅模式 | SegPills | `跟随系统` / `浅色` / `深色` | `0`（跟随系统） |
| 玻璃材质档位 | SegPills | `跟随系统` / `弱` / `均衡` / `强` | `0`（跟随系统） |
| 播放页封面圆角 | Slider | `0 – 40` | `12` |
| 能力诊断 | HintText | 只读 | — |

**说明文案（随状态变化）**：
- 深浅模式（跟随系统时）：`跟随系统：手机切到深色模式，界面跟着变。界面上所有颜色都是 base / dark 两份同名资源（resources 下 base / dark 两份同名 color.json），不跟随的话在深色系统里会出现白卡片配浅字这类看不清的问题。`
- 深浅模式（选了浅 / 深）：`这一档会覆盖系统设置：无论手机是什么模式，应用都用这一档的深浅。`
- 玻璃档位（系统 < 鸿蒙7）：`当前系统低于鸿蒙7（API 26），沉浸式系统材质这条接口在本机根本不存在，所以这一档不生效：悬浮控件的玻璃走自绘（模糊 + 半透明白 + 亮边），边沿那圈光改由 HDS 的轮廓点光出（普通光效）。升级到鸿蒙7 后会自动切回系统材质。`
- 玻璃档位（无材质能力位）：`当前设备没有沉浸光感材质，这一档不影响自绘的毛玻璃层（那几层走的是模糊 + 半透明白兜底）。`
- 玻璃档位（可用）：`档位越高，系统材质的折射与提亮越强。「跟随系统」交给系统按温度/电量策略决定，机型之间差别较大（有的会把玻璃压得很淡，看上去像没生效）——这时手工选一档「均衡」或「强」。`
- 圆角：`0 是直角，40 接近圆形。播放页的大封面与小歌词下面的小封面共用这一个值，列表里的封面不受影响（那是列表自己的排版）。`
- 能力诊断：`HDS 能力位：${已挂载|当前设备无此能力位}　材质类型：${IMMERSIVE|ADAPTIVE|NONE}（玻璃：${系统材质|设备无材质能力位，用点光兜底|鸿蒙7 以下，材质不可用，用点光兜底}，${真机|模拟器}）`

#### 2.10.4 播放设置 PlaySettingsView

**音质卡**：

| 行 | 控件 | 选项 / 范围 | 默认 |
|---|---|---|---|
| 播放音质 | SegPills | `128K` / `320K` / `FLAC` / `24Bit` → `128k`/`320k`/`flac`/`flac24bit` | `128k` |
| 拓展音质 | Switch | 开 / 关 | **关** |
| └ 拓展音质档位（开关打开时才显示） | SegPills | `Hi-Res` / `全景声` / `全景声+` / `母带` → `hires`/`atmos`/`atmos_plus`/`master` | `hires` |
| └ 说明 | HintText | `这几档多数平台要会员，且要有支持它的音源；拿不到时自动退回「播放音质」里选的那档。` | — |
| 与其他应用同时播放 | Switch | 开 / 关 | **关** |
| 被打断结束后自动重新播放 | Switch | 开 / 关 | **开** |
| └ 说明 | HintText | 见下 | — |
| 音效增强 | Switch | 开 / 关 | **开** |
| └ 说明 | HintText | `使用系统音效（部分机型为 Histen 等增强）；关闭则为直通输出。本版仅支持开关系统音效，暂不支持自定义均衡器。` | — |
| 卡外说明 | HintText | `播放音质是首选档：这首没有该档时会自动往下退，不会因为选高了就放不出来。` | — |

**自动重播说明文案**：
```
被来电、闹铃或别的应用的声音打断时，系统会把我们暂停；这一项开着，打断结束（挂断、闹铃停）
就自动接着放，关掉则停在暂停、等你自己按播放。
（若「与其他应用同时播放」开着，追加：）「与其他应用同时播放」开着时走独立音频焦点模式，
一般不会被打断，这一项多半用不上。
```

**歌词卡**：

| 行 | 控件 | 默认 |
|---|---|---|
| 播放页显示小歌词 | Switch | **关** |
| 歌词页模糊效果 | Switch | **开** |
| 歌词居中显示 | Switch | **开** |
| 歌词字号 | Slider `13 – 30` | `19` |
| 歌词页不熄屏 | Switch | **开** |
| 桌面歌词 | Switch | **关** |
| └ 说明 | HintText | 见下 |
| 车载蓝牙歌词 | Switch | **关** |
| └ 说明 | HintText | 见下 |
| 本地 / 云端自动匹配歌词 | Switch | **开** |
| └ 说明 | HintText | 见下 |
| 卡外说明 | HintText | `「歌词页模糊效果」关掉后歌词页用纯深色底（封面页不受影响）；「歌词页不熄屏」只在全屏播放器停在歌词页时生效。` |

- 桌面歌词说明：不支持时 = `当前设备/系统不支持桌面歌词（系统的歌词悬浮窗），这个开关不会有实际效果；播控中心里的歌词不受影响。`；支持时 = `桌面歌词是系统的悬浮歌词窗，由系统按时间轴自己滚动：播放中且这首歌有词时显示，暂停不收起，停播、换到没词的歌或关掉这个开关时收起。`
- 车载蓝牙歌词说明：`把正在唱的这一句交给系统蓝牙模块，由它下发给已连接的蓝牙设备（车机、蓝牙音箱）显示。手机这边的播控中心不受影响：歌名、滚动歌词各有各的字段。能不能显示取决于车机或音箱本身是否支持（车机端通常还要打开「歌词显示」）；每换一句都会重推一次蓝牙媒体信息，不在车里时建议关掉，以免影响车机播放的流畅度。`
- 自动匹配歌词说明：`本地歌与云端歌（WebDAV）都没有平台身份，只能拿歌名与歌手去平台上搜一首对应的歌再取词（要联网，每首歌只搜一次）。匹配没把握时宁可不显示 —— 配错的歌词比没有歌词更糟；这时可以在播放页的「更多 - 匹配歌词」里自己搜一次、选正确的那条。同目录下的同名 .lrc 会一起导入 / 取回，优先用它，不联网也不会配错。`

#### 2.10.5 缓存 CacheSettingsView

两组（宽屏并排，各 48%）。

**播放缓存组**：`sectionTitle('播放缓存', sizeText(audioBytes))` + `audioCard()` + 两段 HintText

`audioCard()`：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── Row, space: 10, padding { left:14, right:14, top:12, bottom:10 }
│   ├── Column, space: 4, layoutWeight 1, alignItems Start
│   │   ├── Text「已用空间」字号 F_SUB, C_TEXT_WEAK
│   │   └── Text `${sizeText(bytes)} · ${count} 首` 字号 F_ITEM, C_TEXT
│   └── Text「清空」字号 F_SUB, 颜色 = count > 0 ? C_RED : C_TEXT_WEAK,
│            padding { left:10, right:10, top:6, bottom:6 }
├── Divider 0.6 C_DIVIDER, margin { left:14 }
├── Row, space: 10, padding { left:14, right:14, top:12, bottom:12 }
│   ├── Column, space: 4, layoutWeight 1, alignItems Start
│   │   ├── Text「缓存上限」字号 F_ITEM, C_TEXT
│   │   └── Text  limitMb > 0 ? `超过上限会淘汰最早播放的（下载文件夹里那份不受它管）`
│   │                          : `当前未开启，播放时不会缓存到本地`
│   │           字号 F_SUB, C_TEXT_WEAK
│   ├── TextInput  placeholder「MB」, 数字键盘, 字号 14, 宽 88, 高 38,
│   │              backgroundColor C_FILL_SOFT（提交时落盘：回车或失焦）
│   └── Text「MB」字号 F_SUB, C_TEXT_WEAK
├── Divider 0.6 C_DIVIDER, margin { left:14 }
└── Row, space: 10, padding { left:14, right:14, top:12, bottom:12 }
    ├── Column, space: 4, layoutWeight 1, alignItems Start
    │   ├── Text「缓存时自动下载」字号 F_ITEM, C_TEXT
    │   └── Text  autoDownload ? `已开启：另下一份到「下载」文件夹（不受上限约束）；应用内缓存照旧受上限约束`
    │                          : `播放时另下一份整首到「下载」文件夹长期保留（应用内缓存照旧）`
    │           字号 F_SUB, C_TEXT_WEAK
    └── Switch  trackColor.true = C_RED（打开时先弹确认框）
```

**播放缓存说明文案**：
1. `边听边把整首下到应用沙箱，下次播放直接读本地：不联网、不受源脚本影响。上限设 0 即关闭缓存。开了「缓存时自动下载」会另外整份下到「下载」文件夹（文件在「我的 - 下载管理」里可见可删、不受上限约束），沙箱这一份照旧存在、照旧受上限约束。`
2. `下载永远给播放让路：正在听的那首缓冲不够时缓存会停下来等（网络就那么多，先把声音喂饱），够用了再接着下；断在半路的会留着，下次接着下，不从头重来。上一首还在播时也会提前取下下一首，切歌时直接读本地文件。`

**「缓存时自动下载」确认框**：
- 标题 `开启「缓存时自动下载」`
- 正文：`播放过的歌会另外整份下载到「下载」文件夹，同时照旧留在应用内播放缓存里。\n\n· 「下载」文件夹那份不受缓存上限约束：一直留着，直到你在「我的 - 下载管理」里删掉；\n· 应用内那份照旧受上面的「缓存上限」约束，满了按最少使用的先淘汰；\n· 同一首歌会占两处空间，播放时也会多走一路网络（播放卡顿时下载会先等一等）。\n\n开启后，这些歌会出现在「我的 - 下载管理」里，可以单独删。`
- 按钮：取消（把开关拨回去）/ **开启**（红）
- 点弹窗外或返回键也算取消

**元数据缓存组**：`sectionTitle('元数据缓存', '')` + `metaCard()` + HintText

`metaCard()`：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── 三行（播放地址 / 歌词 / 封面地址），每行：
│   Row, space: 8, 高 46, padding { left:14, right:14 }
│   左标题 F_ITEM C_TEXT layoutWeight 1 + 右 `${count} 条` F_SUB C_TEXT_WEAK
│   行间 Divider 0.6 C_DIVIDER, margin { left:14 }
└── 清空行 Row, space: 10, 高 46, padding { left:14, right:14 }
    Icon `externaldrive` 18 C_TEXT_WEAK + Text「清空元数据缓存」F_ITEM C_RED
```

**元数据缓存说明**：`播放地址、歌词、封面地址都会缓存一份（对应洛雪的 @music_url / @lyric）：播放过的歌再次播放不必重新解析，歌词不会因为源抽风而忽然没有，封面也不必每次启动都为整张列表重新查一遍。`

**清空确认框**：标题 `清空缓存`，按钮 取消 / **清空**（红）
- 播放缓存：`确定清空播放缓存吗？共 ${size} / ${count} 首，清空后这些歌下次播放要重新下载。`
- 元数据：`确定清空元数据缓存吗？播放地址、歌词、封面地址都会重新获取。`

#### 2.10.6 下载设置 DownloadSettingsView

单张卡（宽屏仍按 48% 宽排，与其它设置页一致）：

| 行 | 控件 | 选项 | 默认 |
|---|---|---|---|
| 文件名称格式 | SegPills | `歌曲名` / `艺术家-标题` / `标题-艺术家` → `song`/`artist-title`/`title-artist` | `song` |
| 下载文件标注音质 | Switch | 开 / 关 | **开** |
| 下载目录 | 只读行 | 展示 `folderLabel()` | — |

**文件名示例**（`sampleName()`，基准歌名 `夜、萤火虫和你` / 歌手 `AniFace`）：
- `song` + 标注 = `夜、萤火虫和你-320k.mp3`；不标注 = `夜、萤火虫和你.mp3`
- `artist-title` + 标注 = `AniFace-夜、萤火虫和你-320k.mp3`
- `title-artist` + 标注 = `夜、萤火虫和你-AniFace-320k.mp3`

**说明文案**：
- `dirUri` 为空：`歌曲统一保存在应用自己的下载目录里，全程不弹对话框。下载一首之后，这里会显示它在「文件管理」里的位置。`
- 否则：`歌曲统一保存在「${folderLabel()}」，全程不弹对话框。这是应用自己的目录，位置固定、不能改；文件管理里打开「下载」就能看到它，也可以在那儿复制或分享下载好的文件。`
- 第二行：`文件名示例：「${sampleName()}」。同时最多下 2 首，其余排队。`

#### 2.10.7 音源设置 SourceSettingsView

四段（宽屏并排，各 48%，间距 16）：

**① 导入音源**：
```
Column, space: 10
├── sectionCard('导入音源')  字号 F_SECTION, Bold, C_TEXT, padding { left:4, bottom:8 }
└── Column, space: 10, padding 14, borderRadius R_CARD, backgroundColor C_CARD
    ├── TextArea  placeholder「粘贴音源脚本链接，例如 https://example.com/lx-source.js」
    │             高 72, 字号 12.5, backgroundColor C_FILL_SOFT, borderRadius 10
    └── Row, space: 10
        ├── Button「导入并加载」/「处理中…」layoutWeight 1, 高 40, 字号 14, backgroundColor C_RED
        └── Button「导入音源文件」layoutWeight 1, 高 40, 字号 14,
                 backgroundColor C_FILL_SOFT_STRONG, fontColor C_TEXT
```

**② 已导入音源**：`sectionCard('已导入音源')` + Column space 10
- 空：`还没有导入任何音源` F_SUB C_TEXT_WEAK, padding 16
- 每条：
```
Column, space: 8, width: '100%'
├── Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
│   └── HdsListItemCard
│       prefixItem: PrefixIcon(iconSize SYSTEM_ICON, symbol `record_circle`)
│       textItem: primaryText = 音源名
│                 secondaryText = `${版本号}　${作者或'未知作者'}`
│       suffixItem: 已加载 ? SuffixText('已就绪') : SuffixArrow(color C_CHEVRON)
│       cardHeight: 68
│       点击 → 加载该音源
└── Row, space: 10
    ├── Button「加载」layoutWeight 1, 高 34, 字号 13,
    │        backgroundColor C_FILL_SOFT_STRONG, fontColor C_TEXT
    └── Button「删除」layoutWeight 1, 高 34, 字号 13,
             backgroundColor C_RED_TINT, fontColor C_RED
```
版本号显示：空 → `未知版本`；首字母已是 `v` 则原样，否则补 `v`。

**③ 运行状态**：
```
Column, space: 10
├── sectionCard('运行状态')
└── Column, space: 10, padding 14, borderRadius R_CARD, backgroundColor C_CARD
    ├── infoLine('已声明平台', supportedText)   ← 平台名用 ' / ' 连接，无则 '-'
    ├── Divider 0.6 C_DIVIDER
    ├── infoLine('沙箱环境', `lx.env = ${sandboxEnv}`)
    ├── Divider 0.6 C_DIVIDER
    ├── Row, space: 10
    │   ├── Button「切换兼容模式」layoutWeight 1, 高 36, 字号 13,
    │   │        backgroundColor C_FILL_SOFT_STRONG, fontColor C_TEXT
    │   └── Button「一键离线自检」/「自检中…」layoutWeight 1, 高 36, 字号 13, 同上
    └── testUrl 非空：Text 字号 11.5, C_ICON_GREEN, 可复制
```
`infoLine`：`Row, width 100%, padding { top:3, bottom:3 }`，左 14 C_TEXT_SUB + Blank + 右 14 C_TEXT maxLines 1。

**④ 引擎日志**：`sectionCard('引擎日志')` + `Column, space: 3, padding 14, borderRadius R_CARD, backgroundColor C_CARD`
- 空：`暂无日志` 11.5 C_TEXT_WEAK
- 每行：`Text 字号 11, C_TEXT_SUB, width 100%, 可复制`；格式 `[时间][类型] 消息`；只保留最近 **60** 行

**状态文案**：
- 初始 `等待操作`
- `请先粘贴音源脚本链接（或脚本正文）` / `导入中…` / `已导入「${name}」，正在初始化沙箱…`
- `导入失败: ${msg}` / `正在加载音源…`
- `音源已就绪，可播放平台：${列表}` 或 `音源已加载，但它声明的平台都不在可播放范围内（可播放：${列表}）`
- `加载失败: ${msg}` / `已删除该音源`
- `已把沙箱环境切换为 ${env}，请重新点「加载」`
- `离线自检中…` / `离线自检通过` / `离线自检失败` / `离线自检异常: ${msg}`

**平台中文名映射**：`kw` 酷我 / `kg` 酷狗 / `mg` 咪咕 / `tx` QQ / `wy` 网易 / `xm` 喜马拉雅

#### 2.10.8 同步设置 SyncSettingsView

**`infoCard()`**：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── Row, space: 12, padding { left:14, right:14, top:14, bottom:12 }
│   ├── Column, space: 4, layoutWeight 1, alignItems Start
│   │   ├── Text「启用同步」字号 F_ITEM, C_TEXT
│   │   └── Text statusText 字号 F_SUB，颜色 = connected ? C_ICON_GREEN : C_TEXT_WEAK
│   └── Switch  trackColor.true = C_RED, enabled = !busy
├── Divider 0.6 C_DIVIDER, margin { left:14 }
├── Row, space: 10, 高 56, padding { left:14, right:14 }
│   Text「服务端」F_ITEM C_TEXT + TextInput placeholder「http://192.168.1.10:9527」
│       字号 14, 透明底, layoutWeight 1, enabled = !enable && !busy
├── Divider 0.6 C_DIVIDER, margin { left:14 }
├── Row, space: 10, 高 56, padding { left:14, right:14 }
│   Text「认证码」F_ITEM C_TEXT + TextInput 密码型 placeholder「服务端配置的认证码」
│       字号 14, 透明底, layoutWeight 1 + Button「连接」高 32, 字号 F_SUB, backgroundColor C_RED
├── Divider 0.6 C_DIVIDER, margin { left:14 }
└── Row, space: 10, padding { left:14, right:14, top:12, bottom:12 }
    ├── Column, space: 4, layoutWeight 1, alignItems Start
    │   ├── Text「本机设备名」字号 F_SUB, C_TEXT_WEAK
    │   └── Text deviceName 字号 F_ITEM, C_TEXT
    └── RoundIconButton  icon `arrow_2_circlepath`, boxSize 36, iconSize 18, label「刷新同步状态」
```

**`progressCard()`**（仅 `enable` 时显示）：
```
Column, space: 8, padding { left:14, right:14, top:12, bottom:12 }
borderRadius R_CARD, backgroundColor C_CARD
├── Row, space: 8
│   ├── Text  stage 非空 ? stage : (connected ? '已连接，等待变化' : '未连接')
│   │         字号 F_SUB, C_TEXT_SUB, layoutWeight 1
│   └── Text `${progress}%`（progress > 0 时）字号 F_SUB，
│           颜色 = progress >= 100 ? C_ICON_GREEN : C_RED
└── Progress(Linear)  value = progress, total 100, width 100%,
        color = progress >= 100 ? C_ICON_GREEN : C_RED,
        backgroundColor C_FILL_SOFT, strokeWidth 6
```

**`hostHistoryCard()`**（仅历史非空时）：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── Text「最近使用」字号 F_SUB, C_TEXT_WEAK, padding { left:16, right:16, top:12, bottom:6 }
└── 每条：Column
    ├── Row, space: 10, 高 46, padding { left:16, right:16 }
    │   Text 地址 14 C_TEXT layoutWeight 1 maxLines 1 + Icon `xmark` 15 C_TEXT_WEAK
    │   点击 → 填回服务端输入框并更新
    └── Divider 0.6 C_DIVIDER, margin { left:16 }（非最后一条）
```

**同步内容说明段**（`Column, space: 6`）：
- `sectionCard('同步内容', summaryText)`，`summaryText` = `试听列表 ${n} 首 · 收藏 ${n} 首 · 歌单 ${n} 个`
- `试听列表 = 本机的播放队列；收藏与歌单会与同一服务端的其它设备（洛雪桌面端 / 移动端）互通。`
- `注意：本地歌曲无法同步 —— 同步协议只传在线歌曲，本地音乐（从设备导入的音频）在同步时会被直接抛弃：不会上传到服务端，也不会从其它设备同步过来（歌单 / 收藏里的本地歌曲只留在本机，详见 docs/LOCAL_MUSIC.md）。`

**`dislikeCard()`**：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── Row, space: 8, padding { left:14, right:14, top:12, bottom:6 }
│   Text「不喜欢的歌曲」F_SECTION Medium C_TEXT layoutWeight 1
│   + Text「清空」F_SUB C_RED（规则非空时）
├── 无规则：Text「暂无规则。规则来自同步服务端，也可以在下面手动添加。」F_SUB C_TEXT_WEAK,
│            padding { left:14, right:14, bottom:12 }
├── 有规则：每条 Row, space: 10, 高 46, padding { left:14, right:14 }
│   Text 规则描述 14 C_TEXT layoutWeight 1 + Icon `trash` 17 C_TEXT_WEAK
│   （行间 Divider 0.6 C_DIVIDER, margin { left:14 }）
├── Divider 0.6 C_DIVIDER, margin { left:14 }
└── Row, space: 8, padding { left:14, right:14, top:10, bottom:12 }
    ├── TextInput placeholder「歌名」字号 13, backgroundColor C_FILL_SOFT, layoutWeight 1
    ├── TextInput placeholder「歌手」字号 13, 同上
    └── Icon `plus` 20, C_RED
```

**规则展示形式**（`describeDislikeRule`）：
- 无 `@` → `歌名：${rule}`
- `@` 前为空 → `歌手：${singer}`
- `@` 后为空 → `歌名：${name}`
- 否则 → `${name} — ${singer}`

**末尾协议说明**：`协议与洛雪官方一致：/hello + /id + /ah 认证、WebSocket 长连接、列表与「不喜欢的歌曲」两个模块，均可在设置里选择同步方式。`（字号 11.5, C_TEXT_WEAK）

**状态文案**：`未连接` / `已开启，正在连接…` / `已关闭同步` / `认证失败：请在下面填入服务端配置的认证码后点「连接」` / `请先填写认证码` / `认证失败：${msg}` / `连接失败：${msg}`

#### 2.10.9 WebDAV 设置 WebDavSettingsView

**`serverCard()`**（三行，每行高 56，`padding { left:14, right:14 }`，行间 Divider 0.6 C_DIVIDER margin left 14）：

| 标签 | placeholder | 类型 |
|---|---|---|
| 服务器 | `http://192.168.1.10:5006/dav` | 文本 |
| 用户名 | `留空表示匿名访问` | 文本 |
| 密码 | `部分服务需要「应用密码」` | 密码 |

**`actionCard()`**：
```
Column, space: 10, width: '100%'
├── Row, space: 10
│   ├── Button「测试连接并扫描」/「处理中…」layoutWeight 1, 高 36, 字号 14, backgroundColor C_RED
│   └── Button「重新扫描」layoutWeight 1, 高 36, 字号 14,
│            backgroundColor C_FILL_SOFT_STRONG, fontColor C_TEXT
├── progressText 非空：Row, space 10
│   ActivityIndicator 18 C_RED + Text 进度 F_SUB C_TEXT_SUB layoutWeight 1 + Text「取消」F_SUB C_RED
└── status 非空：Text 字号 F_SUB，颜色 = 以「连不上」或「扫描失败」开头 ? C_RED : C_TEXT_SUB, lineHeight 17
```

**扫描组**：`sectionTitle('扫描')` + 卡（`padding { left:16, right:16, top:8, bottom:8 }`）
- `ToggleSetting('读取云端标签', 默认 true)` + HintText
- 说明：`开启后，扫描时会逐首读取服务器上文件里的标签（歌名 / 歌手 / 专辑 / 时长），匹配封面和歌词会准很多，代价是每首发一次请求，几十首的目录会明显慢一点。关掉就用文件名猜（「歌手 - 歌名」这种命名能猜对），播放时照样能听。`

**`libraryCard()`**：
```
Column, space: 12, padding { left:14, right:14, top:14, bottom:14 }
borderRadius R_CARD, backgroundColor C_CARD
├── Row, space: 10：Text「云端曲库」F_ITEM C_TEXT layoutWeight 1
│   + Text  count > 0 ? `${count} 首 · ${size}` : '还没有歌'  F_SUB C_TEXT_WEAK
├── Row, space: 10：Text「上次扫描」F_SUB C_TEXT_SUB layoutWeight 1 + Text describeAgo F_SUB C_TEXT_WEAK
├── Row, space: 10：Text「本地缓存」F_SUB C_TEXT_SUB layoutWeight 1
│   + Text  cacheBytes > 0 ? size : '无'  F_SUB C_TEXT_WEAK
└── Button「清空本地缓存」高 36, 字号 14, width 100%,
        backgroundColor C_RED_TINT, fontColor C_RED
```

**`describeAgo(at)`**：`≤0` → `还没扫过`；`<60s` → `刚刚`；`<60min` → `${n} 分钟前`；`<24h` → `${n} 小时前`；否则 `${n} 天前`

**`describeScan(result)`**：
- `total === 0 && unsupported === 0`：`failedFolders > 0 ? '有 N 个目录读不到，没有找到可播放的音频' : '这个目录里没有找到音频文件'`
- 否则：`共 N 首` + 可选 `新增 N 首` / `移除 N 首` / `N 首格式不支持` / `目录太多，只扫了一部分` / `N 个目录读不到`，用 `，` 连接

**服务器说明**：`填 WebDAV 目录的完整地址（Nextcloud 通常是 https://你的域名/remote.php/dav/files/用户名/音乐目录）。「测试连接并扫描」连上之后会把该目录（含子目录）里的音乐扫出来，直接就能播。`

**曲库与缓存说明**：`曲库就是「上次扫描的结果」这份缓存：服务器上的文件不归这个应用管，要拿掉什么直接在服务器上删、然后重新扫描。云端音乐不参与洛雪同步（与本地音乐一致：同步只传在线歌曲）；歌单与收藏里的云端歌存在「非同步侧表」里，上行时不会发出去。`

**清缓存确认框**：标题 `清空云端音乐的本地缓存`，正文 `将清掉封面、歌词与匹配记录，下次扫描 / 播放会重新取一遍。服务器上的音乐文件与曲库列表都不受影响。`，按钮 取消 / **清空**（红）

#### 2.10.10 听书设置 ListenSettingsView

单张卡，一行开关：

| 行 | 控件 | 默认 | 说明文案（开关打开时） |
|---|---|---|---|
| 隐藏「听书」页签 | Switch | **关** | `「听书」已从底部导航栏隐藏，书架 / 搜索 / 书源都不再占一栏。要再显示出来，把上面这项关掉即可 —— 页签藏着的时候，这一个开关就是它的入口。` |

关闭时说明：`听书（书架 / 搜索 / 书源）现在单独占底部导航栏的一栏，夹在「推荐」与「我的」之间。用不上听书就打开上面这项，把那一栏从导航栏里去掉。`

#### 2.10.11 关于 AboutView

三张卡（宽屏并排，各 48%）。

**`appCard()`**：
```
Row, space: 15, width: '100%', padding { left:18, right:18, top:20, bottom:20 }
borderRadius R_CARD, backgroundColor C_CARD
├── Image app.media.startIcon  62×62, borderRadius 15
└── Column, space: 6, layoutWeight 1, alignItems Start
    ├── Text「聆听」21, Bold, C_TEXT
    └── Text  version 非空 ? `v${version} · 洛雪音乐（LX Music）的鸿蒙移植版`
                            : `洛雪音乐（LX Music）的鸿蒙移植版`
             字号 F_SUB, C_TEXT_WEAK, maxLines 2
```

**`aboutCard()`**：
```
Column, width: '100%', borderRadius R_CARD, backgroundColor C_CARD, clip: true
├── infoRow('作者', AUTHOR)    ← Row, 高 56, padding { left:18, right:18 }
│     左标签 F_ITEM C_TEXT layoutWeight 1 + 右值 F_SUB C_TEXT_SUB maxLines 1
├── Divider 0.6 C_DIVIDER, margin { left:18 }
├── infoRow('开源协议', LICENSE)
├── Divider 0.6 C_DIVIDER, margin { left:18 }
└── repoRow()
    Column, space: 5, width: '100%', padding { left:18, right:16, top:14, bottom:15 }
    ├── Text「项目主页」F_SUB C_TEXT_WEAK
    └── Row, space: 6
        Text REPO_URL  字号 13.5, C_ICON_BLUE, layoutWeight 1, maxLines 1
        Icon `arrowshape_turn_up_right` 15, C_ICON_BLUE
    按压态：backgroundColor C_PRESSED
```

**`feedbackCard()`**：
```
Row, space: 12, width: '100%', height: 70, padding { left:16, right:16 }
borderRadius R_CARD, backgroundColor C_CARD
├── Stack 34×34：圆底 34×34 borderRadius 17 backgroundColor C_ICON_CIRCLE + Icon `person_2` 19 C_TEXT
├── Column, space: 3, layoutWeight 1, alignItems Start
│   ├── Text「聆听用户反馈 Q 群」F_ITEM C_TEXT
│   └── Text  copied ? '已复制到剪贴板' : '点击复制群号'
│             字号 11.5，颜色 = copied ? C_RED : C_TEXT_WEAK
├── Text QQ_GROUP  字号 15.5, Medium, C_TEXT
└── Icon  copied ? `checkmark_circle_fill` : `doc_text_on_doc_text`, 16,
         颜色 = copied ? C_RED : C_ICON_BLUE
按压态：backgroundColor C_PRESSED（常态 C_CARD）
```

**常量**：`REPO_URL = 'https://github.com/Adamaik/lxmusic-harmony.git'`、
`AUTHOR = 'adamaik'`、`LICENSE = 'Apache License 2.0'`、`QQ_GROUP = '985841125'`、
`COPIED_HINT_MS = 1800`（「已复制」停留时长）。

**说明文字**：
- `该软件在 GitHub 上以阿帕奇 2.0 协议开源，欢迎 Star、提 Issue 或提 PR。`
- `有改进建议或者功能需求，欢迎向作者反馈：在 GitHub 仓库里提 Issue，或加入用户群聊一聊。`

---

### 2.11 四个共用 PanePage + SongListPane 的页面

#### 2.11.1 外壳 PanePage（本地音乐 / 最近播放 / 下载管理 / 云端音乐 / 书籍详情共用）

```
Stack (alignContent: Bottom), backgroundColor C_BG
├── 鸿蒙7：
│   Tabs(barPosition: End) → TabContent → content()  .tabBar(miniBarTabBar())
│   .vertical(false) .barMode(Fixed) .scrollable(false) .barOverlap(true)
│   .barHeight(56) .barBackgroundColor(transparent) .barFloatingStyle(floatBarStyle())
└── 鸿蒙6：
    Column → content()
    + fallbackMiniBar()（自绘胶囊：宽 = 宽屏算好的值 / 否则 100%，
                         高 56，圆角 28，thinGlass + 轮廓点光）
```

**栏内内容 `miniBarTabBar()`**：`Row, width/height 100%`
- 平时：`MiniBarView({ forceExpanded: true })`
- 多选时：`SelectionActions`

**几何（与壳层那条迷你栏同口径）**：`barSideMargin = barSideMarginFor(windowWidth)`，
`barBottomMargin = bottomInset + 10`，`barHeight = 56`，
`barWidth` 三档同值 = `K_BAR_MINI_WIDTH`（宽屏）或 `windowWidth - side*2`（窄屏铺满）。

**内容让位**：各面板自己加一段 `height = topInset` 的固定占位
（这些页的头部是常驻控件，不该滚进标题栏底下，所以不用 `contentStartOffset`）。

#### 2.11.2 SongListPane（共用歌曲列表）

```
Column, width/height 100%
├── items.length === 0 → EmptyState({ text: emptyText, topPadding: 82 })
└── 否则 List, lanes = contentColumnsFor(windowWidth)
    layoutWeight 1, scrollBar off, padding { bottom: bottomInset }, cachedCount 3
    └── ListItemGroup(footer = statusFooter())
        └── LazyForEach → ListItem → Column
            ├── Row, space: 8, width: '100%', height: coverSize + 22,
            │   padding { left:16, right:14 }
            │   ├── CoverArt  boxSize 52（默认）, radius 13
            │   ├── Column, space: 4, layoutWeight 1, alignItems Start
            │   │   ├── Text 歌名  字号 F_ITEM, 颜色 = 当前播 ? C_RED : C_TEXT, maxLines 1
            │   │   └── Row, space: 6（歌手非空或 showSource 时）
            │   │       ├── Text 歌手  F_SUB, C_TEXT_WEAK, layoutWeight 1, maxLines 1
            │   │       └── Text 平台标签（showSource 时）
            │   │           字号 10.5, platformColor(source),
            │   │           padding { left:5, right:5, top:1, bottom:1 },
            │   │           borderRadius 6, backgroundColor platformTint(source)
            │   └── 行尾：
            │       ├── 多选态：Icon 已选 ? checkmark_circle_fill : circle, 22,
            │       │          颜色 = 已选 ? C_RED : C_TEXT_WEAK（装饰）
            │       └── 普通态：FavoriteHeart(22) + Icon `dot_grid_1x2_circle` 22 C_TEXT_WEAK
            │                   （bindMenu(rowMenu)）
            ├── 行点击：多选态切换勾选；否则 onPick(index)
            ├── selectable 时：长按 → 进多选并勾上；否则长按 → 行菜单
            └── Divider 0.6 C_DIVIDER, margin { left: coverSize + 28 }
```

**`rowMenu`**：播放 / 下载（非本地非云端）/ 添加到歌单 / 添加到播放列表 /
添加到下一个播放 / 从本地音乐移除（仅本地歌）/ 多选（仅 `selectable` 时）

**`statusFooter()`**（仅 `footerStatus` 非空时）：
`Text 字号 12.5, C_TEXT_WEAK, width 100%, 居中, padding { top:14, bottom:14 }`

**「添加到歌单」面板 `AddToPlaylistSheet`**（SongListPane / 歌单详情 / 在线详情三处共用）：

```
Column, width/height 100%, padding { left:16, right:16, top:12 }
├── Text  songName 非空 ? `添加到歌单：${songName}` : '添加到歌单'
│         字号 F_ITEM, C_TEXT, maxLines 1
├── Row, space: 8
│   ├── TextInput  placeholder「新建歌单名称」字号 14, 高 44,
│   │              backgroundColor C_FILL_SOFT, layoutWeight 1
│   └── Button「新建并添加」字号 F_SUB, 高 44, backgroundColor C_RED,
│            enabled = name.trim().length > 0
├── candidates 为空：Text「还没有歌单，在上面新建一个；歌单会同步到其它设备」
│                    字号 F_SUB, C_TEXT_WEAK, padding { top:18, bottom:6 }
├── 否则 List, layoutWeight 1, margin { top:6 }
│   divider { strokeWidth: 0.6, color: C_DIVIDER }
│   └── 每条 ListItem：Row, space: 10, 高 50, padding { left:4, right:4 }
│       ├── Text 歌单名  F_ITEM, C_TEXT, layoutWeight 1, maxLines 1
│       └── Text `${count} 首`  F_SUB, C_TEXT_WEAK
└── 底部占位  height = bottomInset + 8
```

#### 2.11.3 本地音乐 LocalMusicPane

**头部 `header()`**：
```
Column, space: 8, width: '100%', padding { left:16, right:16, top:4, bottom:8 }
├── Row, space: 10, width: '100%'
│   ├── 导入钮 Row, space: 6, padding { left:14, right:16, top:9, bottom:9 },
│   │        borderRadius 19, backgroundColor C_RED
│   │   Icon `square_and_arrow_down` 17, 白 + Text「导入音乐」14, Medium, 白
│   ├── Blank
│   ├── Text  items.length > 0 ? `${count} 首 · ${sizeText(totalBytes)}` : ''
│   │         字号 F_SUB, C_TEXT_WEAK
│   └── Text  多选入口（有歌时）`选择` / `完成`，字号 F_SUB, C_RED,
│             padding { left:6, right:2, top:4, bottom:4 }
├── 导入中/有进度时：Row, space: 10, width: '100%',
│       padding { left:12, right:12, top:9, bottom:9 }, borderRadius R_CARD, backgroundColor C_CARD
│   ├── Text  `正在导入 ${progressText}` / `正在导入…`  字号 F_SUB, C_TEXT_SUB, layoutWeight 1
│   └── Text「取消」字号 F_SUB, C_RED, padding { left:8, right:4 }
└── 空且非导入中：Text 字号 F_SUB, C_TEXT_WEAK, lineHeight 18
    文案：「系统不允许三方应用自己扫描音乐库，所以导入走文件管理的音频列表：
          点上面的「导入音乐」→ 一屏列出设备上的音频 → 长按任意一首选「全选」→ 确定，
          一次就能把整个文件夹导进来。
          选中的歌会拷一份到应用内，设备里的原文件不动。」
```

**主体**：
```
Column, width/height 100%
├── 顶部占位  height = topInset
├── header()
├── Divider 0.6 C_DIVIDER, margin { left:16, right:16 }
└── SongListPane  items / currentId / emptyText「还没有导入本地音乐」
    selectable: true, layoutWeight 1
└── bindSheet(pickerOpen) → AddToPlaylistSheet（detents [MEDIUM, LARGE], 标题「添加到歌单」）
```

**多选操作**：收藏 / 加入播放列表 / 加入歌单 / **移除**（红字主操作）

**移除确认框**：
- 标题 `从本地音乐移除`
- 正文 `将删除${what}在应用内的副本（设备里的原文件不受影响）。`
  - 单条：`「${name}」`；多条：`这 ${n} 首`
- 按钮：取消 / **移除**（红）

**导入结果文案 `describeImport`**：`已导入 N 首` / `跳过 N 首（已经导入过）` / `N 首格式不支持` / `N 首读取失败` 用 `，` 连接；全空 → `没有可导入的文件`

**字节格式化**：`<1KB` → `${n} B`；`<1MB` → `${round(kb)} KB`；`<1GB` → `${mb.toFixed(1)} MB`；否则 `${(mb/1024).toFixed(2)} GB`

#### 2.11.4 最近播放 HistoryView

```
Column, width/height 100%
├── 顶部占位  height = topInset
└── SongListPane  items = PlaySession.history / currentId / emptyText「还没有播放记录」
    selectable: true, layoutWeight 1
└── bindSheet(pickerOpen) → AddToPlaylistSheet
```

**多选操作**：收藏 / 加入播放列表 / 加入歌单 / **删除记录**（红字主操作）

**删除确认框**：
- 标题 `删除播放记录`
- 正文 `从播放历史里删掉这 ${n} 条？收藏、下载与本地文件都不受影响。`
- 按钮：取消 / **删除**（红）

#### 2.11.5 下载管理 DownloadListPane

```
Column, width/height 100%, backgroundColor C_BG
├── 顶部占位  height = topInset
├── activeCount > 0 时：Text `正在下载 ${n} 首` 字号 F_SUB, C_TEXT_SUB,
│       width 100%, padding { left:16, right:16, bottom:8 }
├── items.length === 0：
│   Column, width 100%, layoutWeight 1, padding { top:60 }
│   ├── Text「还没有下载任何歌曲」15, C_TEXT_SUB
│   └── Text「在歌单、在线列表或播放器里点「下载」就会出现在这里」
│           字号 F_SUB, C_TEXT_WEAK, margin { top:8 }
└── 否则 Column, width 100%, layoutWeight 1, padding { left:16, right:16 }
    └── List, lanes = contentColumnsFor, layoutWeight 1,
        borderRadius R_CARD, backgroundColor C_CARD, scrollBar off,
        padding { bottom: bottomInset }
        divider { strokeWidth: 0.6, color: C_DIVIDER, startMargin: 72 }
        └── 每条 row(item)
```

**行 `row(item)`**：
```
Row, space: 12, width: '100%', padding { left:16, right:14 }, height: 66
├── CoverArt  boxSize 44, radius 12, pending = (coverUrl 空 && musicInfoJson 非空)
├── Column, space: 3, layoutWeight 1, alignItems Start
│   ├── Text 歌名  字号 F_ITEM, C_TEXT, maxLines 1
│   ├── Text subtitle  字号 F_SUB，颜色 = status === 'error' ? C_RED : C_TEXT_WEAK, maxLines 1
│   └── Text note（非空时）字号 11, C_RED, maxLines 1
└── 行尾：
    ├── 多选态：Icon 已选 ? checkmark_circle_fill : circle, 22
    ├── status === 'downloading'：Progress(Ring) 22×22, color C_RED,
    │       strokeWidth 3, backgroundColor C_FILL_SOFT_STRONG
    └── 否则：Icon  status === 'done' ? play_circle_fill : dot_grid_1x2_circle, 22, C_TEXT_WEAK
              （bindMenu(rowMenu)）
行点击：多选态切换；否则 playAt(item)
长按：进多选
```

**`subtitle(item)`**：
- `waiting`：`排队中…（边听边存）` / `排队中…`
- `downloading`：`下载中 ${percent}%　${received} / ${total}`（total 未知时 `下载中　已接收 ${received}`）
- `error`：`下载失败：${error}`
- `done`：`已下载　${size}` + 可选 `边听边存` + 可选 `tagNote`，用 `　·　` 连接

**字节格式化 `sizeText`**：`<1KB` → `${n} B`；`<1MB` → `${kb.toFixed(0)} KB`；否则 `${(kb/1024).toFixed(1)} MB`

**行菜单 `rowMenu`**：播放（仅 done）/ 重新下载（仅 error）/ 删除 / 多选

**多选操作**：重新下载 / **删除**（红字主操作）

**删除确认框**：
- 标题 `删除下载`
- 批量：有已下完的 → `会同时删掉这 ${n} 条记录和其中 ${files} 个已下载的文件，确定吗？`；否则 → `确定删掉这 ${n} 条下载记录吗？`
- 单条：done → `会同时删掉本地文件「${fileName}」，确定吗？`；否则 → `确定删掉这条下载记录吗？`
- 按钮：取消 / **删除**（红）

**点行提示**：非 done 时 → `${还在下载中|没下完（${error}）}，可以在右侧「更多」里重新下载`；done 时 → `播放已下载的「${name}」`

#### 2.11.6 云端音乐 WebDavPane

头部结构与本地音乐同款，差别：

| 项 | 值 |
|---|---|
| 主按钮图标 | `arrow_2_circlepath` |
| 主按钮文案 | `actionLabel()`：未配置 → **去设置**；`scanTime() === 0` → **连接并扫描**；否则 → **刷新** |
| 多选入口 | `选择` / `完成`，同本地音乐 |
| 进度行 | ActivityIndicator 18 C_RED + `progressText` + 「取消」 |
| 状态行 | Text 字号 F_SUB, C_TEXT_SUB, lineHeight 17 |
| 空态说明 | `云端音乐 = 自己 WebDAV 服务器上的音乐。填好服务器地址后扫一遍，目录里的音乐就直接能播 —— 不用先导入什么。\n封面与歌词会自动匹配（服务器上有同名 .lrc / 封面图就用它们），听过的歌会缓存在本机，也能加进歌单与收藏。\n这一份不参与洛雪同步（与本地音乐一致：同步只传在线歌曲）。` |

**主体**：`SongListPane`，`emptyText = '云端曲库还是空的'`，`selectable: true`

**多选操作**：收藏 / 加入播放列表 / 加入歌单（**没有**删除 / 移除 —— 文件在服务器上）

**状态文案**：`还没有配置服务器，先到设置里填地址与账号` / `上次扫描：${describeAgo(scanTime)}` / `正在扫描云服务器…` / `扫描失败：${msg}`

#### 2.11.7 多选底栏 SelectionActions（六个页面共用）

```
Row, width/height 100%, alignItems Center
└── 每项 layoutWeight 1, height 100%, justifyContent Center
    Column, space: 3
    ├── Icon  iconSize 20, 颜色见下（装饰，读屏跳过）
    └── Text 短文案, 字号 F_TAB(10.5), maxLines 1, 颜色见下
```

**颜色**：非主操作一律 `C_TEXT`；主操作 = `count > 0 ? C_RED : C_TEXT_WEAK`。

**图标按文案认**：

| 文案 | 图标 |
|---|---|
| 收藏 | `heart` |
| 取消收藏 | `heart_slash` |
| 加入歌单 / 添加到歌单 | `add_songlist` |
| 加入播放列表 / 添加到播放列表 | `list_badge_play` |
| 下一个播放 | `forward_end_fill` |
| 下载 / 重新下载 | `arrow_down_to_line` |
| 移除 | `minus_circle` |
| 从歌单中删除 | `remove_songlist` |
| 其它（默认） | `trash` |

**短文案（只换显示，分发仍用原文案）**：

| 原 | 短写 |
|---|---|
| 加入歌单 / 添加到歌单 | **歌单** |
| 加入播放列表 / 添加到播放列表 | **播放列表** |
| 下一个播放 | **下一首** |
| 从歌单中删除 | **移除** |
| 删除记录 | **删除** |
| 其它 | 原样 |

**六个页面的批量操作清单**：

| 页面 | 底栏（**粗体** = 红字主操作） |
|---|---|
| 播放历史 | 收藏 / 播放列表 / 歌单 / **删除记录** |
| 下载管理 | 重新下载 / **删除** |
| 本地音乐 | 收藏 / 播放列表 / 歌单 / **移除** |
| 云端音乐 | 收藏 / 播放列表 / 歌单（无主操作） |
| 歌单详情 / 收藏 | 收藏 / 歌单 / 播放列表 / 下一首 / 下载 / **从歌单中删除** |
| └ 内置收藏歌单 | 歌单 / 播放列表 / 下一首 / 下载 / **取消收藏** |
| 在线歌单 / 榜单 | 歌单 / 播放列表 / 下一首 / 下载 / **收藏** |

**多选状态同步**：全局会话 `SelectSession` 持有 `actions` / `onCancel` / `onToggleAll` / `onAction`，
并发布三个订阅值：
- `K_SELECT_ACTIVE`（布尔，顶栏与底栏据此切换）
- `K_SELECT_COUNT`（数字，顶栏标题与主操作可用态）
- `K_SELECT_ALL`（布尔，顶栏右钮文案）

各页面在 `enterSelecting` 与 `selectedIds` 变化两处发布，`aboutToDisappear` 里收走。

---

## 3. 视觉 token 全表

### 3.1 颜色 token（亮色 / 暗色逐项对照）

> ArkTS 原值是 `#AARRGGBB`，下表「RN 值」列已转成 `#RRGGBBAA`，可直接用于 React Native。

#### 3.1.1 页面与容器

| token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 | 语义用途 |
|---|---|---|---|---|---|---|
| `C_BG` | `c_bg` | `#F1F1F2` | `#121214` | `#F1F1F2` | `#121214` | 页面底色（浅灰 / 近黑） |
| `C_TOP_FADE` | `c_top_fade` | `#F1F1F2` | `#121214` | `#F1F1F2` | `#121214` | 顶栏渐隐起点色 |
| `C_TOP_FADE_END` | `c_top_fade_end` | `#00F1F1F2` | `#00121214` | `#F1F1F200` | `#12121400` | 顶栏渐隐终点色（同色 alpha 0） |
| `C_CARD` | `c_card` | `#FFFFFF` | `#1C1C1F` | `#FFFFFF` | `#1C1C1F` | 卡片 / 列表底 |
| `C_FILL_SOFT` | `c_fill_soft` | `#F2F2F4` | `#26262A` | `#F2F2F4` | `#26262A` | 浅一档填充（搜索框、说明块、动作区） |
| `C_FILL_SOFT_STRONG` | `c_fill_soft_strong` | `#EDEDF0` | `#2D2D32` | `#EDEDF0` | `#2D2D32` | 再深一档填充（次级按钮、轨道底、头像底） |
| `C_SEG_BG` | `c_seg_bg` | `#EBEBED` | `#2A2A2E` | `#EBEBED` | `#2A2A2E` | 分段胶囊容器底 |
| `C_DIVIDER` | `c_divider` | `#EDEDEE` | `#2A2A2E` | `#EDEDEE` | `#2A2A2E` | 分割线 |
| `C_MASK_BOTTOM` | `c_mask_bottom` | `#66F1F1F2` | `#66121214` | `#F1F1F266` | `#12121466` | 底部页签栏下的渐隐蒙层 |

#### 3.1.2 文字与图标

| token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 | 语义用途 |
|---|---|---|---|---|---|---|
| `C_TEXT` | `c_text` | `#0D0D0D` | `#F2F2F4` | `#0D0D0D` | `#F2F2F4` | 主要文字 |
| `C_TEXT_SUB` | `c_text_sub` | `#8A8A8E` | `#A3A3A9` | `#8A8A8E` | `#A3A3A9` | 次要文字（歌手、副标题） |
| `C_TEXT_WEAK` | `c_text_weak` | `#B4B4B8` | `#74747B` | `#B4B4B8` | `#74747B` | 更弱文字（占位、计数、行尾图标） |
| `C_ICON` | `c_icon` | `#1A1A1A` | `#EDEDF0` | `#1A1A1A` | `#EDEDF0` | 未选中图标 |
| `C_CHEVRON` | `c_chevron` | `#C2C2C6` | `#5C5C63` | `#C2C2C6` | `#5C5C63` | 行尾小箭头 |
| `C_SEG_UNSELECTED` | `c_seg_unselected` | `#3A3A3C` | `#C8C8CE` | `#3A3A3C` | `#C8C8CE` | 分段胶囊未选中文字 |
| `C_TAB_UNSELECTED` | `c_tab_unselected` | `#4A4A4C` | `#B4B4BA` | `#4A4A4C` | `#B4B4BA` | 底部页签栏未选中文字 |
| `C_ON_ACCENT` | `c_on_accent` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | 强调色药丸上的反白字 |

#### 3.1.3 强调色与状态

| token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 | 语义用途 |
|---|---|---|---|---|---|---|
| `C_RED` | `c_red` | `#E33B3B` | `#FF5F5F` | `#E33B3B` | `#FF5F5F` | 强调色（洛雪红） |
| `C_RED_TINT` | `c_red_tint` | `#14E33B3B` | `#2EFF5F5F` | `#E33B3B14` | `#FF5F5F2E` | 强调色淡底（标签、重试钮、图标底） |
| `C_ICON_CIRCLE` | `c_icon_circle` | `#0F000000` | `#1FFFFFFF` | `#0000000F` | `#FFFFFF1F` | 设置行图标 / 头像淡圆底 |
| `C_RECORD_BUTTON` | `c_record_button` | `#0B0B0C` | `#33333A` | `#0B0B0C` | `#33333A` | 折叠态唱片圆钮底 |
| `C_PRESSED` | `c_pressed` | `#14404044` | `#1FFFFFFF` | `#40404414` | `#FFFFFF1F` | 按压态覆盖色 |
| `C_SLIDER_TRACK` | `c_slider_track` | `#E4E4E8` | `#3A3A40` | `#E4E4E8` | `#3A3A40` | 滑块轨道 |

#### 3.1.4 玻璃层

| token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 | 语义用途 |
|---|---|---|---|---|---|---|
| `C_GLASS_FILL` | `c_glass_fill` | `#1AFFFFFF` | `#1FFFFFFF` | `#FFFFFF1A` | `#FFFFFF1F` | 最透一档玻璃底（圆钮、迷你栏） |
| `C_GLASS_TINT` | `c_glass_tint` | `#BDFFFFFF` | `#C226262A` | `#FFFFFFBD` | `#26262AC2` | 中等厚度玻璃底（卡片式浮层） |
| `C_GLASS_EDGE` | `c_glass_edge` | `#FFFFFF` | `#66FFFFFF` | `#FFFFFF` | `#FFFFFF66` | 玻璃层描边（顶边高光） |
| `C_GLASS_SOLID` | `c_glass_solid` | `#D1FFFFFF` | `#E1242428` | `#FFFFFFD1` | `#242428E1` | 提示条那种更实的玻璃底 |
| `C_GLASS` | `c_glass_mask` | `#B8FFFFFF` | `#B81C1C1F` | `#FFFFFFB8` | `#1C1C1FB8` | 玻璃层主色（材质不生效时的兜底观感） |
| `C_GLASS_EDGE`（mask 变体） | `c_glass_mask_edge` | `#B3FFFFFF` | `#33FFFFFF` | `#FFFFFFB3` | `#FFFFFF33` | 玻璃层描边（mask 档） |
| `C_GLASS_DARK` | `c_glass_on_media` | `#2EFFFFFF` | `#2EFFFFFF` | `#FFFFFF2E` | `#FFFFFF2E` | 深色玻璃（播放器控制区，两种模式相同） |

> 注：`c_glass_edge` 与 `c_glass_mask_edge` 是两个不同 token，前者给自绘玻璃描边，后者给另一档。

#### 3.1.5 设置页图标色（彩色圆底）

| token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 |
|---|---|---|---|---|---|
| `C_ICON_BLUE` | `c_icon_blue` | `#2F6BFF` | `#5C8CFF` | `#2F6BFF` | `#5C8CFF` |
| `C_ICON_PURPLE` | `c_icon_purple` | `#8257F5` | `#A78BFA` | `#8257F5` | `#A78BFA` |
| `C_ICON_GREEN` | `c_icon_green` | `#2FBE5B` | `#4FD08A` | `#2FBE5B` | `#4FD08A` |
| `C_ICON_ORANGE` | `c_icon_orange` | `#F4A11E` | `#FFB84D` | `#F4A11E` | `#FFB84D` |
| `C_ICON_CORAL` | `c_icon_coral` | `#F4634B` | `#FF7B62` | `#F4634B` | `#FF7B62` |

#### 3.1.6 平台品牌色与淡底

| 平台 | token | ArkTS 名 | 亮色 | 暗色 | RN 亮色 | RN 暗色 |
|---|---|---|---|---|---|---|
| 酷我 `kw` | 品牌 | `p_kw` | `#FF6B35` | `#FF8A5C` | `#FF6B35` | `#FF8A5C` |
| | 淡底 | `p_kw_tint` | `#1FFF6B35` | `#2EFF8A5C` | `#FF6B351F` | `#FF8A5C2E` |
| 酷狗 `kg` | 品牌 | `p_kg` | `#4A90D9` | `#74A6E6` | `#4A90D9` | `#74A6E6` |
| | 淡底 | `p_kg_tint` | `#1F4A90D9` | `#2E74A6E6` | `#4A90D91F` | `#74A6E62E` |
| 咪咕 `mg` | 品牌 | `p_mg` | `#FF4081` | `#FF6FA5` | `#FF4081` | `#FF6FA5` |
| | 淡底 | `p_mg_tint` | `#1FFF4081` | `#2EFF6FA5` | `#FF40811F` | `#FF6FA52E` |
| QQ `tx` | 品牌 | `p_tx` | `#31C27C` | `#4FD494` | `#31C27C` | `#4FD494` |
| | 淡底 | `p_tx_tint` | `#1F31C27C` | `#2E4FD494` | `#31C27C1F` | `#4FD4942E` |
| 网易 `wy` | 品牌 | `p_wy` | `#C62F2F` | `#E86A6A` | `#C62F2F` | `#E86A6A` |
| | 淡底 | `p_wy_tint` | `#1FC62F2F` | `#2EE86A6A` | `#C62F2F1F` | `#E86A6A2E` |

取不到平台时退回：品牌色 → `C_TEXT_SUB`；淡底 → `C_RED_TINT`。

#### 3.1.7 系统级 / 特殊色

| 名称 | 值 | 用途 |
|---|---|---|
| `start_window_background` | 亮 `#FFFFFF` / 暗 `#000000` | 启动窗口背景 |
| 播放器页底 | `#0C0C0E` | 全屏播放器根容器 |
| 播放器背景渐变 | `angle 205`, `#33333A` → `#0C0C0E` | 封面模糊图的兜底渐变 |
| 播放器压暗层 | `#40000000` | 盖在封面模糊图上 |
| 播放器歌词页纯深底 | `#0C0C0E` | 关掉「歌词页模糊效果」时 |
| 自绘底部面板底 | `#232326` | 「更多」/ 音质面板 |
| 自绘遮罩 | `#8A000000` | 面板背后的遮罩 |
| 评论面板配色 | 见 2.8 | 深色专用，与深浅模式无关 |

#### 3.1.8 与深浅模式无关的装饰色（保留字面量）

**占位封面配色**（按歌名 hash 循环取，`sum = (sum*31 + charCode) % 9973`）：
```
['#2B2B33','#141417']  ['#3A2E1E','#191410']  ['#1B2A33','#0E1519']
['#2E2233','#150F19']  ['#33241F','#1A1210']  ['#1F2E24','#101813']
```

**黑心占位封面 `HeartCover`**：
- 底：`linearGradient { angle: 180, ['#17171A' 0.0, '#0A0A0B' 1.0] }`，`backgroundColor #0A0A0B`
- 三颗金点：直径 `boxSize*0.12` / `0.17` / `0.12`，色 `#C9A227` / `#E2BB3C` / `#C9A227`，
  `Row space = boxSize*0.045`，`alignItems Bottom`，`offset { y: -boxSize*0.27 }`
- 白心：`heart_fill`，`iconSize = boxSize*0.62`，色 `#F4F4F6`，`offset { y: boxSize*0.05 }`

**CoverArt 兜底渐变块**：`angle 145`，`paletteOf(name)[0] → [1]`；
首字母 `fontSize = boxSize*0.4`，Bold，`#FFFFFFD9`；容器底 `#1C1C1E`。

**播放器白字**（无论深浅模式都在深色封面上）：
`#FFFFFF` / `#FFFFFFF2` / `#FFFFFFE6` / `#FFFFFFCC` / `#FFFFFFB3` / `#FFFFFFA6` /
`#FFFFFF99` / `#FFFFFF8C` / `#FFFFFF66` / `#FFFFFF5E` / `#FFFFFF59` / `#FFFFFF40` / `#FFFFFF26`

### 3.2 圆角常量

| 常量 | 值 | 用途 |
|---|---|---|
| `R_PILL` | `30` | 底部悬浮导航 / 迷你播放器胶囊 |
| `R_CARD` | `16` | 卡片（设置卡、歌单卡、信息卡） |
| `R_COVER` | `12` | 列表封面默认圆角 |

**其它散落圆角**（按用途）：

| 值 | 用途 |
|---|---|
| `36` | 播放钮圆底（72/2） |
| `28` | 迷你栏胶囊（56/2） |
| `23` | 在线详情动作按钮（46/2）、导入歌单主按钮 |
| `22` | 榜单卡片 |
| `20` | 自绘底部面板顶角、系统胶囊分段常规档 |
| `19` | 本地音乐 / 云端音乐主按钮（38/2） |
| `18` | 来源胶囊、重试钮、头像（36/2）、歌单详情封面 |
| `17` | 设置行图标圆底（34/2） |
| `16` | 歌单卡动作区、词胶囊、居中行图标底（32/2） |
| `15` | 快捷入口图标底（圆角方 44）、排序下拉胶囊、分段胶囊紧凑档 |
| `14` | 快捷入口按压区、歌单占位封面（46）、导入预览封面（62） |
| `13` | SongListPane 行封面 |
| `10` | 音质钮、音源脚本输入框 |
| `9` | 榜单/平台小标签 |
| `8` | 评论图、导入预览平台标签 |
| `7` | 歌词匹配平台标签 |
| `6` | 搜索结果平台标签 |
| `3` | 进度条轨道、页码指示点 |

### 3.3 字号常量

| 常量 | 值 | 用途 |
|---|---|---|
| `F_TITLE` | `29` | 页面大标题（`PageTitle`） |
| `F_SECTION` | `17` | 分组标题（`SectionTitle`） |
| `F_ITEM` | `16.5` | 列表主标题 |
| `F_SUB` | `12.5` | 列表副标题 |
| `F_TAB` | `10.5` | 底部导航文字 / 多选底栏文字 |

**其它散落字号**：

| 值 | 用途 |
|---|---|
| `34` | 榜单卡中央大标题 |
| `22` | 播放器歌名、底部页签图标（fontSize）、`SettingsView` 登录卡图标 |
| `21` | 关于页应用名 |
| `20` | 歌单 / 在线详情标题、在线详情封面图标、设置行图标 |
| `19` | 关于页反馈图标 |
| `18` | 榜单卡底部歌名、登录卡标题、设置行箭头、快捷入口箭头 |
| `16` | 播放列表歌名、评论页标题、评论面板项、菜单项 |
| `15` | 设置项标题、在线详情动作、导入歌单按钮、同步输入框 |
| `14.5` | 来源胶囊文字、评论正文（非嵌套） |
| `14` | 音源设置按钮、导入预览、同步输入框、推荐状态文字 |
| `13.5` | 导入歌单 TextArea、关于页仓库地址、评论（嵌套） |
| `13` | 排序下拉、搜索筛选胶囊、词胶囊、联想词、评论时间、音源设置按钮 |
| `12.5` | 导入预览歌曲、在线详情简介、歌词匹配说明 |
| `12` | 平台标签、底部占位文字、迷你栏歌名 |
| `11.5` | 榜单卡平台名、播放器时间/音质、说明文字（`HintText`）、关于页「点击复制群号」 |
| `11` | 底部页签文字、快捷入口条数、榜单卡副标题 |
| `10.5` | 搜索结果平台标签 |
| `10` | 迷你栏歌手 |

### 3.4 Glass.ets 玻璃层做法

**一个 `GlassModifier` 让所有玻璃层共用同一套参数**，字段与默认值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `radius` | 构造参数 | 圆角 |
| `dark` | `false` | 是否深色玻璃（播放器控制区用） |
| `tint` | `''` | 显式底色（必须半透明）；空串 = 用默认档 |
| `thin` | `true` | 薄档 / 中等档（选 `C_GLASS_FILL` 还是 `C_GLASS_TINT`） |
| `shadowRadius` | `0` | 阴影半径，**0 = 不画阴影**（默认不画，与派音一致） |
| `blurStyle` | `COMPONENT_THICK` | 毛玻璃厚度，由 `buildGlassBlur(level)` 给 |
| `materialFirst` | `false` | 材质优先（材质可用时不画自绘底） |

**三个便捷构造**：

| 函数 | 用途 |
|---|---|
| `thinGlass(radius, dark=false, tint='', level=0)` | 悬浮导航胶囊 / 迷你播放器 / 圆钮（最透一层） |
| `regularGlass(radius, dark=false, tint='', level=0)` | 卡片 / 弹层（中等厚度） |
| `materialFirstGlass(radius, level=0)` | **沉浸光感生效范围内**（标题栏 / 底部 TabBar）的悬浮控件 |

**`applyNormalAttribute` 的完整顺序（RN 实现按此翻译）**：

```
1. borderRadius(radius)

2. if (materialFirst && 材质可用) {
     backgroundColor = transparent     // 必须显式写透明，否则 Button 自带蓝底会露出来
     return                            // 不再画任何自绘底
   }

3. backgroundBlurStyle = blurStyle     // 毛玻璃（RN: BlurView / expo-blur）

4. mask = tint 非空 ? tint
        : dark    ? '#19FFFFFF'                       // FLOAT_FILL_DARK
        : thin    ? C_GLASS_FILL
        :           C_GLASS_TINT
   backgroundColor = mask

5. borderWidth = 1
   borderColor = dark ? '#66FFFFFF' : C_GLASS_EDGE

6. if (shadowRadius > 0) {
     shadow = { radius: shadowRadius,
                color: dark ? '#0000003D' : '#0000001F',
                offsetX: 0, offsetY: 10 }
   }

7. // 真材质（鸿蒙7）由组件上的 .systemMaterial() 叠加，
   //    材质生效时会接管 backgroundColor / borderColor / borderWidth / shadow，
   //    所以 4/5/6 在支持材质时是兜底而非叠加
```

**三个玻璃档位的取值**（`ui/Glass.ets` 里的字面量）：

| 名称 | 值 | 用途 |
|---|---|---|
| `FLOAT_FILL_DARK` | `#19FFFFFF` | `dark: true` 时的默认底（白 10%） |
| `EDGE_HIGHLIGHT_DARK` | `#66FFFFFF` | `dark: true` 时的描边（白 40%） |

**`GLASS_THIN` / `GLASS_REGULAR`**：`0` / `1`（导出常量，实际选择由 `thinGlass` / `regularGlass` 决定）。

---

## 4. 图标映射表

`ui/Icons.ets` 里全部 `I_*` 常量（共 **68** 个）。「RN 建议」列给出 `react-native-vector-icons` 的
`MaterialCommunityIcons`（MCI）/ `Ionicons`（Ion）/ `MaterialIcons`（MI）/ `Feather` 的替代名。

### 4.1 导航与页面

| 常量 | HarmonyOS 符号 | 语义 | RN 建议（MCI / 其他） |
|---|---|---|---|
| `I_HOME` | `house` | 首页（未选中） | `home-outline` |
| `I_HOME_FILL` | `house_fill` | 首页（选中） | `home` |
| `I_PERSON` | `person` | 我的（未选中） | `account-outline` |
| `I_PERSON_FILL` | `person_fill` | 我的（选中） | `account` |
| `I_BOOK` | `book_pages` | 听书（未选中） | `book-open-outline` |
| `I_BOOK_FILL` | `book_pages_fill` | 听书（选中） | `book-open` |
| `I_BOOKSHELF` | `bookshelf` | 我的书架 | `bookshelf` |
| `I_PLAYLIST` | `music_note_list` | 歌单 | `playlist-music-outline` |
| `I_PLAYLIST_FILL` | `music_note_list_fill` | 歌单（选中） | `playlist-music` |
| `I_GEAR` | `gearshape` | 设置 | `cog-outline` |
| `I_GEAR_FILL` | `gearshape_fill` | 设置（选中） | `cog` |
| `I_HELP` | `questionmark_circle` | 帮助和反馈 | `help-circle-outline` |
| `I_INFO` | `info_circle` | 关于 | `information-outline` |

### 4.2 搜索与发现

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_SEARCH` | `magnifyingglass` | 搜索 | `magnify` |
| `I_IDENTIFY` | `identify_song` | 听歌识曲 | `music-note-plus` / Ion `musical-notes` |
| `I_SORT` | `line_3_horizontal` | 排序 | `sort` |
| `I_DISC` | `record_circle` | 唱片 / 音源 | `record-circle-outline` |
| `I_TROPHY` | `star_trophy` | 榜单 | `trophy-outline` |
| `I_DOC` | `doc_plaintext` | 分类 | `file-document-outline` |
| `I_STAR` | `star` | 精选 | `star-outline` |
| `I_MIC` | `mic` | 歌手 | `microphone-outline` |
| `I_BRUSH` | `paintbrush` | 外观 / 主题 | `brush` |
| `I_CACHE` | `externaldrive` | 缓存 | `harddisk` |

### 4.3 播放控制

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_PLAY` | `play_fill` | 播放 | `play` |
| `I_PAUSE` | `pause_fill` | 暂停 | `pause` |
| `I_PLAY_CIRCLE` | `play_circle_fill` | 圆形播放钮 | `play-circle` |
| `I_PAUSE_CIRCLE` | `pause_circle_fill` | 圆形暂停钮 | `pause-circle` |
| `I_PREV` | `backward_end_fill` | 上一首 | `skip-previous` |
| `I_NEXT` | `forward_end_fill` | 下一首 | `skip-next` |
| `I_REPEAT` | `repeat` | 列表循环 | `repeat` |
| `I_ORDER_PLAY` | `order_play` | 顺序播放 | `playlist-play` / `format-list-numbered` |
| `I_REPEAT_ONE` | `repeat_1` | 单曲循环 | `repeat-once` |
| `I_SHUFFLE` | `shuffle` | 随机播放 | `shuffle` |
| `I_QUEUE` | `music_note_list` | 播放列表 | `playlist-music` |
| `I_VOLUME` | `speaker_wave_3` | 播放中指示 | `volume-high` / `waveform` |
| `I_CAST` | `statusbar_cast` | 投播至 | `cast` |
| `I_MORE` | `more` | 更多（横点） | `dots-horizontal` |
| `I_MORE_CIRCLE` | `dot_grid_1x2_circle` | 行尾「更多」（圆环里两个竖点） | `dots-vertical-circle-outline` |

### 4.4 收藏与社交

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_HEART` | `heart` | 未收藏 | `heart-outline` |
| `I_HEART_FILLED` | `heart_fill` | 已收藏 | `heart` |
| `I_HEART_SLASH` | `heart_slash` | 取消收藏（划掉的心） | `heart-off-outline` |
| `I_COMMENT` | `message` | 评论 | `comment-outline` / `message-outline` |
| `I_THUMB_UP` | `hand_thumbsup` | 点赞 | `thumb-up-outline` |
| `I_SHARE` | `share` | 分享 | `share-variant-outline` |
| `I_GROUP` | `person_2` | 群 / 多人 | `account-multiple-outline` |
| `I_BELL` | `bell` | 通知 | `bell-outline` |
| `I_COPY` | `doc_text_on_doc_text` | 复制 | `content-copy` |
| `I_EXTERNAL` | `arrowshape_turn_up_right` | 打开外部链接 | `open-in-new` |
| `I_REFRESH` | `arrow_2_circlepath` | 刷新 / 重连 | `refresh` |

### 4.5 编辑与文件

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_PLUS` | `plus` | 新建 | `plus` |
| `I_TRASH` | `trash` | 删除 | `delete-outline` |
| `I_MINUS_CIRCLE` | `minus_circle` | 移除（圈中减号） | `minus-circle-outline` |
| `I_DOWNLOAD` | `download` | 下载 | `download` |
| `I_DOWNLOAD_TO_LINE` | `arrow_down_to_line` | 下载 / 重新下载（落到一条线） | `tray-arrow-down` |
| `I_IMPORT` | `square_and_arrow_down` | 导入（往托盘落的箭头） | `tray-arrow-down` / `import` |
| `I_FOLDER` | `folder` | 本地音乐 | `folder-outline` |
| `I_CLOCK` | `clock` | 最近播放 | `clock-outline` |
| `I_CLOUD` | `cloud` | 云端音乐 | `cloud-outline` |
| `I_CLOSE` | `xmark` | 关闭 / 取消 | `close` |
| `I_CHECK_CIRCLE` | `checkmark_circle_fill` | 已选中 / 当前档 | `check-circle` |
| `I_CIRCLE` | `circle` | 未选中 | `checkbox-blank-circle-outline` |
| `I_SELECT_ALL` | `checkmark_square_on_square` | 全选 | `checkbox-multiple-marked-outline` |

### 4.6 批量操作（多选底栏）

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_ADD_SONGLIST` | `add_songlist` | 加入歌单 | `playlist-plus` |
| `I_REMOVE_SONGLIST` | `remove_songlist` | 从歌单移除 | `playlist-minus` |
| `I_LIST_PLAY` | `list_badge_play` | 加入播放列表 | `playlist-play` |

### 4.7 箭头

| 常量 | 符号 | 语义 | RN 建议 |
|---|---|---|---|
| `I_CHEVRON_RIGHT` | `chevron_right` | 右箭头（行尾） | `chevron-right` |
| `I_CHEVRON_DOWN` | `chevron_down` | 下箭头（下拉框） | `chevron-down` |
| `I_CHEVRON_LEFT` | `chevron_left` | 左箭头（返回） | `chevron-left` |

### 4.8 未在 `Icons.ets` 中定义、但源码直接使用的系统符号

| 符号 | 使用处 | 语义 | RN 建议 |
|---|---|---|---|
| `sys.symbol.rhythm` | `MiniBar.coverView` | 播放中的跳动符 | `waveform` / `chart-bar` |
| `sys.color.font_primary` | HDS 标题栏 | 系统主文字色 | `C_TEXT` |
| `sys.color.glass_material_outline_primary` | HDS 玻璃描边 | 系统玻璃描边色 | `C_GLASS_EDGE` |

### 4.9 `IconGlyph` 组件规格

| 属性 | 默认 | 说明 |
|---|---|---|
| `symbol` | — | 图标资源 |
| `iconSize` | `22` | 字号 |
| `color` | `C_ICON` | 颜色（走主题 token） |
| `weight` | `Medium` | 字重 |
| `replaceEffect` | `false` | 换图时是否走符号替换动效（播放↔暂停、收藏↔取消收藏） |

`renderingStrategy = SINGLE`（单色渲染）。

**RN 替代建议**：用 `react-native-vector-icons` 的单一组件，
`replaceEffect` 用一个 120ms 的 `Animated` opacity+scale 交叉淡入模拟。

---

## 5. 平板 / 宽屏适配规则

### 5.1 断点常量

```js
const BP_COMPACT  = 440;   // 手机
const BP_MEDIUM   = 600;   // 大屏手机 / 折叠屏折叠态 → 以上算「宽屏」
const BP_EXPANDED = 840;   // 折叠屏展开态 / 平板
```

**语义**：
- `< 440vp`：手机
- `440 – 600vp`：大屏手机 / 折叠屏折叠态
- `≥ 600vp`：折叠屏展开态 / 平板（**两条栏同时展开**，恒为中心对齐）

> 官方在 600–840vp 之间还要看高宽比（`> 0.8` 按大屏算，`< 0.8` 按中档算）。
> 本规格**不重复判断** —— 分档只用来选边距，两条栏的宽度本来就按实际可用宽度算。

### 5.2 边距算法 `barSideMarginFor(windowWidth)`

```js
function barSideMarginFor(windowWidth) {
  if (windowWidth >= 840) return 24;
  if (windowWidth >= 600) return 16;
  return 12;
}
```

### 5.3 内容列数算法 `contentColumnsFor(windowWidth)`

**用途**：列表页一屏几列（喂给 `FlatList` 的 `numColumns`）。

```js
const HOME_ROW_MIN_WIDTH = 360;
const HOME_COLUMNS_MAX   = 4;

function contentColumnsFor(windowWidth) {
  const avail = windowWidth - 32;            // 页面自己左右各留 16
  if (windowWidth < 600 || avail <= 0) return 1;
  let columns = Math.floor(avail / HOME_ROW_MIN_WIDTH);
  if (columns < 1) columns = 1;
  return Math.min(columns, HOME_COLUMNS_MAX);
}
```

**各窗口宽度下的结果**：

| windowWidth | avail | floor(avail/360) | 返回列数 |
|---|---|---|---|
| `< 600` | — | — | **1** |
| `600` | 568 | 1 | **1** |
| `720` | 688 | 1 | **1** |
| `840` | 808 | 2 | **2** |
| `1024` | 992 | 2 | **2** |
| `1280` | 1248 | 3 | **3** |
| `1440` | 1408 | 3 | **3** |
| `1600` | 1568 | 4 | **4** |
| `≥ 1800` | — | ≥ 5 | **4**（封顶） |

**哪些页面用几列**：

| 页面 | 用 `contentColumnsFor` | 说明 |
|---|---|---|
| 推荐页 `RecommendView` | ✅ | `List.lanes` |
| 歌单详情 `PlaylistDetailView` | ✅ | `List.lanes` |
| 在线详情 `OnlineListView` | ✅ | `List.lanes` |
| 搜索结果 `SearchView` → `SongListPane` | ✅ | `List.lanes` |
| 最近播放 / 本地音乐 / 云端音乐 `SongListPane` | ✅ | `List.lanes` |
| 下载管理 `DownloadListPane` | ✅ | `List.lanes` |
| 听书 `ListenView` | ✅ | `List.lanes` |
| 我的页 `MineView` | ❌ | 用 2:1 卡片并排（见 5.5） |
| 设置类页面（设置 / 外观 / 播放 / 缓存 / 下载 / 音源 / 同步 / WebDAV / 关于 / 听书设置） | ❌ | 用 `cardColumnsFor`（见 5.4） |
| 全屏播放器 `PlayerView` | ❌ | 用 `isWideWindow` 切版式（见 5.6） |

**分栏与组头的关系（重要）**：`FlatList` 的 `numColumns` 是**按条目**分的 ——
把顶部标题 / 横滑卡片 / 状态行当普通条目丢进去，它们也只占**一列**。
所以列表页统一把「头部 + 尾部」放进 `ListHeaderComponent` / `ListFooterComponent`
（对应 ArkTS 的 `ListItemGroup` 的 `header` / `footer`，分栏模式下自己占满整行）。

### 5.4 卡片列数算法 `cardColumnsFor(windowWidth)`

**用途**：设置类页面的卡片并排（**与列表页是两个口径**）。

```js
const CARD_MIN_WIDTH = 460;

function cardColumnsFor(windowWidth) {
  const avail = windowWidth - 32;
  if (windowWidth < 600 || avail < 460 * 2 + 14) return 1;   // 934
  return 2;
}

function cardWidthOf(windowWidth) {
  return cardColumnsFor(windowWidth) > 1 ? '48%' : '100%';
}
```

**结果表**：

| windowWidth | avail | 条件 | 返回 | 卡片宽度 |
|---|---|---|---|---|
| `< 600` | — | — | **1** | `100%` |
| `600 – 933` | `< 934` | 不够两列 | **1** | `100%` |
| `≥ 934` | `≥ 902` | `avail ≥ 934` 不成立？ | 见下 | — |
| `≥ 966` | `≥ 934` | `avail ≥ 934` | **2** | `48%` |

> 精确阈值：`windowWidth - 32 ≥ 460*2 + 14 = 934` ⇒ `windowWidth ≥ 966` 时为 **2 列**。

**排布方式**（RN 实现）：

```jsx
<View style={{
  flexDirection: cardsSideBySide ? 'row' : 'column',
  flexWrap: cardsSideBySide ? 'wrap' : 'nowrap',
  alignItems: 'flex-start',
  gap: 14,                        // main 与 cross 都是 14
}}>
```

- 窄屏 `flexDirection: 'column'` + `nowrap` + `gap 14`，与原 `Column({ space: 14 })` **逐像素一致**
- 宽屏 `flexDirection: 'row'` + `wrap`，每张卡 `width: '48%'`（留 4% 给列间距）
- **「卡 + 它下面那行说明」必须包在同一个 `View` 里当「一个单元」** ——
  说明文字本身铺满宽度，不包起来会把换行打断，两张卡就并不到一排去
- `alignItems: 'flex-start'`（**顶对齐**）：卡片高度差得远（一行 vs 四行），居中的话短卡会飘在半空

### 5.5 我的页的特殊排布

我的页不是「一列歌曲行」，而是三张卡 —— 宽屏下排的是**卡片的位置**：

```
if (isWideWindow(windowWidth)) {
  <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
    <View style={{ flex: 2 }}>  {playlistCard}  </View>   // 歌单卡占 2 份
    <View style={{ flex: 1 }}>  {linksCard}     </View>   // 设置卡占 1 份
  </View>
} else {
  {playlistCard}
  {linksCard}
}
```
快捷入口那一排横着铺满，不分栏。

### 5.6 底部两条栏宽度算法 `barMetricsFor(windowWidth, miniExpanded)`

**背景约束（三条互相牵制的官方规则）**：

| 规则 | 出处 |
|---|---|
| 页签数 ≥ 4 时，单条栏宽度不超过 **328vp** | `HdsBarWidthRangeOptions` 各档默认值说明 |
| `miniBarStyle` **只在 HdsTabs 宽度 < 600vp 时生效**；≥ 600vp 时迷你栏恒为展开态 | `HdsTabsMiniBar.miniBarStyle` |
| 宽度 > 600vp 且两条同时展开时，页签栏与迷你栏**整体底部居中**并排显示 | 左右布局场景说明 |

**常量**：

```js
const BAR_WIDTH_MAX      = 328;   // 单条栏宽度上限（官方硬上限）
const TAB_BAR_WIDTH_MIN  = 224;   // 页签栏下限（4 个页签 × 56）
const MINI_BAR_WIDTH_MIN = 232;   // 迷你栏展开态下限（圆封面 40 + 歌名 + 三个控制钮）
const MINI_BAR_WIDTH_RATIO = 0.5; // 迷你栏拿可用宽度的比例
const MINI_BAR_COLLAPSED = 56;    // 折叠态：一颗圆钮，宽度 = 栏高
const TAB_BAR_COLLAPSED  = 96;    // 窄屏下页签栏折叠后的宽度（估算值，宁可留宽）
const BAR_GAP            = 8;     // 两条栏之间的缝
```

**算法（可直接翻译成 JS）**：

```js
function clamp(v, min, max) {
  if (v < min) return min;
  return v > max ? max : v;
}

function isWideWindow(windowWidth) {
  return windowWidth >= 600;
}

function barMetricsFor(windowWidth, miniExpanded) {
  const sideMargin = barSideMarginFor(windowWidth);
  const avail = Math.max(0, windowWidth - sideMargin * 2);

  // 宽屏下 miniBarStyle 不生效 ⇒ 迷你栏一定展开，页签栏也保持展开
  const wide = isWideWindow(windowWidth);
  const expanded = wide || miniExpanded;

  // 迷你栏先按可用宽度的 50% 取值，收敛到 [232, 328]
  let mini = clamp(Math.round(avail * 0.5), 232, 328);

  if (expanded) {
    // 展开态旁边那条也得有位置：宽屏是展开的页签栏，窄屏是折叠的页签栏
    const otherMin = wide ? 224 : 96;
    mini = Math.min(mini, Math.max(232, avail - otherMin - 8));
  }

  const reserved = (expanded ? mini : 56) + 8;
  let tab = Math.min(328, avail - reserved);

  if (tab < 224) {
    // 窗口窄到两条都放不下（小屏手机）：页签栏保底，迷你栏让位
    tab = Math.min(328, Math.max(224, avail - reserved));
  }

  return { sideMargin, tabBarWidth: tab, miniBarWidth: mini };
}
```

**核心保证式**：
```
页签栏 + 迷你栏 + 8vp 缝 = 窗口宽 - 2 × 边距
```

**页内迷你栏宽度同步**：

```js
function publishedMiniBarWidth(windowWidth, miniExpanded) {
  if (!isWideWindow(windowWidth)) return 0;   // 窄屏给 0 ⇒ 页内那条照旧铺满
  return barMetricsFor(windowWidth, miniExpanded).miniBarWidth;
}

function miniBarWidthOrUnbounded(published) {
  return published > 0 ? published : 100000;   // LAYOUT_UNBOUNDED
}
```

壳层在窗口尺寸变化时（旋转 / 折叠屏展开折叠 / 平板分屏 / 自由窗口拖拽）
重算一次并写进共享状态（`K_BAR_MINI_WIDTH` / `K_WINDOW_WIDTH`），订阅者自己重排。

**计算示例**：

| windowWidth | sideMargin | avail | mini（折叠） | tab（折叠） | mini（展开） | tab（展开） |
|---|---|---|---|---|---|---|
| `360` | 12 | 336 | 232 | 96 | 232 | 96 |
| `440` | 12 | 416 | 232 | 176→224（保底） | 232 | 176→224 |
| `600` | 16 | 568 | — | — | 284 | 276 |
| `720` | 16 | 688 | — | — | 328 | 328（≤328） |
| `840` | 24 | 792 | — | — | 328 | 328 |
| `1024` | 24 | 976 | — | — | 328 | 328 |
| `1440` | 24 | 1392 | — | — | 328 | 328 |

> 宽屏下两条栏恒为中心对齐、并排显示，页签栏与迷你栏都封在 328vp。

**页签栏分档槽位（HDS 用）**：

| 档位 | 值 |
|---|---|
| `smallWidth` | `windowWidth - 96`；窗口宽为 0 时兜底 `264` |
| `mediumWidth` | `72 × 可见页签数` |
| `largeWidth` | `80 × 可见页签数` |

**三个分档槽位给同一个值是故意的**（页内迷你栏那条）：值本身已按当前窗口算好，
系统挑中哪一档都用它，不会出现「按 A 档算、用 B 档渲染」。

### 5.7 表单限宽 `CONTENT_MAX_WIDTH`

```js
const CONTENT_MAX_WIDTH = 720;
const LAYOUT_UNBOUNDED  = 100000;
```

**用途**：详情页 / 设置页里**表单类**内容的最大宽度（输入框、按钮、说明文字）。
列表可以多列，表单不行 —— 窗口宽到 1400vp 还把输入框拉满，就是一条又长又扁的带子、
两个按钮各占半个屏幕。

**应用点**：
- `SearchView` 的搜索栏与三屏内容：`maxWidth = columns > 1 ? 720 : LAYOUT_UNBOUNDED`
  （`columns = contentColumnsFor(windowWidth)`）
- 各设置页的卡片走 `cardWidthOf`（48%），而不是 720 限宽
- **整页不再收窄**：页面本身铺满窗口，多列由各页自己排

### 5.8 全屏播放器的宽屏版式

```js
function wide() { return isWideWindow(windowWidth); }   // >= 600
```

| | 窄屏（`< 600`） | 宽屏（`≥ 600`） |
|---|---|---|
| 版式 | `Swiper` 双页横滑（封面页 ↔ 歌词页） | 左右并排：左封面 + 全部控件，右整栏歌词 |
| 页码指示 | 显示 | **不显示** |
| 封面页小歌词 | 显示（开关打开时） | **不显示**（右边整栏就是歌词） |
| 歌词页 | Swiper 第 2 页 | 右栏常驻 |
| 封面尺寸 | `252`（受封面区高度收缩） | `max(252, min(300, windowWidth*0.2))`，再按半栏宽度与封面区高度收缩 |
| 切页动画 | `duration 280, Curve.Friction` | — |
| 歌词对齐 | 滑到歌词页后（`onAnimationEnd`）对齐一次 | 进页面时对齐一次（延迟 80ms 补一次） |
| 歌词页不熄屏 | 仅当停在歌词页（`pageIndex === 1`） | 恒为真（等于一直在歌词页） |

### 5.9 模块声明

`module.json5` 的 `deviceTypes` **必须补上 `tablet`**：不声明的话平板上只能跑手机的
兼容模式，整屏被拉伸放大，字发虚、控件比例也不对。

---

## 6. 玻璃 / 材质层的降级策略

### 6.1 三层叠加与生效条件

| 层 | 接口 | API 门槛 | 生效条件 | 作用 |
|---|---|---|---|---|
| **① 系统沉浸材质** | `uiMaterial.ImmersiveMaterial` + 组件 `.systemMaterial()` | **API 26（鸿蒙7）** | `harmony7ApiReady()` **且** `isGlassMaterialSupported()`（设备能力位）**且** 组件在**生效范围内** | 折射、随底下内容提亮、按压形变（`interactive: true`）、光感反馈（`lightEffect`） |
| **② HDS 光效（着色器）** | `hdsEffect` 的 `DUAL_EDGE_FLOW_LIGHT` / `UV_BACKGROUND_FLOW_LIGHT` | **API 12 起**（`visualEffect` 通用属性） | `hdsEffectSupported()`（能力位 `SystemCapability.UIDesign.HDSComponent.Core`） | 轮廓流光（播放钮）、整片背景流光（首页，本工程已去掉） |
| **③ HDS 轮廓点光** | `hdsEffect.HdsEffectBuilder().pointLight(...)` | **API 20（鸿蒙6）起** | `hdsEffectSupported()` **且** 材质**不可用** | 给悬浮控件边沿加一圈光（鸿蒙6 的「普通光效」） |
| **④ 自绘兜底** | 毛玻璃模糊 + 半透明白底 + 1vp 描边 + 可选轻阴影 | 全版本 | **总是先画**（材质生效时会被接管） | 材质不可用时它是唯一的底色层 |

### 6.2 `harmony7ApiReady()` 判定

```js
const IMMERSIVE_API = 26;
const HARMONY7_DISTRIBUTION_VERSION = 70000;

function harmony7ApiReady() {
  return apiAtLeast(26) && distributionApiAtLeast(70000);
  // apiAtLeast: deviceInfo.sdkApiVersion >= level（取不到 → false）
  // distributionApiAtLeast: deviceInfo.distributionOSApiVersion >= level（取不到 → false）
}
```

**为什么两个条件都要求成立**：判断错了的后果**不对称** ——
判成 `false` 只是观感退回老一套（自绘玻璃 + 轮廓点光）；
判成 `true` 而机器其实是鸿蒙6 就是**直接闪退**（`uiMaterial` 命名空间本身不存在）。
所以取保守的一侧：**任一取不到、或任一没到鸿蒙7，都走回退那条路**。

**版本号编码**：`6.1.0 = 60100`、`7.0.0 = 70000`（M.S.F 编码）。

**`probe()` 必须先判版本再去碰 `uiMaterial`**：早期版本直接
`try { uiMaterial.isImmersiveMaterialSupported() } catch`，虽然不崩，
但等于每次启动都拿异常当探测用，低版本上还白抛一次。

### 6.3 沉浸光感的**生效范围**（关键约束）

`systemMaterial` 虽然是 API 26 起的通用属性、任何组件都能挂，但官方「沉浸光感」约束写明：

> 除**弹窗类组件 / 弹窗类接口 / Slider、Toggle、Select** 可在全页面生效外，
> **其他组件仅在 Navigation/NavDestination 标题栏，或横向 Tabs 的底部 TabBar 中生效**。

画在页面内容区里的普通组件设了也不生效，运行时会打印：
```
Material inactive: out of scope. Use component in navigation title bar or Tabbar.
```

**本工程把页头搬进标题栏的原因就在这** —— 圆钮与来源胶囊必须落在标题栏里才吃得到材质。

**另一个硬约束**：**同一节点上不能再叠自绘玻璃**。官方 FAQ 写明沉浸光感的视觉层级
位于 `backgroundColor` / `backgroundBlurStyle` **之下**，自己画一层半透明底或毛玻璃
就会把材质整片盖住。所以 `materialFirstGlass` 与 `thinGlass` 是**二选一**，不能叠加。

### 6.4 材质档位映射

**档位取值**：`0 跟随系统 / 1 弱 / 2 均衡 / 3 强`（`MATERIAL_LEVEL_LABELS = ['跟随系统','弱','均衡','强']`）。

**① 悬浮控件那一族**（圆钮、来源胶囊、迷你栏这种小面积表层）→ `immersiveStyleOf(level)`：

| 档位 | `ImmersiveStyle` |
|---|---|
| `1` 弱 | `ULTRA_THIN` |
| `2` 均衡 | `THIN` |
| `3` 强 | `REGULAR` |
| `0` 跟随系统 | 低算力（`globalMaterialLevel === SMOOTH`）→ `ULTRA_THIN`；否则 → `THIN` |

> **实机更正（Mate 70 Pro / 鸿蒙7 / `globalMaterialLevel = EXQUISITE`）**：
> 早先「跟随系统」是按算力往上顶到 `ULTRA_THICK`。那是弹窗档（「完全模糊背景」），
> 落在一颗 40vp 的圆钮上就成了一块发亮发白的实心牌子。
> 现在这一族整体压薄，「跟随系统」落到 `THIN`。

**② 弹窗类表面**（半模态）→ `dialogStyleOf(level)`：

| 档位 | 结果 |
|---|---|
| `1` 弱 | `THIN` → 抬到 **`THICK`** |
| `2` 均衡 | `REGULAR` → 抬到 **`THICK`** |
| `3` 强 | `REGULAR`（`immersiveStyleOf(3)`）→ `THICK` |
| `0` 跟随系统 | `THIN` → 抬到 **`THICK`** |

**下限抬到 `THICK`**：官方对弹窗类要求「较厚的材质样式（THICK 或 ULTRA_THICK）以获得更强的
背景模糊效果」。而「弱」档在悬浮控件上落成 `THIN` —— 放在一整块半模态上太薄了，
背后的内容会直接透上来。

**③ 悬浮栏**（底部迷你播放条那条胶囊）→ `barStyleOf(level)`：

| 档位 | `ImmersiveStyle` |
|---|---|
| `1` 弱 | `THIN` |
| `2` 均衡 | `REGULAR` |
| `3` 强 | `THICK` |
| `0` 跟随系统 | `REGULAR` |

> 一条 56vp 高、横贯屏幕的栏，面积比圆钮大一个量级，用圆钮那套超薄档会「看不出有材质」，
> 所以整体比 `immersiveStyleOf` 厚一档；「强」也只到 `THICK` ——
> `ULTRA_THICK` 是「完全模糊背景的弹窗」档，压在一条栏上就是一块实心板。

**HDS 系统材质参数**（标题栏 / 底部页签栏 / 半模态三处共用）→ `buildTitleMaterial(level)`：

| 档位 | `MaterialType` | `MaterialLevel` |
|---|---|---|
| `0` 跟随系统 | `IMMERSIVE` | `ADAPTIVE` |
| `1` 弱 | `IMMERSIVE` | `SMOOTH` |
| `2` 均衡 | `IMMERSIVE` | `GENTLE` |
| `3` 强 | `IMMERSIVE` | `EXQUISITE` |

**自绘玻璃层的模糊厚度** → `buildGlassBlur(level)`：

| 档位 | `BlurStyle` |
|---|---|
| `1` 弱 | `COMPONENT_THIN` |
| `2` 均衡 | `COMPONENT_REGULAR` |
| `0` 跟随系统 / `3` 强 | `COMPONENT_ULTRA_THICK` |

> 自绘层没有「系统的档位」可跟，直接给最厚 —— 底部悬浮页签栏就是最厚那一档的观感。
> `3 强` 与 `0` 都落在最厚一档，因为 `ULTRA_THICK` 已经是最厚，再往上没有了。

**材质档位的响应式**：宿主组件订阅 `K_MATERIAL_LEVEL`，在渲染时按当前值取玻璃 ——
改档位时所有玻璃层一起变厚变薄（与派音「一个 `AmbientState` 驱动全应用玻璃厚度」同一做法）。

### 6.5 轮廓点光的取值

| 参数 | 值 | 说明 |
|---|---|---|
| `sourceType` | `SOFT` | 柔光 |
| `illuminatedType` | `BORDER` | **只照亮轮廓**（边沿「立」起来，而不是整块发亮成霓虹灯） |
| `color` | `C_RED` | 品牌红 |
| `intensity` | `1` | 默认值是 `0`（等于不亮），**必须显式给** |
| `height` | `12` | 光晕范围 |
| `bloom` | `0.3` | 泛光 |

### 6.6 `glassLight()` 的「永远挂一层」策略

**问题**：ArkUI 的链式属性没法按运行时的条件把 `.visualEffect()` 这一行摘掉，
而它的参数又不是可选的。**别把它塞进 `AttributeModifier`** ——
两份官方文档在这一点上打架（《属性修改器》把它列进「不支持 attributeModifier 的范围」，
《视效设置》说 API 20 起支持在 attributeModifier 中调用），**有分歧就别赌**。

**做法**：**永远挂一层**，按能力返回不同效果。

```js
function glassLight() {
  if (isGlassMaterialSupported() || !hdsEffectSupported()) {
    return EMPTY_EFFECT;      // 鸿蒙7（材质自己在发光）或连 HDS 能力位都没有
  }
  return hdsPointLight(C_RED) ?? EMPTY_EFFECT;
}
```

| 平台 | 这一层的内容 | 结果 |
|---|---|---|
| 鸿蒙7 + 材质可用 | 空效果（不往里加任何东西） | 光感由沉浸材质的 `lightEffect` 出，不叠第二遍 |
| 鸿蒙7 + 无材质能力位 | HDS 轮廓点光 | 补回光感 |
| 鸿蒙6（API 23） | HDS 轮廓点光（API 20 起就有，**全量支持**） | 唯一的光源 |
| 无 HDS 能力位 | 空效果 | 什么都没有 |

**挂法**：`.visualEffect(glassLight())`，**与 `.systemMaterial()` 成对出现**。

**走这一套的控件**：顶栏圆钮（搜索 / 听书识曲）、两个下拉框、搜索框、提示条。

### 6.7 页内迷你栏的两条路

| 平台 | 做法 |
|---|---|
| **鸿蒙7** | `Tabs` + `.barFloatingStyle({ systemMaterial })` —— 胶囊的圆角、边距、位置、材质全由框架画，页面只提供栏里的内容。**别往栏里再叠自绘玻璃** |
| **鸿蒙6** | `barFloatingStyle` 不存在，退回 `fallbackMiniBar()`：自绘一条胶囊（几何与鸿蒙7 那条同一口径），表面是**自绘玻璃 + 轮廓点光** |

**鸿蒙6 的 `fallbackMiniBar()` 结构**：
```
Column, width: '100%'
padding { left: barSideMarginFor(ww), right: barSideMarginFor(ww), bottom: bottomInset + 10 }
└── Row, width: (宽屏 ? K_BAR_MINI_WIDTH : '100%'), height: 56
    圆角 = 28（HDS_BAR_HEIGHT / 2）
    玻璃 = thinGlass(28)
    边沿光 = glassLight()
    clip: true
```

**页面结构上，主体一律抽成 `pageBody()`**，`build()` 里只按版本包一层 `if (harmony7ApiReady())` ——
主体两种系统完全一样，不复制成两份。

### 6.8 ⭐ 没有系统材质能力时，视觉上应该退化成什么（明确结论）

**结论：退化成「半透明白底 + 1px 白描边 + 圆角」，再加一圈 HDS 轮廓点光；不要阴影。**

#### 6.8.1 精确配方（可直接写进 RN 样式）

```js
// 悬浮控件那一族（圆钮 / 下拉胶囊 / 搜索框 / 迷你栏 / 提示条）
const glassFallback = {
  backgroundColor: '#FFFFFF1A',      // C_GLASS_FILL（亮色）；暗色也用 #FFFFFF1F
  borderWidth: 1,
  borderColor: '#FFFFFF',            // C_GLASS_EDGE（亮色）；暗色 #FFFFFF66
  // 圆角按控件：圆钮 = boxSize/2，胶囊 = 高度/2，卡片 = 16
  // 不要加 shadow
};

// 中等厚度那一档（卡片式浮层）
const glassTint = { backgroundColor: '#FFFFFFBD' };   // C_GLASS_TINT；暗色 #26262AC2

// 提示条那种要保证文字可读的更实一档
const glassSolid = { backgroundColor: '#FFFFFFD1' };  // C_GLASS_SOLID；暗色 #242428E1
```

#### 6.8.2 为什么是这样（「派音配方」）

把参考实现（派音）的源码逐行读完之后，结论和「加阴影 + 加高光边」是**反的**：

- 它的顶栏圆钮**根本不用玻璃、不用材质、不用光效**：就三个属性 ——
  `backgroundColor: '#1AFFFFFF'`（10% 白）+ `borderWidth: 1` + `borderColor: '#FFFFFF'`（纯白 1px 描边），
  `40×40 / borderRadius 20`。暗色下换成 `#19FFFFFF` / `#66FFFFFF`。
  **全项目没有一处 `shadow()`。**
- 玻璃只出现在**大面**上（迷你栏、hero 上的按钮）：`backgroundBlurStyle(BACKGROUND_THICK)` + `#26ffffff` 描边。

**玻璃感来自「透出背后的内容」这一件事**：底子给得越淡，背后的东西透得越多，越像玻璃；
**加阴影、加高光边、把底调厚，反而会变成一块实心白牌子** —— 这就是「粗糙」的来源。

#### 6.8.3 降级矩阵（RN 实现直接照抄）

| 能力 | 系统材质层 | 轮廓点光层 | 自绘兜底层 | 最终观感 |
|---|---|---|---|---|
| 鸿蒙7 + 材质可用 + 在生效范围内 | ✅ 渲染 | 空效果 | 不画（`materialFirst`） | 真材质（折射 / 提亮 / 按压形变 / 光感） |
| 鸿蒙7 + 材质可用 + **不在**生效范围 | ❌ 不渲染 | 空效果 | ✅ 画 | 自绘玻璃（无光感） |
| 鸿蒙7 + 无材质能力位 | ❌ | ✅ 轮廓点光 | ✅ 画 | 自绘玻璃 + 边沿一圈光 |
| 鸿蒙6（API 23） | ❌ 接口不存在 | ✅ 轮廓点光 | ✅ 画 | **自绘玻璃 + 边沿一圈光** ← 主降级目标 |
| 无 HDS 能力位 | ❌ | 空效果 | ✅ 画 | **纯自绘玻璃**（半透明白 + 1px 白描边 + 圆角） |
| RN（Android / iOS） | — | — | — | **同上：半透明白底 + 1px 白描边 + 圆角**，可选加 `BlurView` |

#### 6.8.4 RN 侧的具体做法

```jsx
// 推荐：用 expo-blur / @react-native-community/blur 模拟毛玻璃，叠加半透明白底与描边
<BlurView
  intensity={blurIntensityFor(materialLevel)}   // 见下表
  tint="light"                                  // 暗色模式用 "dark"
  style={{
    borderRadius: radius,
    borderWidth: 1,
    borderColor: isDark ? '#FFFFFF66' : '#FFFFFF',
    backgroundColor: isDark ? '#FFFFFF1F' : '#FFFFFF1A',
    overflow: 'hidden',
  }}
/>
```

**模糊强度档位映射（`buildGlassBlur` 的 RN 近似值）**：

| 档位 | ArkTS `BlurStyle` | RN `intensity` 建议 |
|---|---|---|
| `1` 弱 | `COMPONENT_THIN` | `20` |
| `2` 均衡 | `COMPONENT_REGULAR` | `40` |
| `0` 跟随系统 | `COMPONENT_ULTRA_THICK` | `70` |
| `3` 强 | `COMPONENT_ULTRA_THICK` | `70` |

> 若目标平台不支持实时模糊（Android 低端机 / 性能敏感场景），
> **只保留「半透明白底 + 1px 白描边 + 圆角」**，观感仍然成立 ——
> 这正是派音那颗圆钮的做法（它连模糊都没有）。

**「边沿那圈光」在 RN 里怎么近似**：
- 用 `react-native-linear-gradient` 在容器内叠一层从 `#FFFFFF66` 到透明的
  1px 内描边（`borderWidth: 1` + `borderColor` 已能表达大部分观感）
- 或用 `react-native-shadow-2` 加一个**极淡的白色外发光**（`#FFFFFF33`，`radius 12`）
  —— 注意**只在需要「立起来」的悬浮控件上加**，卡片一律不加

**不要做的事（会毁掉玻璃感）**：
1. ❌ 不要给悬浮控件加黑色投影（会变成实心白牌子）
2. ❌ 不要把底色调厚（`#FFFFFFBD` 只用于卡片式浮层，不用于圆钮）
3. ❌ 不要在已经挂了系统材质的节点上再叠自绘玻璃（材质层级在 `backgroundColor` 之下，会被盖住）
4. ❌ 不要在 `Tabs.barFloatingStyle` 的栏里再叠自绘玻璃（同上）

### 6.9 版本红线（踩过闪退的）

本工程 `compatibleSdkVersion = 6.1.0(23)`，也就是**鸿蒙6 必须能跑**。
下面这一批全是 API 26 专有、鸿蒙6 上**根本不存在**的接口：

| 接口 | 在哪儿 |
|---|---|
| `uiMaterial` 命名空间 / `ImmersiveStyle` / `ImmersiveMaterial` | `ui/Glass.ets` |
| 组件的 `.systemMaterial()` | 圆钮、下拉框、搜索框、提示条 |
| **`Tabs.barFloatingStyle` + `FloatingTabBarStyle` / `FloatingTabBarWidth`** | 歌单详情 / 在线详情 / 四个面板页（`PanePage`） |
| `SheetOptions.systemMaterial` | 半模态（半模态是弹窗类，全页面可用） |

编译器对这些调用**只给警告（不是错误）**，构建照样过，坑全留在运行时。
**实测的现场是「主页能开，点进歌单就闪退」**：主页那条底部栏走的是 HDS 的
`HdsTabs.barFloatingStyle`（API 18 起，低版本也有），而三个子页面走的是 ArkUI 原生的
`Tabs.barFloatingStyle`（API 26），低版本上这个方法不存在，一进页面就崩。

**每一个鸿蒙7 调用点都必须自己守**：
- 属性 / 组件层面 → `harmony7ApiReady()`
- 材质对象层面 → `isGlassMaterialSupported()`（多一道设备能力位）

**RN 侧无需这层守卫** —— 但要知道：**上面这套「降级后的观感」就是 RN 上应该直接实现的观感**。

### 6.10 模拟器说明

官方文档明确列出：模拟器不支持 HDS 沉浸视效（点光源效果、按压阴影、双边边缘流光、
背景流光、自带背景的双边边缘流光、沉浸光感材质）。

但**代码不因为模拟器就把能力关掉**：`hdsEffectSupported()` 只看能力位
（`canIUse('SystemCapability.UIDesign.HDSComponent.Core')`），能不能画出来交给平台。
早先那版额外做了「模拟器就整层跳过」，结果是哪里都没有效果，设置页还把原因写成
「当前设备不支持」，对不上问题。现在「设置 - 外观」底部会把能力位 / 材质类型 /
是否模拟器如实写出来，方便对不上时定位。

---

## 7. 动效

### 7.1 动效总表

| 动效 | 位置 | 时长 / 参数 | 缓动 |
|---|---|---|---|
| **封面弹簧** | 全屏播放器封面，播放/暂停时 | 见 7.2 | 阻尼弹簧（`stiffness 220` / `damping 13`） |
| **符号替换动效** | 播放↔暂停、收藏↔取消收藏 | 系统默认 | 系统 `ReplaceSymbolEffect(LAYER)` |
| **页面切换（播放器双页）** | Swiper | `280ms` | `Curve.Friction` |
| **页码指示过渡** | 播放器页码点 | `200ms` | `Curve.EaseInOut` |
| **歌词行高亮** | 歌词行颜色 / 字重 | `240ms` | `Curve.EaseInOut` |
| **歌词滚动** | `scrollToIndex(CENTER)` | 系统默认 | — |
| **进度条增长** | 已播段 / 缓冲段 | `260ms` | `Curve.Linear` |
| **自绘底部面板上滑** | 「更多」/ 音质面板 | `240ms`，`translate({ y: 320 })` | `Curve.Friction` |
| **提示条进出** | Toast | `200ms` | OPACITY 过渡 |
| **提示条停留** | Toast | `3200ms` 后消失 | — |
| **分段胶囊切换** | `SegPills` / `CapsuleSegment` | `200ms` | `Curve.EaseInOut` |
| **删除粒子飘散** | 全局 DustLayer | `760ms`（粒子寿命 `620ms`） | 见 7.3 |
| **轮廓流光（播放钮）** | `HdsEdgeFlowLight` | `10000ms` 一圈，`iterations: -1`（无限） | 着色器自驱 |
| **首页背景流光** | 已从本工程移除 | `10000ms` 一圈 | — |
| **按压态** | 各列表行 / 设置行 / 圆钮 | 系统 `stateEffect` | — |
| **「已复制」反馈** | 关于页群号 | `1800ms` 后复原 | — |

### 7.2 封面弹簧（详细）

**触发**：播放状态变化时（`onStatusChanged`），目标值 = `playing ? 1.05 : 0.95`。

**算法**（16ms 一帧做数值积分）：

```js
const STIFFNESS = 220;
const DAMPING   = 13;
const FRAME_MS  = 16;

function startCoverSpring() {
  if (timer) return;
  lastMs = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    // 卡顿掉帧时限制单帧步长，否则数值积分会发散（画面直接跳飞）
    const dt = Math.min(32, now - lastMs) / 1000;
    lastMs = now;
    const acc = (target - scale) * 220 - velocity * 13;
    velocity += acc * dt;
    scale    += velocity * dt;
    if (Math.abs(target - scale) < 0.0005 && Math.abs(velocity) < 0.0005) {
      scale = target;
      velocity = 0;
      stopCoverSpring();
    }
  }, 16);
}
```

**参数要点**：
- `stiffness 220` / `damping 13` → 约 **12% 过冲**、**0.5 秒收住**
- **单帧步长上限 32ms**（防数值积分发散）
- 吸附阈值：位移与速度都 `< 0.0005` 时直接吸附到目标值并停表（避免定时器常驻）
- **缩放中心放在封面正中**（`centerX/centerY: '50%'`），不要从左上角放大
- 打开播放器时若正在播就直接是放大的样子，**不要从 1 弹一下**（那是给「切播放状态」用的）

**RN 实现**：用 `Animated.spring` 近似：

```js
Animated.spring(scale, {
  toValue: playing ? 1.05 : 0.95,
  stiffness: 220,
  damping: 13,
  useNativeDriver: true,
}).start();
```
> RN 的 `Animated.spring` 也是阻尼弹簧，参数语义一致，可直接迁移；
> 若要求逐帧一致（含 12% 过冲），可用上面的手写积分 + `requestAnimationFrame`。

### 7.3 删除粒子飘散 Dust

**触发**：任何页面删除时调 `dustBus.spray(x, y)`，粒子在**全局唯一的一层**（`DustLayer`，挂在壳层最外层）散开。
坐标用 **window 坐标**（`touch.windowX` / `touch.windowY`）——
窗口可能不在屏幕左上角（分屏、自由窗口下 display 坐标会整体偏移）。

**可用性**：`dustSupported()` 只看能力位 `SystemCapability.ArkUI.ArkUI.Full`，
缺失时**静默不做**这个效果（不是报错）。

**参数**：

| 参数 | 值 |
|---|---|
| 一次飘散总时长 | `760ms`（`DUST_MS`） |
| 粒子类型 | `POINT` |
| 粒子半径 | `2.2` |
| 粒子数 | `18` |
| 粒子寿命 | `620ms`（`lifetimeRange 180`） |
| 发射速率 | `120`（覆盖层只显示 760ms，看起来是「撒了一把」而不是持续冒） |
| 发射形状 | `RECTANGLE`，尺寸 `[12, 12]` |
| 颜色范围 | `['#E33B3B', '#FFB08A']`（**字面量，不走主题 token**） |
| 不透明度 | `1.0 → 0.0` |
| 缩放 | `1.0 → 0.25` |
| 速度 | `40 – 220`，角度 `0 – 360`（全向飞散） |
| 自旋 | `-120 – 120` |
| 点击穿透 | `HitTestMode.None`（不拦任何交互） |

**连续删除的处理**：从 `false` 翻到 `true` 会把粒子层重新挂上去，等于重新起一波；
连续删除（上一波还没散完）只是改位置，剩下的存活期里粒子就在新位置冒。

**触发点（会撒粒子的地方）**：
- 删除歌单（`MineView.removePlaylist`）
- 从歌单中删除 / 批量删除（`PlaylistDetailView`）
- 移出播放列表（`PlayQueueSheet.deleteAt`）
- 删除不喜欢的规则（`SyncSettingsView.removeDislikeRule`）

**RN 实现建议**：用 `react-native-reanimated` 做 18 个绝对定位的小圆点，
每个随机角度 + 随机速度 + 随机自旋，`760ms` 后整层卸载；
或用一个 `Lottie` 粒子动画。

### 7.4 按压态

| 位置 | 实现 |
|---|---|
| 快捷入口（我的页） | `stateStyles`: normal 透明 / pressed `C_PRESSED` |
| 歌单卡动作区 | 同上 |
| 设置行 / 链接行 | 同上 |
| 同步方式选项行 | 同上 |
| 关于页仓库行 / 反馈卡 | 同上（反馈卡 normal 为 `C_CARD`） |
| 圆钮（`RoundIconButton`） | 官方 `Button(stateEffect: true)` |
| 系统组件（Switch / Slider / Button） | 平台自带 |

`C_PRESSED` 亮色 = `#40404414`，暗色 = `#FFFFFF1F`。

**RN 实现**：`Pressable` 的 `style={({ pressed }) => ...}` 或 `TouchableOpacity` +
自定义 `android_ripple` / `activeOpacity`。

### 7.5 页面切换

**全屏播放器弹出 / 收起**：系统半模态自带动效（从下往上弹、顶边停在状态栏下方）。
`bindSheet` 的 `isShow` 双向绑定，下滑或点关闭钮时状态位自动收回。

**播放器内双页切换（窄屏）**：
```js
Swiper: duration 280, curve Curve.Friction, loop false, indicator false
```
页码指示同步：`animation { duration: 200, curve: Curve.EaseInOut }`。

**子页面路由**：`HdsNavigation` + `HdsNavDestination` 提供系统级转场
（RN 用 `@react-navigation/native-stack` 的默认转场即可）。

**列表滚动性能**：
- `List.cachedCount(3)`（`SongListPane`）—— 多缓存几屏，快速滑动时不至于白屏
- 封面懒解析：解析好一批就把版本号 +1，订阅它的列表重画一次（封面陆续出现）

### 7.6 无障碍动效开关

**符号替换动效默认关**：`IconGlyph.replaceEffect` 默认 `false` ——
列表里成百上千个图标不应该各自带着动效。
只在**成对图标**上开：播放↔暂停、收藏↔取消收藏。

**RN 实现**：`replaceEffect` 用一个 120ms 的 opacity 交叉淡入即可。

---

## 8. 实现检查清单（照着写代码时逐条核对）

- [ ] 所有色值用 `#RRGGBBAA`（**不是** `#AARRGGBB`），已从第 3 章表格取值
- [ ] 深浅两套色板都实现，跟随系统 + 手动覆盖
- [ ] 底部悬浮胶囊：高 56、圆角 28、离底 `max(16, 手势条)`、左右边距 12/16/24
- [ ] 迷你栏：折叠 56 圆封面 / 展开 44 封面 + 歌名歌手 + 三个 24px 控制钮
- [ ] 迷你栏手势：上滑 `offsetY < -10` 打开播放器
- [ ] 全屏播放器：半模态（顶部留缝）、深色封面模糊背景、双页横滑 / 宽屏左右并排
- [ ] 播放器封面弹簧：`stiffness 220` / `damping 13` / 16ms 积分 / 单帧上限 32ms
- [ ] 播放器关闭手势：`offsetY > 70`，面板打开时禁用
- [ ] 进度条三段（底 / 缓冲 / 已播），`260ms Linear` 动画
- [ ] 播放控制五等分（模式 / 上一首 / 播放 / 下一首 / 列表），每格高 84
- [ ] 底部功能四等分（投播 / 评论 / 下载 / 更多），每格高 44
- [ ] 推荐页：榜单横滑卡（高 212、宽 180/216）+ 推荐歌单列表（行高 78）
- [ ] 推荐页分栏：`numColumns = contentColumnsFor(ww)`，头尾放 `ListHeader/FooterComponent`
- [ ] 我的页：快捷入口 5 个等分（图标底 44 圆角 15）+ 歌单卡 + 设置卡
- [ ] 我的页宽屏：歌单卡 : 设置卡 = 2 : 1
- [ ] 搜索页三屏切换（历史+热搜 / 联想 / 结果），联想防抖 250ms
- [ ] 搜索结果行带平台标签（品牌色胶囊，字号 10.5）
- [ ] 歌单详情 / 在线详情：封面头 + 播放全部 + 歌曲列表 + 页内迷你栏
- [ ] 多选：长按进，顶栏换「取消 + 已选中 N 项 + 全选」，底栏换批量操作条
- [ ] 多选底栏：最多 6 项等分，主操作红字放最后，长文案换短写
- [ ] 设置页：`cardColumnsFor` 分栏，卡片宽 48%，卡 + 说明包成一个单元
- [ ] 设置行：高 63（主页）/ 高 46（子页开关与滑块）
- [ ] 表单限宽 720（搜索栏等），列表页铺满
- [ ] 玻璃降级：半透明白底 + 1px 白描边 + 圆角，**不加阴影**
- [ ] 提示条：`maxWidth 86%`、圆角 18、离底 `bottomInset + 92`、3200ms 消失
- [ ] 删除粒子：18 颗、`760ms`、色 `#E33B3B → #FFB08A`、全向飞散
- [ ] 列表 `FlatList` 的 `cachedCount` / `windowSize` 给足，快速滑动不白屏
- [ ] 内容让位：页签页用 `contentStartOffset`（内容能滚进标题栏底下）；
      子页面头部常驻控件用固定顶部占位（`height = topInset`）
- [ ] 标题栏纯透明 + 顶栏渐隐（`fadeHeight = topInset + 10`）
- [ ] 宽屏断点：440 / 600 / 840；`< 600` 一律单列

---

## 附录 A：AppStorage 键名对照（状态管理用）

| 键名 | 类型 | 用途 |
|---|---|---|
| `cfg_material_level` | number | 玻璃材质档位 0–3 |
| `cfg_cover_radius` | number | 播放页封面圆角 0–40 |
| `cfg_color_mode` | number | 深浅模式 0–2 |
| `cfg_play_quality` | string | 播放音质 |
| `cfg_extend_quality` | boolean | 拓展音质开关 |
| `cfg_extend_quality_type` | string | 拓展音质档位 |
| `cfg_play_with_others` | boolean | 与其他应用同时播放 |
| `cfg_show_mini_lyric` | boolean | 播放页显示小歌词 |
| `cfg_lyric_blur` | boolean | 歌词页模糊效果 |
| `cfg_lyric_centered` | boolean | 歌词居中显示 |
| `cfg_lyric_font_size` | number | 歌词字号 13–30 |
| `cfg_lyric_keep_screen` | boolean | 歌词页不熄屏 |
| `cfg_desktop_lyric` | boolean | 桌面歌词 |
| `cfg_bluetooth_lyric` | boolean | 车载蓝牙歌词 |
| `cfg_auto_match_lyric` | boolean | 本地 / 云端自动匹配歌词 |
| `cfg_auto_resume_after_interrupt` | boolean | 被打断后自动重播 |
| `cfg_audio_effect` | boolean | 音效增强 |
| `select_bar_active` | boolean | 多选进行中 |
| `select_bar_count` | number | 已勾选条数 |
| `select_bar_all` | boolean | 是否已全选 |
| `layout_window_width` | number | 窗口宽度（vp） |
| `layout_bar_mini_width` | number | 页内迷你栏宽度（0 = 窄屏铺满） |
| `cfg_hide_listen_tab` | boolean | 隐藏「听书」页签 |
| `cfg_recommend_source` | string | 推荐来源平台 |

---

## 附录 B：关键文案速查（可直接复制的 UI 字符串）

**底部页签**：`推荐` / `听书` / `我的`

**推荐页**：`在线榜单` / `在线排行榜` / `推荐歌单` / `正在加载更多…` / `没有更多了` /
`上拉加载更多` / `点击重试` / `这个来源暂时没有推荐内容` / `正在加载${平台}的推荐…`

**我的页**：`本地音乐` / `最近播放` / `收藏` / `下载管理` / `云端音乐` /
`自建歌单` / `收藏歌单` / `新建歌单` / `歌单导入` / `设置` / `帮助和反馈` /
`还没有歌单，点上面的「新建歌单」建一个，或者用「歌单导入」粘贴一张分享链接` /
`还没有收藏的歌单` / `在推荐页点开一张歌单，点里面的「收藏歌单」就会收进来`

**搜索页**：`搜索历史` / `热门搜索` / `联想搜索` / `搜索结果` / `歌名 / 歌手` /
`搜索` / `搜索中` / `全部平台` / `正在联想…` / `按回车或点「搜索」搜「X」` /
`搜一首歌试试` / `没有搜到结果` / `没有搜到「X」` / `五个平台都没搜通，检查一下网络` /
`共 N 首 —— 酷我 30 · 酷狗 失败 · …`

**播放器**：`播放音质` / `当前：128K` / `播放` / `暂停` / `上一首` / `下一首` /
`播放列表` / `查看评论` / `下载这首歌` / `更多` / `投播至` /
`播放` / `添加到播放列表` / `添加到下一个播放` / `查看评论` / `匹配歌词` / `取消` /
`暂无歌词` / `先点一首歌` / `正在加载歌词…` / `音源和内置平台都没取到这首的歌词` /
`这是本机上的音频文件，音质由文件本身决定，没法切换。` /
`这是云端服务器上的音频文件，音质由文件本身决定，没法切换。` /
`这首歌只有 X 一档可选。` / `这首歌没有可切换的音质档（音源可能没给出这首歌的音质列表）。`

**歌单详情 / 在线详情**：`播放全部` / `收藏歌单` / `已收藏` /
`这个歌单还没有歌曲` / `可以在洛雪桌面端 / 移动端把歌加进来，同步后就会出现` /
`列表里还没有歌曲` / `正在加载…` / `共 N 首` /
`确定要把「X」里的 N 首歌全部加入下载吗？可以在「我的 - 下载管理」里看进度。`

**播放列表**：`播放列表` / `共 N 首` / `播放列表是空的` /
`在歌单或搜索结果里点一首歌，就会进到这里` / `收藏` / `取消收藏` / `下载` /
`不喜欢的歌曲` / `移出播放列表`

**评论**：`「X」的评论` / `热门` / `最新` / `正在准备评论…` /
`正在匹配这首歌的平台版本…` / `正在加载评论…` / `还没有人评论` /
`来听这首歌的人还不多，过些时候再看看。` / `这个平台看不到评论` /
`这首歌还没匹配到平台上的版本` / `展开` / `收起` / `上拉加载更多` / `共 N 条` /
`IP属地：X`

**导入歌单**：`导入歌单` / `把歌单分享内容整段粘贴进来（长按输入框可粘贴），会自动识别平台与歌单` /
`解析歌单` / `解析中…` / `清空` / `导入到我的歌单` / `更新「X」` /
`导入成的歌单名` / `支持网易云 / QQ / 酷狗 / 酷我 / 咪咕的歌单分享链接` /
`正在处理，大歌单需要一点时间…`

**设置页**：`设置` / `搜索设置` / `登录音乐` /
`网易云 / QQ / 酷狗账号，扫码或 Cookie 登录` / `音源设置` / `同步设置` /
`播放设置` / `缓存` / `下载设置` / `WebDAV 云端音乐` / `外观` / `听书` / `关于`

**关于页**：`聆听` / `v1.0.0 · 洛雪音乐（LX Music）的鸿蒙移植版` / `作者` / `开源协议` /
`项目主页` / `聆听用户反馈 Q 群` / `点击复制群号` / `已复制到剪贴板`

---

*文档结束。所有数值均取自 `D:\lxmusic-harmony-upstream` 源码，未做主观调整。*

