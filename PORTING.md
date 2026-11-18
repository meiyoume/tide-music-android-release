# 洛雪音乐 · 鸿蒙 UI 移植到安卓版

把**鸿蒙版洛雪音乐**（ArkTS/ArkUI，`D:\lxmusic-harmony-upstream`）的界面，移植到
**洛雪音乐安卓版**（React Native，上游 `lyswhut/lx-music-mobile` v1.9.1）的底座上。

产出：手机版与平板版**同一个 APK**（界面按窗口宽度自适应），可直接安装运行。

---

## 一、为什么是这个方案

你最初的需求是「把鸿蒙版移植成安卓版」。评估后有两条路：

| 方案 | 工作量 | 判定 |
|---|---|---|
| 把 118 个 `.ets`（45208 行 ArkTS）整体重写成 Kotlin/Compose | 极大，且播放链路要全部重做 | ✗ |
| **用洛雪安卓版（RN）作底座，把鸿蒙版的 UI 换上去** | 只重写界面层，播放/音源/同步全部复用 | ✓ **采用** |

你随后提出的「洛雪音乐有安卓版，可以换成鸿蒙版那个 UI」正是第二条路 —— 本工程就是这么做的。

**关键发现**：安卓版本身已经有 `Vertical`（手机竖屏）与 `Horizontal`（平板/横屏）两套布局，
说明它原生就支持大屏；鸿蒙版则把「断点 + 内容列数 + 底部两条栏宽度」写成了一套明确的算法
（`ui/Layout.ets`）。移植时**照搬鸿蒙那套算法**，就同时拿到了手机与平板两种形态。

---

## 二、怎么用

```powershell
# 编译（改完代码后）
#   手机（真机，绝大多数机型）：arm64-v8a
powershell -NoProfile -ExecutionPolicy Bypass -File D:\android-tools\build-android.ps1 arm64-v8a assembleRelease

#   全架构（含 x86_64 模拟器 / 老 32 位设备）—— 注意必须显式列出四个 ABI，
#   只传 arm64-v8a 会让 universal 包缺 x86/x86_64 的原生库（见 §4.2 的 #13）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\android-tools\build-android.ps1 "armeabi-v7a,arm64-v8a,x86,x86_64" assembleRelease

# 产物（注意文件名带 `-harmony`，与原版洛雪区分，见 §2.1）
lxmusic-android\android\app\build\outputs\apk\release\lx-music-mobile-v1.9.1-harmony-arm64-v8a.apk   # 手机（真机）
lxmusic-android\android\app\build\outputs\apk\release\lx-music-mobile-v1.9.1-harmony-universal.apk  # 全架构（含平板模拟器）
```

> **依赖重装后要做一件事**：「音效」功能靠一个打在 `node_modules/react-native-track-player`
> 里的补丁（把播放器的 audio session id 暴露出来，见 §3.11）。`npm i` 会把它冲掉 ——
> 已经挂在 `postinstall` 上自动重打，正常不用管；万一警告说没打上，手动跑
> `node tools/patch-trackplayer-audiosession.mjs` 再编译。

### 2.1 与原版洛雪**共存**（安装身份）

这个包改过 `applicationId`，所以它和官方洛雪音乐是**两个独立应用**，可以同时装在一台手机上：

| | 原版洛雪 | 本移植版 |
|---|---|---|
| `applicationId` | `cn.toside.music.mobile` | **`cn.toside.music.mobile.harmony`** |
| 桌面名称 | LX Music | **洛雪音乐（移植版）** |
| 桌面图标 | 白底 + 绿音符 | **绿底 + 白音符**（互为反色，见 §2.3） |
| 数据目录 | 各自独立（系统按包名隔离） | 同上 |
| 深链接 | `lxmusic://` | `lxmusic://` + `lxmusic-harmony://` |

> 为什么必须改 `applicationId`：它才是**安装身份**。用同一个 id 时系统认为「这就是同一个应用」，
> 只能覆盖安装（签名不同还会直接失败）—— 用户遇到的「手机上已经有同款」就是这个。
>
> ⚠️ **改 `applicationId` 时有一个必须同步改的地方**：`src/config/constant.ts` 的
> `APP_PROVIDER_NAME`。manifest 里 FileProvider 写的是 `${applicationId}.provider`
> （自动跟随），而 JS 侧那个常量是**硬编码**的，漏改会让应用内「检查更新」安装 APK 失败。
> 另外深链接解析也要同时认两个 scheme（`lxmusic-harmony://` 不以 `lxmusic://` 开头，
> 只 replace 后者会让 type/action 解析错位）。
>
> `namespace`（`android { namespace }`）**故意保持原值**：它是代码里的 Java 包名
> （`cn.toside.music.mobile.R` 等几十处），与安装身份无关，改了反而要大动干戈。

**回退保险**：设置 → 基础设置 → 「界面壳层（鸿蒙移植版）」，关掉即**立刻退回安卓版原界面**
（顶栏 + 抽屉 + 普通 TabBar），不需要改代码或重装。

### 2.2 在模拟器上验证（脚本已固化）

```powershell
# 手机（AVD lx_phone）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-on-emulator.ps1 `
  -Avd lx_phone -Tag phone `
  -Apk android\app\build\outputs\apk\release\lx-music-mobile-v1.9.1-harmony-x86_64.apk

# 平板（AVD lx_tablet，同理换 -Avd / -Tag）
```

脚本会：起模拟器 → 装包 → **用正确的组件名启动** → 关掉首启三个弹窗 →
截「推荐」与「我的」两屏到 `shots\verify\` → 打印焦点/分辨率/是否崩溃。

> ⚠️ **启动组件名必须是 `cn.toside.music.mobile.harmony/cn.toside.music.mobile.MainActivity`**。
> 写成 `cn.toside.music.mobile/...` 会启动到**另一个应用**（原因见 §4.4 #17）。
> 模拟器 AVD 是 x86_64，**必须装 universal 或 x86_64 包**，arm64 包装不上。

### 2.3 装到真机：为什么之前会提示「本地已经有这个软件了」

用户实测反馈「还是没有区分好原版洛雪，说我本地已经有这个软件了」。拆成两件事：

**（a）视觉上分不清 —— 已修。** 移植版原先**沿用了原版洛雪的图标**（白底 + 绿音符），
桌面上一眼看不出哪个是哪个；部分国产 ROM 的安装器还会按「同名 / 同图标」提示「已有该应用」。
现在两处都改成反色：

| 位置 | 文件 | 改成 |
|---|---|---|
| 自适应图标（Android 8+） | `res/values/ic_launcher_background.xml` | `#FFFFFF` → **`#31C27C`**（品牌绿，与界面强调色同值） |
| 自适应图标前景 | `res/drawable/ic_launcher_foreground.xml` | `#5ed698`/`#4daf7c` → **`#FFFFFF`/`#E9F8F0`** |
| 传统图标（Android 7 及以下，10 张 PNG） | `res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round}.png` | 逐像素重着色为「绿底 + 白音符」 |

> 传统 PNG 的重着色脚本：把每个像素按「有多白」在绿/白之间插值
> （`t = (min(R,G,B)/255 - 0.45) / 0.55`，`t=1` 是底→绿，`t=0` 是音符→白）。
> **踩过的坑**：`.ps1` 里写了中文注释，PowerShell 5.1 无 BOM 时按 ANSI 读，
> 注释被拆成乱码并**吃掉下一行代码**，导致整张图被填成一个颜色（看起来像「空白淡黄方块」）。
> 脚本里保持纯 ASCII 后就正常了。原始 PNG 备份在 `android\_icon_backup_orig\`
> （**注意已移出 `res\`**：放在 `res\` 下会被 aapt 当成资源目录扫）。

**（b）安装被拒 —— 两个真实成因，都已处理或给出对策。**

1. **同一包名的旧版签名不同** → 报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（「应用未安装」）。
   只能先卸载旧版再装：`adb uninstall cn.toside.music.mobile.harmony`，
   或在「设置 → 应用」里卸载「洛雪音乐（移植版）」。
2. **versionCode 降级** → 报 `INSTALL_FAILED_VERSION_DOWNGRADE`。这是**本工程自己的坑**：
   `splits.abi` 会给单 ABI 包算 `versionCode*1000 + n`（arm64 = 78003），
   而 universal 包用的是裸的 `defaultConfig.versionCode`（**78**）——
   于是「先装 arm64 再装 universal」被系统当成降级而拒绝。
   已在 `android/app/build.gradle` 里给 universal 也加高位：
   `output.versionCodeOverride = defaultConfig.versionCode * 1000 + 9`，
   现在 universal(79009) > 任何单 ABI 包(7900x)，**任何包都能盖任何包**。
   同时 `package.json` 的 `versionCode` 78 → **79**，保证能盖过此前发出去的 78 系包。

**给用户的安装口径**：一台手机**只装一个**包就行（真机装 `arm64-v8a`，不确定就装 `universal`）。
如果提示「已存在」，那是**同一个移植版的旧包**，点「继续安装 / 更新」即可；
如果提示签名冲突，先卸载旧的「洛雪音乐（移植版）」再装。**它和原版洛雪不冲突**，
两者可以同时存在（包名不同，见 §2.1）。

---

## 三、移植了什么

### 3.1 应用壳层（`src/harmony/Shell.tsx`）

| 鸿蒙版 | 移植后 |
|---|---|
| 底部 HDS 悬浮页签栏（推荐 / 听书 / 我的） | 自绘悬浮胶囊栏，圆角 30、高 56 → **后来按用户要求换成手机 QQ 音乐那种贴底平直栏，见 §3.5** |
| 迷你播放栏（折叠 = 圆封面 / 展开 = 迷你播放器） | 同结构，封面 56 / 44，控制钮 24、间距 16 |
| 透明沉浸标题栏 | 大标题 + 来源胶囊 + 搜索圆钮，顶部让出状态栏 |
| 底部渐隐蒙层 | 12 层阶梯渐变（RN 无内置线性渐变） |

### 3.2 页面

| 页面 | 状态 |
|---|---|
| **推荐页** | ✅ 在线榜单横滑卡片 + 推荐歌单列表 + 来源/排序下拉（真实数据） |
| **榜单详情 / 歌单详情** | ✅ 点卡片真跳转：封面 + 简介 + 播放量 + 「播放全部」+ 分页歌曲列表 |
| **我的页** | ✅ 5 个快捷入口 + 歌单卡（自建/收藏两段）+ 设置卡 |
| **收藏** | ✅ 真实收藏列表（可播放 / 长按取消收藏） |
| **最近播放** | ✅ 真实播放历史（持久化，可重播 / 单条删除 / 清空） |
| **本地音乐** | ⚠️ 底座无独立本地库，页面给出导入指引（导入走「自建歌单 - 歌单导入」） |
| **下载管理** | ⬜ 明确说明（底座没有下载实现，下载列表被硬编码为空） |
| **云端音乐** | ⬜ 明确说明（底座完全没有 WebDAV） |
| 听书页 | ⬜ 明确空态（鸿蒙的书源引擎是另一套协议，本次未含） |
| 全屏播放器 | 沿用安卓版已有的「封面页 + 歌词页」PagerView 结构 |
| 设置页 | ✅ 沿用安卓版原有实现，**已修好整片英文的问题**（见 §4.2） |

### 3.3 视觉体系

- **色板**：把鸿蒙 `resources/base|dark/element/color.json` 的 **44 个语义 token 逐项搬过来**
  （`src/harmony/tokens.ts`），含 `#AARRGGBB → #RRGGBBAA` 的格式转换。
- **强调色**：洛雪红 `#E33B3B`（暗色 `#FF5F5F`），并新增两个主题 `lx_red` / `lx_dark`
  作为默认主题（原来是绿色 `#4eb17d`）。
- **图标**：鸿蒙用系统符号库（68 个 `sys.symbol.*`），RN 侧按语义映射到
  MaterialCommunityIcons（`src/harmony/icons.ts`）。
- **玻璃层**：鸿蒙靠 HDS 系统材质（会模糊背后内容）；RN 没有这层能力，
  按规格文档 6.8 的结论降级为「半透明白底 + 1px 白描边 + 圆角，**不加阴影**」。

### 3.4 平板 / 折叠屏适配（`src/harmony/Layout.ts`）

逐行照搬鸿蒙 `ui/Layout.ets`：

| 算法 | 作用 |
|---|---|
| `contentColumnsFor(w)` | 列表一屏几列（≥600dp 起，每列 360，最多 4 列） |
| `cardColumnsFor(w)` | 设置类卡片并排（≥966dp 才两列） |
| `barMetricsFor(w, expanded)` | 底部两条栏宽度，保证不重叠 |
| `shouldCollapseTabBar` / `canExpandMiniBar` | 窄屏保护（RN 侧补的，鸿蒙由 HDS 框架兜底） |

### 3.5 后加的一次换肤：手机 QQ 音乐外观（2026-10-06 晚）

按用户要求，把**底部两条栏与配色**从「鸿蒙的悬浮胶囊」改成「手机 QQ 音乐」的样子。
这一轮**改的是皮肤，不是结构**：页面划分、数据来源、平板算法都没动。

| 文件 | 改了什么 |
|---|---|
| `src/harmony/tokens.ts` | 整套色板换成 QQ 音乐线上 CSS 实测值：强调色 `#31C27C`（**语义名仍叫 `red`**，历史命名，31 处调用点因此不用改）、底 `#F2F2F2`、卡 `#FBFBFD`、分隔 `#EDEDED` |
| `src/harmony/TabBar.tsx` | 悬浮胶囊 → **贴底平直栏**（横跨整宽、直角、顶部 0.5px 分割线、高 52 + 手势条），选中态改成**图标+文字一起变绿** |
| `src/harmony/Shell.tsx` | 迷你播放栏从「与页签栏并排」改成**贴在页签栏上方单独一行**（实底，避免后面的列表文字透上来）；补底部安全区 `bottomInset = 24` |
| `src/harmony/RecommendPage.tsx` | 推荐歌单从「左封面 58 + 右两行」的横向行改成 **QQ 式竖排卡片**（封面 `aspectRatio: 1` 占大头、去掉行尾箭头） |

**副作用（已按用户反馈处理，见 §3.6）**：竖排卡片在手机上只有 1 列，于是**一张封面占满一屏宽**，
一屏只看得到一张歌单。

`Layout.ts` 里那套「两条悬浮栏的宽度分配」算法（`barMetricsFor` / `narrowBarSplit` /
`shouldCollapseTabBar` / `canExpandMiniBar` / `publishedMiniBarWidth`）**换肤后已无人调用**，
但**故意留着**：想回到鸿蒙的悬浮胶囊外观时可以直接复用。

### 3.6 推荐歌单改成宫格（2026-10-07 晚，用户反馈）

用户原话：「还有推荐歌单图标太大 改成一排四个歌单比较好」。也就是把 §3.5 留下的那个副作用收掉。

**根因不是「卡片太大」，是列数取错了口径**：歌单宫格当时用的是列表页的
`contentColumnsFor(windowWidth)`，而那个函数按「一行至少要 360dp」算 —— 那是给
**歌曲行**（封面 + 歌名 + 歌手 + 时长）定的门槛。手机上窗口才 ~393dp，于是算出 1 列，
封面被 `aspectRatio: 1` 拉成整屏宽的正方形。

**修法**：给宫格单独一个口径 `Layout.playlistColumnsFor(windowWidth)`：

| | 一列至少 | 列数 |
|---|---|---|
| 歌曲列表 `contentColumnsFor` | 360dp | 手机 1、平板 3 |
| **歌单宫格 `playlistColumnsFor`** | 150dp | **手机固定 4**、宽屏 4~5 |

配套调整（都在 `RecommendPage.tsx`）：

- 宫格列数用新的 `playlistColumns`；**榜单卡片的宽度仍然用旧的 `columns`**
  （`width={columns > 1 ? 216 : 180}`）—— 两者口径不同，不能合并成一个变量，
  否则手机上的榜单卡片会跟着从 180 变成 216。
- `cardSize` 按真实布局重算：`(窗口宽 − 宫格外边距 10×2) / 列数 − 卡片内边距 6×2`。
- `columnWrapperStyle` 的左右内边距从 8 改成 10，使封面左边缘 = 10 + 6 = **16**，
  与上方「推荐歌单」标题行的 `paddingLeft: 16` 对齐。
- 宫格卡片（多列）字号小一号：标题 15 → **13**、行高 21 → **17**，播放量 12.5 → **11**。
  一格只有 ~90dp 宽，沿用单列那套字号两行标题就占掉封面一半高度。

实测列数（见 §4.7 截图）：手机 1080×2340 @440dpi → **4 列**，封面约 81dp；
平板 2560×1600 @320dpi → **5 列**，封面约 240dp。

### 3.7 搜索页：最近搜索 + 综合结果（2026-10-07 晚，用户反馈）

用户原话：「搜索界面 要有最近搜索曲目 搜索结果要歌单和歌曲一起搜出[来] 左边歌曲 右边歌单这样」。

**（a）搜索页空白态什么都没有 —— 是两个开关的默认值问题**

搜索页空白时由 `BlankView` 决定显示什么，它读两个设置项：

```ts
'search.isShowHotSearch': false,      // 上游默认
'search.isShowHistorySearch': false,  // 上游默认
```

两个都是 `false` ⇒ 走进 `else` 分支，只显示一行 `t('search__welcome')`（「搜我所想~~😉」）。
所以用户看到的搜索页是**空的**：既没有「历史搜索」也没有「热门搜索」。
改成两个都 `true`（与鸿蒙版 `discoverPane()` 的「历史 + 热搜」一致）。
`HistorySearch` / `HotSearch` 在列表为空时自己 `return null`，所以不会留空标题。

**但只开开关还不够，还有两处会让人以为「开关没生效」：**

1. **`addHistoryWord()` 有个前置条件**（`core/search/search.ts`）：
   ```ts
   if (!settingState.setting['search.isShowHistorySearch'] || !word) return
   ```
   开关为假时**搜索根本不会写历史** —— 所以光是「把显示开关打开」在旧数据上也没用，
   必须让开关从一开始就是 `true`（这也是为什么改默认值、而不是加个 UI 开关）。
2. **历史被热门搜索挤到屏幕外**。上游 `BlankView` 的渲染顺序是
   **热门在前、历史在后**，而热门搜索一次返回三十多个词、占满一整屏 ——
   「历史搜索」在屏幕外，要往下滚才看得到。实测第一次就栽在这里：
   截图里只有「热门搜索」，看起来像历史没记录。
   已把顺序调成**历史在前**（与鸿蒙 `discoverPane()` 一致）。
   判断「有没有渲染」不能只看 uiautomator dump —— **它只包含可见节点**，
   屏幕外的东西一律不在里面。

**（b）综合搜索：一次搜出歌曲 + 歌单，左歌曲 / 右歌单**

上游的搜索结果是**二选一**（`search_type_music` / `search_type_songlist`），
鸿蒙版 `resultPane()` 也只有歌曲（带平台筛选胶囊）。用户要的是两者一起。

| 文件 | 改动 |
|---|---|
| `store/search/state.ts` | `SearchType` 加 `'both'` |
| `config/constant.ts` | `DEFAULT_SETTING.search.type` 默认 `'both'`（原来是 `'music'`） |
| `lang/*.json` | 加 `search_type_both` =「综合」/「綜合」/「All」 |
| `Search/SearchTypeSelector.tsx` | 选项改成 `both` / `music` / `songlist`，「综合」放第一位 |
| `Search/List.tsx` | 加 `both` 分支：`flexDirection: 'row'` 里并排 `MusicList`（左）+ `SonglistList`（右），中间一条 hairline 竖线，每栏一个「歌曲」/「歌单」小标题 |

**关键取舍：复用底座原有的两个列表组件，不重写。** `MusicList`（`OnlineList`）和
`SonglistList`（`Songlist`）各自带着行内「更多」菜单、长按菜单、多选、分页、下拉刷新 ——
重写等于把这些交互全丢掉。它们都是 `flex: 1` 且自带滚动，所以塞进 row 里各自独立滚动即可。

宽度比例 `BOTH_MUSIC_FLEX = 1.25`：歌曲那栏行内有「序号 38 + 更多按钮 44」的固定占宽，
太窄歌名会被截得很厉害；歌单那栏是宫格，`Songlist` 自己按栏宽算列数（**最少 2 列**），
窄一点也能看。

**顺带修掉一个 `both` 引出的 bug**：`Search/index.tsx` 里选「平台来源列表」原来是个
只写了 `music` / `songlist` 两个 case 的 `switch`，加了 `both` 之后**两个都不命中**，
`setSourceList` 根本不会被调用 ⇒ 平台选择器是空的。改成
`type == 'songlist' ? 歌单的来源 : 歌曲的来源`。

### 3.8 移植版的一次性设置迁移（`config/portMigration.ts`）

**这是本移植版最容易踩、也最容易被忽略的一条：改 `defaultSetting.ts` 只对全新安装生效。**

看 `config/setting.ts` 的 `mergeSetting()` —— 它拿新默认值当底，把**已存的值**盖上去，
也就是「**用户存过的值永远优先**」。所以对**已经装过本移植版**的手机来说，
无论怎么改默认值，读出来的还是手机上那份旧值。

用户反馈「弹窗还在 / 搜索页还是空的 / 还是只搜歌曲」就是栽在这里（见 §5.6）。

做法：新增 `config/portMigration.ts`，在 `initSetting()` 里 `updateSetting()` 之后调用，
**强制覆盖**这几个键，并用 `storageDataPrefix.portMigrated` 标志位保证**只做一次**
（之后用户自己改回来不会再被覆盖）：

| 键 | 手机上可能存的旧值 | 不改的现象 |
|---|---|---|
| `common.isAgreePact` | `false` | 每次启动都弹「许可协议」 |
| `search.isShowHistorySearch` | `false` | 搜索页空白、没有「搜索历史」；而且 `addHistoryWord()` 会因为它是 false **根本不记历史** |
| `search.isShowHotSearch` | `false` | 搜索页没有「热门搜索」 |
| `search.type`（存在 `@search_setting` 这个**独立 key** 里，不在 AppSetting 里） | `'music'` | 搜索结果只有歌曲、没有歌单 |

> 注意最后一行：搜索类型不在 `AppSetting` 里，所以迁移时要单独走
> `utils/data.ts` 新加的 `forceSearchType()`（直接写 `@search_setting`），
> 光改 `FORCED_SETTING` 那个对象是改不到它的。

### 3.9 去掉「听书」页签（2026-10-07 晚，用户要求）

底部页签从 **推荐 / 听书 / 我的** 变成 **推荐 / 我的**。

理由也站得住：鸿蒙版的「听书」是一套**独立的书源引擎**（阅读 / Legado 的 JSON 规则），
与音乐音源不是同一套协议，本次移植并没有这部分能力 —— 那个页签点进去只是一个
「本次移植未包含」的说明页，留着反而像功能坏了。

改动：`Shell.tsx` 的 `tabs` 只留 `[TAB_HOME, TAB_MINE]`，删掉 `ListenPlaceholder`
组件与 `renderPage` 的 `listen` 分支（连带 `Text` / `F_TITLE` 两个 import 也删了）。
`TabBar.tsx` 里 `TAB_LISTEN` 的**定义还留着**，想加回来放回数组 + 补回 `listen` 分支即可。
`TabBar` 每颗页签是 `flex: 1` 等分，所以两个页签各占一半宽，不需要改布局算法。

---

### 3.10 内置音源：只内置实测真可用的 5 个（2026-10-07 晚，用户要求「把有用的音源内置进去」）

**清单**（脚本原文在 `tools/builtin-sources-src/`，清单在 `tools/builtin-sources.manifest.json`，
跑 `node tools/gen-builtin-sources.mjs` 生成 `src/harmony/builtinSources/scripts/*.ts`）：

| 源 | 覆盖平台 | 角色 |
|---|---|---|
| **HYWmusic_beta_公益测试** v0.74.0 | kw/kg/tx/wy/mg | **默认源**（唯一 tx 走 QQ 官方 CDN 且是完整曲目的全平台源） |
| **星海音乐源** v3.2.15 | kw/kg/wy/mg | 全走各平台官方 CDN、最快（0.3~0.9s） |
| **lx-玉宁熙-Pro** v1.2.2 | kw/kg/wy/mg | 与星海同一批平台、另一套后端（互为备份） |
| **𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ** v260809 | tx/wy/mg | tx 的第二个真源 |
| **屿溪-终章** v0.0.0 | kw/kg/tx/wy/mg | 机制不同（本平台失败就换平台搜同名曲），兜底 |

**为什么不收更多的**（实测报告见 `SOURCE-TEST-REPORT.md`，共测了 61 个脚本 / 36 个去重后候选）：

- **Huibq（此前唯一的内置源）**：kg/tx/mg 返回**占位音频** —— 解析失败时给一段固定的
  `panspace.kuwo.cn/.../2149972737147268278.mp3`，照样 `HTTP 206 audio/mpeg`，
  看起来"能播"但**不是那首歌**。识别办法：把歌曲 id 换成假值再调一次，地址不变就是占位。
  上一轮判它「kw/kg/wy 可用」就是被这个骗的。这版把它移出内置清单（不删用户设备上已装的那份）。
- **墨澜 / 星澜聚合 / 聚合API接口**：tx 只有 0.9MB ≈ 24 秒试听片段 → 不收。
- 其余（六音、ikun、梓澄、無名、独家、小熊猫、肥猫、野花/野草…）：服务端已停或脚本崩溃。

**两个实测方法论上的坑（比结论更重要）**：

1. **脚本收到的 `musicInfo` 是旧格式**。应用先过 `utils/index.ts` 的 `toOldMusicInfo()`，
   字段是 `songmid / hash / strMediaMid / songId / copyrightId`，**不是** `meta.songId`。
   测试夹具不按旧格式造，脚本拿到的全是 `undefined`，结论必然错。
2. **"能取到音频字节" ≠ "是这首歌"**。必须 ① 假 id 对照识别占位音频，
   ② 核对文件总长是否与该平台 320k/128k 的真实体积一致。

**怎么换源 / 加源**：把脚本丢进 `tools/builtin-sources-src/` → 在 manifest 里加一条 →
`node tools/gen-builtin-sources.mjs` → 在 `builtinSources/index.ts` 的 `BUILTIN` 里加一行
（`prefer: true` 表示"没选过源时默认选它"）。

**默认选中的规则**（`builtinSources/index.ts`，三条按序）：

1. 当前没选任何源 → 选 `prefer` 那个；
2. 当前选的是**我们上次自动选的**那个 → 换成新的 `prefer`（升级时把用户从差的默认源带过去）；
3. 其他情况**不动** —— 用户自己挑的不该被改掉。

第 2 条靠 `@user_api__builtin_auto_selected` 记住"上次自动选的是谁"：
用户只要在设置里自己切过一次，记录就对不上了，规则 3 生效，之后不再干预。

### 3.11 音效：均衡器预设 + 低音增强 + 环绕声（2026-10-07 晚，用户要求「找几个公认好听的音效」）

**给的是什么**：不是我自己编的曲线，是**安卓系统效果库自带的公认预设**——
标准 / 古典 / 舞曲 / 原声 / 民谣 / 重金属 / 嘻哈 / 爵士 / 流行 / 摇滚（10 个，
列表从设备上实时读，读不到才用 AOSP 那套兜底），外加「低音增强」「环绕声」两条 0~1000 的强度滑杆。

**放在哪**：设置 → 基础设置 → 「音效」（`settings/Basic/SoundEffect.tsx`），
开关 + 预设宫格 + 两条滑杆。存 `player.soundEffectEnabled / soundEffectPreset /
soundEffectBassBoost / soundEffectVirtualizer` 四项（`config/defaultSetting.ts`）。

**实现链**：

| 层 | 文件 |
|---|---|
| 原生效果器 | `android/app/src/main/java/cn/toside/music/mobile/audiofx/AudioEffectModule.java` + `AudioEffectPackage.java`（`MainApplication.java` 里注册） |
| 库补丁 | `tools/patch-trackplayer-audiosession.mjs`（改 `node_modules/react-native-track-player`，`--revert` 可还原） |
| JS 封装 | `src/utils/nativeModules/audioEffect.ts` |
| 状态 | `src/store/soundEffect/{state,action,hook}.ts` + `stateEvent.ts` 的 `soundEffectUpdated` |
| 业务 | `src/core/soundEffect.ts`（`refreshSoundEffectStatus` / `applySoundEffect` / `releaseAllSoundEffect`） |

**这里唯一的难点是「挂在哪个 audio session 上」**，值得单独说清楚：

1. **绝不能传 session 0。** 安卓把 `new Equalizer(0, 0)` 当成**全局输出混音**——
   挂上去会把微信语音、视频、铃声的声音一起改掉。所以 `ensureEffects()` 拿到的
   session id `<= 0`（说明播放器还没把音频会话建出来）时**宁可不生效**，先记下设置，
   等会话出现再挂，也不退回 0。
2. **RNTP 不给这个 id。** fork 的 `react-native-track-player` 里 `Player` 接口**没有**
   `getAudioSessionId()`（只有 `ExoPlayer` 有）。补丁做了三件事：
   在 `ExoPlayback` 里加 `getAudioSessionId()`（内部 `instanceof ExoPlayer` 后再取）、
   新增 `AudioSessionHolder` 静态类保存 id + 会话变化回调、
   在 `onPlaybackStateChanged()` 里顺手取一次（**会话是播起来之后才有的**）。
3. **时机不固定。** 用户可能先设音效再播、也可能先播再设。所以原生侧**记住设置**
   （只存基本类型 —— `ReadableMap` 在方法返回后会被 RN 回收，不能留着），
   靠 `AudioSessionHolder` 的回调**自动重挂**；JS 侧在 `handlePlay()` 里再补一次作为保险。
4. **全关着就不占效果器。** `applySoundEffect()` 发现「没启用 / 预设=关闭 / 两条强度都是 0」
   就调 `release()` 释放对象并清掉记住的设置，免得每次开始播放都白建一遍再关掉。

所有 `new Equalizer/BassBoost/Virtualizer` 都包了 try/catch（设备没这个效果库、
被别的应用占满、参数不支持都会抛），失败就把原因回给 JS 如实显示，不崩。

**模拟器能验什么、不能验什么**：能验「预设列表读得到」「点了能存」「效果器真的挂到了
播放会话上」（`dumpsys media.audio_flinger` 里能看到均衡器/低音增强的 UUID 挂在会话上），
**验不了听感** —— 这台模拟器音频本身是慢速播放的（见 §4.11 的 #27），耳朵听不出来。

---

## 四、实测验证

在 **Android 14 模拟器**上真机跑过（不是只看代码）：

| 设备 | 分辨率 | 结果 |
|---|---|---|
| Pixel 5（手机） | 1080×2340 | 单列布局、悬浮栏、榜单卡片均正常 |
| Pixel Tablet（平板） | 2560×1600 | **3 列自适应**生效；「我的」页 2:1 卡片并排生效 |

截图在 `shots/`。过程中**实测发现并修掉两个真实缺陷**：

1. **标题与状态栏重叠** —— 沉浸式标题栏没有让出状态栏高度（`topInset` 未接）。
2. **悬浮栏背后的列表文字透上来，两层字糊在一起** —— 鸿蒙那层的不透明度来自系统材质，
   RN 没有材质，用 10% 白就会透字。改为实底（`getBarSolid`），并补上底部渐隐层。

> 这两个都是**只有真的截图看才能发现**的问题 —— 代码读起来完全正常。

### 4.1 第二轮视觉检查（逐页实测）又发现 5 个

第一轮只看了首页。逐页走查后又抓到 5 个，全部已修：

| # | 缺陷 | 根因 | 修法 |
|---|---|---|---|
| 3 | 平板上迷你栏显示成一颗孤零零的圆钮 | 宽屏下迷你栏应**恒为展开态**（鸿蒙 `miniBarStyle` 只在 <600vp 生效），我漏了这条 | `effectiveMiniExpanded = isWideWindow \|\| miniExpanded` |
| 4 | 窄屏展开迷你栏时，3 个页签图标挤在一起 | 把鸿蒙源码里的 `96` 误当成「折叠后页签栏总宽」——它其实是 `windowWidth - 96` 里的**边距之和** | 改成按「页签数 × 48dp 槽位」算（`narrowBarSplit`） |
| 5 | 页签栏只剩图标、文字全丢 | 跟着「窄屏 + 迷你栏展开」无条件丢文字，而 144dp（每颗 48dp）明明放得下文字 | 判据改成「每颗 < 40dp 才丢」（`tabWidth / tabs.length`） |
| 6 | 两条栏之间的 8dp 缝里露出列表文字 | 渐隐层最底只有 92% 不透明，缝里挡不住 | 最底部一段铺**不透明页面底色**（`solidHeight`） |
| 7 | 「我的」页点「设置」没有任何反应 | `onNavigate` 只是切底部页签（`setNavActiveId('nav_love')`），而点的时候**已经**在那个页签上 | 新增 `SubPageHost`：整屏子页面 + 返回栏，真正渲染底座的设置页 |
| 8 | 全屏播放器是浅色底 | 套了 `PageContent`（铺主题底色），而鸿蒙播放器**恒为深色** `#0C0C0E` | 播放器不用 `PageContent`；并加 `PlayerTheme` 覆盖整棵子树的主题（否则深底上的深灰文字看不见） |

> 其中 #7、#8 是**功能/观感层面的真问题**，不是像素级瑕疵：#7 等于入口点了没用，
> #8 让亮色模式下的播放器与鸿蒙完全不同。
>
> #8 的修法值得一提：播放器子树里 19 个文件、14 个主题 token 都按主题取色，
> 逐个文件改既容易漏又会把上游代码改烂。改成**覆盖 `ThemeContext`** 一处生效。

### 4.2 第三轮（用户实测反馈「我点不动 / 二级菜单也没优化」）又修了 5 个

用户装到手机上用之后反馈的两个问题，实测都复现了，根因与修法如下：

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| 9 | **点榜单卡片 / 推荐歌单没反应** | 壳层 `handleNavigate` 里 `board:` / `playlist:` 被**显式 return 忽略**（当时的注释写「详情类页面本次未接入」） | 新增 `src/harmony/OnlineDetailPage.tsx`（榜单与歌单共用），在 `Shell.renderPage` 里按前缀渲染 |
| 10 | **设置页整片英文**（General / Theme / Automatically play music…） | 两个原因叠加：① `lang/i18n.ts` 的 `useI18n` 初值是 `en_us`；② Android 原生 `UtilsModule.getSystemLocales` 会把系统语言格式化成 `en_us` 这种**合法 locale 键**，于是英文系统上命中「设备语言可用」分支、直接选中 en_us —— 只在「设备语言不可用」时才兜底中文的那条分支**永远不会走到**（我第一版就是这么改的，实测重装后仍是英文） | ① 设备语言是 `en*` 时也给简体中文；② **存量修正**：已装过的设备 `common.langId` 已被落成 `en_us`，用一个 `langUserChosen` 标记区分「用户主动选的」与「默认落的」，前者尊重、后者纠正回中文（`core/init/i18n.ts` + `config/constant.ts`） |
| 11 | 五个二级入口点进去是「未移植」占位 | `SubPageHost` 的 switch 只接了 settings / about / search | 新增 `src/harmony/Panes.tsx`（收藏 / 最近播放 / 本地音乐 / 下载管理 / 云端音乐），接进 `SubPageHost` |
| 12 | **「最近播放」本来会永远为空** | 底座**没有**播放历史能力 —— `playerState.playedList` 是「随机播放已播过、别再随机到」的**去重队列**：只在随机模式写入（默认 `listLoop`）、切列表就清空、且不持久化 | 新增 `src/harmony/playHistory.ts`：订阅 `playMusicInfoChanged` 记一份**持久化**历史（同曲去重置顶、上限 300），在 `core/init` 里初始化 |
| 13 | 全架构 APK 在 x86_64 上崩 `dlopen failed: libquickbase64.so not found` | `react-native-quick-base64` 的 `build.gradle` 用 `abiFilters(*reactNativeArchitectures())` **跟随构建参数**，而 `react-native-quick-md5` 是**硬编码四个 ABI**；之前只按 `arm64-v8a` 构建，于是 universal 包里只有 arm64 那一份 .so，x86_64 模拟器上必然找不到 | 构建全 ABI（`armeabi-v7a,arm64-v8a,x86,x86_64`），universal 包四个 ABI 齐全 |

> #12 特别值得记：那个数组**名字叫 `playedList`，看起来就是播放历史**，
> 直接拿来渲染「最近播放」代码上完全说得通、编译也过 —— 但实测会发现它默认恒空。
> 这类「名字骗人」的字段只能靠读它的**写入点**（`core/player/utils.ts` 的随机去重逻辑）才能识破。
>
> #13 也一样：报错看着像「库没打包进去」，但 .so 明明在 APK 里 ——
> 要 `unzip -l` 逐个 ABI 数一遍，才发现**只有 arm64 那一份**。

### 4.3 第四轮（用户反馈「黑色图标很难看」「音源不行所以播放不了」）

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| 14 | **封面加载不出来时是一排黑方块，很难看** | `CoverArt` 的占位配色**照搬了鸿蒙**那套近黑（`#2B2B33` / `#141417`）。但那套是给鸿蒙的深色播放页配的，本移植版主界面是浅灰底 + 纯白卡片，黑方块铺上去非常突兀 | 换成同色系的**明亮渐变**（洛雪红 / 橙 / 蓝 / 绿 / 紫 / 粉），底色从近黑 `#1C1C1E` 改为跟随主题的 `fillSoftStrong`；鸿蒙那套深色保留在注释里备查 |
| 15 | 设置页视觉仍是安卓原样式（红竖条分组 + 方框勾选） | `Section` / `CheckBoxItem` / `SubTitle` 这三个共享组件用的是上游原样式 | 三个组件都做成**两态**：壳层开启时走鸿蒙样式（圆角白卡 + 灰色小标题 + 洛雪红开关 + 行间分隔线），关掉则退回原样式。改共享组件可一次覆盖 11 个分组 + 35 个设置项文件 |
| 16 | **「音源不行，播放不了」** —— 实测**不是音源坏了** | ① 音源服务本身正常（PC 侧直连返回 `code:0` + 真实地址，且该地址能取到 `HTTP 206 audio/mpeg` 字节）；② 设备侧日志全是 `block ip`，即**该服务按 IP 限流**；③ **真正的代码缺陷**：脚本抛的限流文案是 `block ip`，而底座只认自己那句 `'服务器繁忙'`，于是被限流后**不当作限流**，反而去别的平台连环换源重试（实测一次失败连发 5+ 请求）→ **越限流越发请求，冷却越拖越久** | ① 新增 `isThrottleError()`（`utils/message.ts`）识别各脚本的限流文案，命中即**停止换源重试**；② 限流后的延迟重试从**随机 2–6 秒放宽到 30–60 秒**（2–6 秒等于在冷却期持续敲门）；③ 按用户要求「**重试三次失败就提醒**」：连续 3 次拿不到地址弹窗说明原因与下一步（等一会 / 换音源），同一首只提醒一次 |

> #16 的教训（重要）：**「播放不了」不一定是音源坏了**。这次是我自己为了复现问题
> 连续点歌，把用户的出口 IP 打进了限流名单 —— 用户原话「不要用高并发了 不然我都用不了了这音源」。
> 排查音源问题时**必须串行、且不要反复重试**（用户全局指令里也已写明这条）。
> 而这次顺带挖出的代码缺陷（限流文案没被识别 → 连环换源 → 雪球）才是真正该修的东西。
>
> #15 的做法可复用：设置树有 35 个文件、75 处引用，**不要逐个改**，
> 改 `Section` / `CheckBoxItem` / `SubTitle` 三个共享组件即可全覆盖，
> 而且天然支持「关掉开关就回退」。

### 4.4 第五轮复验（2026-10-07）：换肤后的样子**之前从没被看过**

上一轮的换肤（§3.5）改完就直接出包了，**最后一张截图停在 19:16，而换肤是 19:38–19:47** ——
也就是说换肤后的界面**一次都没被截图验证过**。这次补上，顺便把「怎么验」固化下来。

复验方式：x86_64 release 包 + AVD `lx_phone` / `lx_tablet`（Android 14），
脚本 `tools/verify-on-emulator.ps1`（配套 `tools/ui-probe.mjs`、`tools/dismiss-first-run.mjs`）。

| 设备 | 分辨率 | 结果 |
|---|---|---|
| Pixel 5（手机） | 1080×2340 | 壳层正常：贴底页签栏、上方迷你栏、绿强调色；「我的」页 5 个快捷入口 + 自建/收藏歌单 + 设置均正常 |
| Pixel Tablet（平板） | 2560×1600 | **推荐歌单 3 列自适应**、榜单横滑卡片、两条栏横跨整宽，均正常 |

截图在 `shots/verify/`。没有 `FATAL EXCEPTION`；榜单/推荐歌单能拉到真实数据。

**这一轮踩到的两个坑（都会让人误判「新构建没生效」）**：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 17 | 装上刚构建的包，界面却还是**换肤前**的悬浮胶囊 + 洛雪红 | 本版 `applicationId` 是 `cn.toside.music.mobile.harmony`，但 **Activity 类名仍是 `cn.toside.music.mobile.MainActivity`**（namespace 没改）。`am start -n cn.toside.music.mobile/cn.toside.music.mobile.MainActivity` 里 `-n` 的**包名部分是 `cn.toside.music.mobile`** —— 模拟器上正好留着早期那份 applicationId 还没改的旧移植包，于是**启动的是它**（logcat 里能看到两个 uid：10198 与 10199） | 启动必须写 `cn.toside.music.mobile.harmony/cn.toside.music.mobile.MainActivity`，并先 `adb uninstall cn.toside.music.mobile` |
| 18 | 首启三个弹窗关不掉，截图全被遮住 | ① 它们是 RN `Modal`，**返回键关不掉**，只能点按钮；② 靠猜坐标点不准（页签栏的实际高度取决于 app 窗口，不是屏幕高度，差 40px 就点到栏外） | 用 `tools/dismiss-first-run.mjs`：uiautomator 找节点、点 bounds 中心。**注意「不接受」里也含「接受」**，必须先排除它，并且正文段落里也含「接受」→ 要优先精确匹配、再退而取**最短**的匹配节点，否则会点到正文（或点到「不接受」= 退出并清数据） |

> #17 值得记：这个坑的症状是「源码明明改了、bundle 哈希也变了，界面却不变」，
> 很容易误判成 Metro 缓存陈旧或 APK 打包没更新。我当时把 APK 里的 `index.android.bundle`
> 抽出来跟 rebuild 的产物逐字节比对（完全相同）才排除了构建问题 —— **先证伪自己的假设，
> 再去找真正的启动目标**。

### 4.5 第六轮（2026-10-07 下午）：安装身份 / 图标的实测

起因是用户反馈「还是没有区分好原版洛雪，说我本地已经有这个软件了」。改动见 §2.3，实测如下。

**包身份**（`aapt2 dump badging`，5 个包全部一致）：

| 包 | applicationId | versionCode | label | native-code |
|---|---|---|---|---|
| universal | `cn.toside.music.mobile.harmony` | **79009** | 洛雪音乐（移植版） | arm64-v8a（含全部） |
| arm64-v8a | 同上 | 79003 | 同上 | arm64-v8a |
| armeabi-v7a | 同上 | 79001 | 同上 | armeabi-v7a |
| x86 | 同上 | 79002 | 同上 | x86 |
| x86_64 | 同上 | 79004 | 同上 | x86_64 |

**签名**（`apksigner verify --verbose`）：`Verifies`，v1 = true、v2 = true，
`CN=LX Music Android, OU=Dev, O=LXMusic, ...`，exit code 0。universal 与 arm64 两份都过了。

**图标真的进了包**（这一步容易想当然，所以逐项查了）：
`aapt2 dump resources` 显示 `mipmap/ic_launcher` 有 5 个密度的 PNG（`res/9w.png`…`res/o-.png`）
+ `anydpi-v26` 的 `res/BW.xml`；`mipmap/ic_launcher_round` 同理；
`color/ic_launcher_background` 的编译值是 **`#ff31c27c`**。
把 `res/o-.png`（xxxhdpi 方图）和 `res/Gc.png`（xxxhdpi 圆图）从 APK 里抽出来看，
确认就是「绿底 + 白音符」。**注意 APK 里的资源文件名被 AGP 改名了**
（`res/o-.png` 之类），按 `res/mipmap-*/ic_launcher.png` 去找是找不到的 —— 得从资源表查。

**安装升级路径**（这一条是本次的核心，因为它以前必失败）：

| 步骤 | 操作 | 结果 |
|---|---|---|
| 0 | `adb uninstall` 两个包 | versionCode = NONE |
| 1 | 装 x86_64 包（79004） | Success，设备上 versionCode = 79004 |
| 2 | **再装 universal 包（79009）** | **Success**，设备上 versionCode = 79009 ← 修复前这里会被判降级而拒绝 |
| 3 | 启动 → 关首启弹窗 → 截「推荐 / 我的 / 收藏」 | 焦点是 `...harmony/cn.toside.music.mobile.MainActivity`，无 `FATAL EXCEPTION` |

截图：`shots/verify/id-01-home.png`、`id-02-mine.png`、`id-03-favorites.png`。

**这一轮踩到的坑**：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 19 | 重着色图标脚本跑完，10 张 PNG 全被填成**一个颜色**（看着像「空白淡黄方块」） | `.ps1` 里写了**中文注释**。PowerShell 5.1 无 BOM 时按 ANSI 读脚本，中文被拆成乱码并**吃掉下一行代码**，于是 `$t = ...` 那行根本没执行。我当时去查换算公式，单独跑发现公式完全正确（白 253,253,253 → t=0.9857 → (52,195,126)）才定位到是脚本编码问题 | 脚本保持**纯 ASCII**（同 §5 的老坑，这是第四次踩） |
| 20 | 图标备份目录被 aapt 当成资源目录 | 我先把备份放在 `res\_icon_backup\` | 移出到 `android\_icon_backup_orig\` |
| 21 | 模拟器起不来、`adb wait-for-device` 永久挂住，日志只有一行 `start emulator` | AVD 在 `D:\android-tools\avd`，但脚本没设 `ANDROID_AVD_HOME`（`$HOME\.android\avd` 下没有），emulator 报 `Unknown AVD name [lx_phone]` 后直接退出 | 脚本里显式 `$env:ANDROID_AVD_HOME='D:\android-tools\avd'`，并把 `wait-for-device` 换成带超时的轮询 |
| 22 | `aapt2 dump badging` 里的中文标签在控制台是乱码 | aapt2 输出 UTF-8 字节，PowerShell 按控制台代码页（GBK）解码 → 二次解码 | 用 `Start-Process -RedirectStandardOutput` 落盘（保留原始字节），再以 UTF-8 读回 |

> #21 和 §5 的 #17 是同一类错误：**验证脚本本身坏了，看起来却像被测对象坏了**。
> 以后模拟器脚本一律先断言「设备起来了」再往下走。

### 4.6 第七轮（2026-10-07 傍晚）：返回键 + 启动弹窗的实测

改动见 §5.5 / §5.6。实测脚本 `_back_test.mjs`（在 ZCode 工作区，用 Node 写 —— 中文经
PowerShell/cmd 会乱码），手机 AVD `lx_phone`（1080×2340），装的 universal 包（versionCode 80009）。

| # | 场景 | 结果 |
|---|---|---|
| A | 冷启动后 30s | **无任何弹窗**，直接停在推荐页（`谨防被骗提示`/`许可协议`/`发现新版本` 都没出现） |
| B | 推荐 → 搜索 → 输入 `love` 回车 → 返回 | 搜出真实结果（`1, Love, SQ, mg, 徐佳莹, 03:45` …）；**按 1 次返回就回到推荐页，应用没退出** |
| C | 我的 → 收藏 → 返回 | 按 1 次返回回到「我的」，没退出 |
| D | 推荐 → 飙升榜详情 → 返回 | 按 1 次返回回到推荐页 |
| E | 推荐 → 迷你栏 → 播放页 → 返回 | 播放页关掉，回到推荐页（说明 §5.5 的 `componentIds` 判断没误伤 RNN 原生栈） |
| F | 我的页（**没有**子页面）→ 返回 | **退出应用**（`mCurrentFocus` 变成 launcher）—— 与上游行为一致，没有被误改成「多按一次才退」 |

截图 `shots/verify/bk-*.png`，每步的 uiautomator 节点 dump 在 `_backtest/`。

> **脚本自己的两个断言写错了**（不是产品问题，记下来免得下次重踩）：
> ① 用输入框的 placeholder `Search for something...` 判断「还在搜索页」——
> 一旦输入文字 placeholder 就没了，于是误判 FAIL；
> ② 用「含『在线榜单』」判断「还在推荐页」—— 榜单**详情页的表头里也有**「在线榜单」四个字。
> 结论：判定「在哪个页面」要用该页**独有**的标记，别用会被子页面继承的词。

### 4.7 第八轮（2026-10-07 晚）：推荐歌单宫格列数

改动见 §3.6。截图 `shots/verify/grid-phone-*.png` / `grid-tablet-*.png`。

| 设备 | 窗口 | 实测列数 | 封面边长 |
|---|---|---|---|
| 手机 AVD `lx_phone` | 1080×2340 @440dpi（392.7dp 宽） | **4 列** | 约 81dp |
| 平板 AVD `lx_tablet` | 2560×1600 @320dpi（应用窗口约 800dp 宽，自由窗口模式） | **5 列** | 约 240dp |

手机那 4 列截图里：封面左边缘与上方「推荐歌单」标题行的 `paddingLeft: 16` 对齐，
标题两行截断、播放量一行截断，一屏能看到 4 行 × 4 列 = 16 个歌单。

> **截图脚本又踩了一个坑（记下来）**：平板 AVD 高 1600，我第一版滑动写的是
> `input swipe 540 1600 540 700` —— y=1600 正好是**屏幕最下沿**，往上滑被系统当成
> 「回桌面」手势，应用直接退到后台，截出来的是桌面（看着像「应用崩了」）。
> 改成按屏幕高度取 `h*0.75 → h*0.35` 就好了。**别从屏幕最底部起手做滑动。**

### 4.8 第九轮（2026-10-07 晚）：搜索页

改动见 §3.7。截图 `shots/verify/search-*.png`。脚本 `_search_test.mjs`。

| # | 场景 | 结果 |
|---|---|---|
| 1 | 全新安装，打开搜索页 | 显示「热门搜索」（历史为空，因为还没搜过） |
| 2 | 输入 `love` 回车 | 左栏「歌曲」列出 `Love / SQ / mg / 徐佳莹 / 03:45` 等；右栏「歌单」是 2 列封面宫格（带 `kw`/`wy`/`tx` 来源角标）；中间一条竖线；平台选择器显示当前音源「聚合大会」 |
| 3 | 清空关键词回到空白态 | **「历史搜索」在最上面**，里面有刚搜过的 `love`（带清除按钮），下面才是「热门搜索」 |

**这一轮踩的坑（判定方法本身有问题，值得记）**：

| # | 现象 | 根因 |
|---|---|---|
| 23 | 第 2 步里「右栏有歌单结果」断言 FAIL | 我把整页可见文本拼成一行、**截断到 300 字符**再断言。左栏有十几行歌曲，右栏的文本全被截掉了 —— 断言看不到 ≠ 页面没有。**看截图才对**。 |
| 24 | 第 3 步「有历史搜索」断言 FAIL，截图里也确实没有 | 两个原因叠加：① `addHistoryWord()` 在 `search.isShowHistorySearch` 为假时**直接 return**，所以改之前根本没记过历史；② 上游 `BlankView` 把**热门搜索排在前**，而热门有三十多个词占满一屏，历史被挤到**屏幕外**。uiautomator dump **只含可见节点**，所以「dump 里没有」≠「没渲染」。改成历史在前就好了。 |

### 4.9 第十轮（2026-10-07 晚）：全面回归

改动见 §3.8 / §3.9（一次性设置迁移、去掉听书页签、启动彻底不弹协议）。
脚本 `_full_test.mjs`，截图 `shots/verify/full-*.png`。

**手机 AVD `lx_phone`（1080×2340 @440dpi）**：

| 组 | 覆盖 | 结果 |
|---|---|---|
| A | 启动后**每 5 秒轮询一次、连续 90 秒**，看有没有任何弹窗文本 | 无弹窗 |
| B | 底部页签 | 有「推荐」「我的」，**没有「听书」** |
| C | 推荐页 | 在线榜单 + 推荐歌单 |
| D | 搜索页 | 热门搜索 → 搜 `love` → 左「歌曲」右「歌单」→ 返回回到推荐页且没退出 |
| E | 我的页 | 自建歌单 + 本地音乐 / 最近播放 / 收藏 / 下载管理 / 云端音乐 五个入口 |
| F | 收藏 pane → 返回 | 回到我的页 |
| G | 榜单详情 → 返回 | 回到推荐页 |
| H | 播放页（迷你栏）→ 返回 | 回到推荐页，没退出 |
| I | 设置 → 返回 | 回到我的页 |
| J | 我的页（无子页面）→ 返回 | **退出应用**（与上游一致） |

**平板 AVD `lx_tablet`**：启动无弹窗、推荐页正常、没有听书页签。

> **A 组的做法值得抄**：不是「启动后截一张图看看」，而是**每 5 秒 dump 一次、连续 90 秒**。
> 弹窗如果是异步（网络回来才弹）或者只在某次启动出现，单张截图很容易漏掉。

### 4.10 播放链路实测（2026-10-07 晚）

之前几轮一直没验过「点歌到底能不能播」——只验过界面。补上，脚本 `_play_test.mjs`。

做法：搜 `love` → 点左栏第一首歌 → 等 20 秒 → 截图 + 读 logcat。
判定不看界面（搜索页是子页面，**底部栏是隐藏的**，看不到迷你栏），而是看系统侧的证据：
`logcat` 里 `MediaPlayerList` 会读我们 App 的 MediaSession。

| 检查 | 结果 |
|---|---|
| 弹「后台运行权限设置提醒」 | 没有（见 §5.6 第四个弹窗） |
| 弹「通知权限提醒」 | 没有 |
| 弹「获取播放链接失败」 | 没有 |
| MediaSession `state=PLAYING` | 有，10 条 |
| 播放进度在推进 | `position 32 → 357` —— **确实在出声，不是「假装播放」** |

> **踩到的坑（很值得记）**：第一次跑时断言「迷你栏出现歌名」FAIL，我一度以为播放坏了。
> 实际上**播放是好的**，只是截图里弹着那个「后台运行权限设置提醒」把界面盖住了 ——
> 而这张截图正是发现 §5.6 第四个弹窗的唯一线索。
> 教训有两层：① 判定「有没有播」要用系统侧证据（MediaSession/position），别用界面文案；
> ② **断言失败时先看截图**，可能失败本身就是发现新问题的入口。
>
> 另外注意：**搜索页是子页面，底部两条栏（迷你栏 + 页签栏）是隐藏的**
> （`Shell.tsx` 里 `{!subPage && ...}`）—— 这是照着鸿蒙 `HdsNavDestination` 的整屏子页面做的，
> 不是 bug。所以「从搜索结果点歌之后看不到播放栏」是有意为之；
> 想在子页面也显示迷你栏，把 `<MiniBar>` 从那个 `{!subPage && ...}` 条件里挪出来即可
> （Shell 是「内容 flex:1 + 底部固定块」的列布局，挪出来内容区会自动让位，不用改各页的 padding）。

### 4.11 第十一轮（2026-10-07 晚）：内置音源

改动见 §3.10，实测报告见 `SOURCE-TEST-REPORT.md`。**全程串行**（一次一个源、源与源之间歇 6 秒）。

**Node 测试台**（61 个脚本 / 36 个去重候选）：每个源声明平台逐个真调一次 + **假 id 再调一次**
（识别占位音频），拿到地址再 `Range` 实取并核对文件总长。

**真机逐源验证**（`_urlcheck.mjs`，判定 = 会话在播 + 设备上解析到的地址按 128kbps 折算
时长 ≥ 歌曲真实时长的 60%）：

| 源 | 平台 | 歌曲 | 设备解析到 | 判定 |
|---|---|---|---|---|
| HYWmusic_beta_公益测试（默认） | tx | 00:34 | 1.33MB/128k | ✅ |
| HYWmusic_beta_公益测试 | kw | 00:34 | 11.45MB/128k | ✅ |
| HYWmusic_beta_公益测试 | mg | 03:57 | 3.62MB/128k | ✅ |
| 星海音乐源 | kw | 03:30 | 3.21MB/128k | ✅ |
| 星海音乐源 | mg | 03:32 | 3.24MB/128k | ✅ |
| lx-玉宁熙-Pro | kg | 01:22 | 1.26MB/128k | ✅ |
| 屿溪-终章 | wy | 05:01 | 4.60MB/128k | ✅ |

**全面回归（`_full_test.mjs`，全新安装路径）32/32 PASS**：手机 A–J（含新增的
「设置 → 自定义源列出 5 个内置源」）+ 平板 K。

> **这一轮踩的坑（判定方法本身有问题，值得记）**：
>
> | # | 现象 | 根因 |
> |---|---|---|
> | 25 | 上一轮实测「只有 Huibq 能用」，这轮发现它 kg/tx/mg 返回的是**同一首歌以外的固定文件** | 脚本在解析失败时返回**占位音频**，照样 `HTTP 206 audio/mpeg`，只验「取到音频字节」验不出来。修法：**假 id 对照** |
> | 26 | 测试夹具喂的是搜索结果的新格式 `musicInfo`（`meta.songId`） | 脚本实际收到的是 `toOldMusicInfo()` 转过的旧格式（`songmid/hash/strMediaMid/...`）→ 脚本拿到一堆 undefined，结论全错 |
> | 27 | 真机点歌后「播放卡住」：position 停在几百毫秒 | **这台模拟器的音频输出是慢速播放（约 1/30 实时）**——旧包 83 一样、两台 AVD 一样、重启也没用。上一轮「position 32→357」其实也是慢速。改用与播放速度无关的证据：`buffered position` / 解析地址的文件总长 |
> | 28 | `dumpsys media_session` 取到别的应用的会话（buffered=0） | 它是「每个 session 一块」的输出，要按 `package=cn.toside.music.mobile.harmony` 定位块、再在块内找 `state=PlaybackState` 行 |
> | 29 | 多条命令用 `;` 串起来跑，只有最后一条生效且日志只有它 | **cmd.exe 不认 `;` 分隔**，`>` 只作用于最后一条。用 `&&` 或分开跑 |


### 4.12 第十二轮（2026-10-07 晚）：音效

改动见 §3.11。在 AVD `lx_phone` 上真点了一遍（`_sfxcheck.mjs`），
判定分两类：**界面**（uiautomator 找得到、点得动）和**系统侧**（效果器真挂上了没）。

| 项 | 判定 |
|---|---|
| 设置页有「音效」分组 / 「启用音效」开关 / 「关闭」选项 | ✅ |
| 10 个系统预设全部列出（标准 古典 舞曲 原声 民谣 重金属 嘻哈 爵士 流行 摇滚） | ✅ |
| 「摇滚」可点选、选中态正确 | ✅ |
| 「低音增强」「环绕声」两条滑杆 | ✅（「环绕声」在折叠线以下，要滑一下才进 uiautomator 的可见节点） |
| 开始播放后**效果器自动挂到播放会话**（`dumpsys media.audio_flinger`） | ✅ `equalizer=…ce772f20… bassboost=…8631f300… virtualizer=true` |
| 播放后再进设置页不再提示「开始播放后自动生效」 | ✅ |

> 「效果器真挂上了」这一条是这一轮**最关键的证据**——它同时证明了
> 「RNTP 补丁能拿到 session id」和「会话出现后自动重挂」这套设计是通的，
> 而不是只把设置存下来了事。

> 本轮踩的坑：
>
> | # | 现象 | 根因 |
> |---|---|---|
> | 30 | `_sfxcheck.mjs` 报「找不到低音增强/环绕声」 | uiautomator 只 dump **可见**节点，这两行在屏幕外 → 断言前先 `swipeUp()` 滑到可见 |
> | 31 | 从二级设置页点底部页签没反应 | 设置是 push 上去的页面 → 先 `input keyevent 4` 返回再点 |
> | 32 | `dumpsys media.audio_flinger` 里 session 号对不上 | 文档里贴的 UUID 是**效果库**的，会话号要看挂载行；判据用「UUID 出现在会话挂载列表里」而不是比对 session 数字 |

---

## 五、性能优化（2026-10-07）

一轮**只改开销、不改行为**的优化。先把移植层的热点普查一遍（哪些组件在什么时候重渲染、
哪些 `memo` 被无效 props 打穿），再按收益排序动手 —— **没有改任何界面与数据逻辑**。
回归验证截图：`shots/verify/2026-10-07-opt-*`（首页 / 榜单详情 / 我的 / 收藏）。

### 5.1 改了什么（按收益排序）

**① `getTokens` 从「每次现拼新对象」改成「恒定引用」**（`src/harmony/tokens.ts`）

这是根子。`src/harmony` 里有 **29 处 `useTokens()` 调用点**，此前每次 render 都拿到一个
`{ ...LIGHT, isDark }` 现拼出来的**新对象**。代价不只是「多一次分配」——它让所有以 `t`
为依赖的 `useMemo` / `useCallback` **每次失效**，把 `t` 或 `t` 派生的对象传给 `memo`
子组件也等于**没 memo**。现在只在切深浅模式时才换引用。

**② 迷你栏的进度订阅下沉到叶子组件**（`src/harmony/MiniBar.tsx`）

播放进度约 **每秒一次**（`core/init/player/playProgress.ts` 的
`BackgroundTimer.setInterval(getCurrentTime, 1000 / playbackRate)`）。
此前是 `MiniBar` 自己订阅 ⇒ **整条迷你栏（封面 + 歌名/歌手 + 三个控制钮）每秒重渲染一次**，
而里面真正每秒会变的只有封面底下那条 2px 进度。
现在拆出 `memo(MiniProgress)` 单独订阅，迷你栏主体只在「换歌 / 播放暂停 / 展开态 /
窗口宽度」变化时重渲染。

**③ 三个列表：稳定 `renderItem` + 行 `memo` + `data` 数组 memo**

`Panes.tsx`（收藏 / 最近播放 / 本地音乐）、`OnlineDetailPage.tsx`（榜单 / 歌单详情）、
`RecommendPage.tsx`（推荐歌单）此前都是这个毛病：

- `renderItem` 写成内联函数，行内 `onPress` 又是捕获 `index` 的新闭包 ⇒ `FlatList`
  每次父组件重渲染都判定「渲染方式变了」，把**可见行整批重渲染**（长列表里成百上千次）；
- `data={songs.map(...)}` 每次 render 造一个**新数组**，`FlatList` 认为数据整体变了。

现在：行抽成 `memo` 组件、回调由行自己带 `index` 去调（`Panes` 的 `SongRowItem`、
详情的 `DetailRow`、推荐的 `PlaylistRow`），`renderItem` / `keyExtractor` /
`columnWrapperStyle` 用 `useCallback` / `useMemo` 稳定住，`data` 用 `useMemo`，
`keyExtractor` 去掉下标参与（`${id}-${i}` → `id`）。

**④ `CoverArt`：hash 循环改 `useMemo`，并修掉一处让 `memo` 失效的内联 style**

- `paletteOf(name)` 是按歌名跑的 hash 循环，此前**每次 render 都重跑**；`initialsOf` 同理。
- `RecommendPage` 传给 `memo(CoverArt)` 的 `style={{ width: '100%', height: '100%' }}` 是
  **内联字面量** ⇒ 浅比较每次都判定 style 变了，`memo(CoverArt)` 形同不存在。
  已提成模块常量 `FILL`。

**⑤ `FlatList` 虚拟化参数**

`windowSize` 默认值是 **21** —— 一次留住 21 屏的行。三个列表都显式收到 11，并给
`initialNumToRender` / `maxToRenderPerBatch`。历史上限 300 条、详情页会一直分页累加，
收窄后常驻的行视图明显变少。

**⑥ `Shell` 的子页面 `onBack` 用 `useCallback`**（子页面宿主是 `memo` 的，
内联箭头函数会把它的 `memo` 打穿）。

> **没有给 `getItemLayout`**：多列时「第几个 = 第几行」要按列数换算，行外还挂着一条 0.6 的
> 分割线，算错会让滚动条与内容错位 —— 收益不抵这个风险。

### 5.2 量化

| 项 | 优化前 | 优化后 |
|---|---|---|
| Hermes bundle | 2689780 B | 2691484 B（**+0.06%**，没有膨胀） |
| `src/harmony` 的 `useTokens()` 调用点 | 29 处，每次 render 都拿新对象 | 恒定引用 |
| 播放中迷你栏重渲染 | 约 1 次/秒，且重建整条栏 | 只有那条 2px 进度重渲染 |
| 三个列表的 `renderItem` / `data` | 每次父组件 render 都新建 | 引用稳定 |
| 列表 `windowSize` | 21（默认） | 11 |

### 5.3 评估后**故意没改**的（附理由）

- **`MinePage` 的 `ScrollView` + `userList.map`（无虚拟化）**：改成 `FlatList` 要把整页
  重构成「头卡 + 数据行 + 尾卡」，嵌套滚动还得额外处理；而自建歌单实际就几条，
  收益远小于回归风险。
- **`components/common/Image.tsx` 的 `memo` 比较器**（按引用比 `style`，且忽略
  `resizeMode` / `cache`）：这是**上游底座**的共享组件，改它会影响全应用（含本次没验的页面）。
- **`CoverArt` 换成底座带缓存的 `Image` 封装**：底座那个封装在「无图 / 失败」时会渲染它自己的
  `LX` 占位，会把 `CoverArt` 精心做的「渐变块 + 首字母」兜底层盖掉；而 Android 侧 RN 的
  `Image` 本来就是 Fresco 自带磁盘缓存，`cache` 字段只对 iOS 生效 ⇒ 收益不抵破坏观感。

### 5.4 没测到的（重要）

**没有做真机帧级 profiling。** 两个原因：模拟器是软件渲染（swiftshader），帧时数据不代表真机；
而「1 Hz 进度」那条路径要真的播放才会触发，那会打到上游音源 —— 按用户的硬约束不做。
所以 5.1 的收益是**结构性**的（谁在什么时候重渲染、有多少次无谓重建），不是帧率数字。
要看真实数字，可以加一版临时插桩（把渲染计数打到 logcat），在真机上放一首歌跑 30 秒、前后对比。

### 5.5 返回键（用户反馈后**已修**）

**症状**：在子页面（搜索 / 榜单详情 / 我的里各个二级页）按系统返回键，**直接退回手机桌面**，
而不是返回上一层。用户原话：「比如我搜一个东西 然后点返回 居然直接回到了手机桌面 而不是上一层」。

**根因**：底座的返回键链路是

```
NavigationActivity(OnBackPressedCallback)
  → ReactGateway.onBackPressed()
  → ReactInstanceManager.onBackPressed()      // RN
  → emitHardwareBackPressed()  →  JS 的 hardwareBackPress 事件
        ↑ 只有**所有** JS 监听者都返回 false 时才继续往下
  → invokeDefaultOnBackPressed()
  → navigator.handleBack()  // pop RNN 原生栈
  → 栈里没得 pop → super.onBackPressed() → Activity finish() → 回到桌面
```

鸿蒙壳层的子页面是壳层自己的 `subPage` **状态**，不是 RNN 的原生栈 ——
所以原生栈里没得 pop，返回键一路走到 `finish()`。而 `src/harmony` 里**完全没有**
`BackHandler`（鸿蒙版这里是 `HdsNavDestination` 自带返回键）。

**修法**（`Shell.tsx`，约 12 行）：给 `hardwareBackPress` 挂一个监听，
有开着的子页面就先关掉它并返回 `true`；否则返回 `false`，交回系统（退出应用，与上游一致）。

**⚠️ 关键点：必须判断「首页是不是当前唯一挂载的页面」**

```ts
if (Object.keys(commonState.componentIds).length > 1) return false
```

播放页 / 歌单详情是 RNN `push` 上去的**独立屏幕**。RNN **不会卸载下层屏幕**，
所以首页的 React 组件（以及它挂在 RN 全局 `BackHandler` 上的这个监听器）**依然活着**。
少了这个判断，在播放页按返回会被壳层吞掉。底座自己的
`screens/Home/Views/Setting/index.tsx` 用的就是同一个判断，这里照抄。

### 5.6 弹窗（用户反馈后**已全部去掉**）

用户前后提了两次：「还有每次打开都有提示弹窗 也去掉」「每次打开的弹窗也去掉」。
查下来一共**四个不同的来源**，其中最后一个是真正的「每次」：

| 弹窗 | 触发条件 | 为什么「每次」 | 修法 |
|---|---|---|---|
| **「发现新版本」** | 启动时 `checkUpdate()` 拿本包 `1.9.1` 比上游最新版 | 本移植版**永远落后于上游**（上游已 2.x）→ 永远不「最新」 | `CHECK_UPDATE_ON_STARTUP: boolean = false` |
| 「谨防被骗提示」 | `cheatTip()`，点过会写 `@cheat_tip` | 反复重装 APK 清数据 → 每次都弹 | `SKIP_CHEAT_TIP: boolean = true` |
| 「许可协议」 | `common.isAgreePact` 为 false 时弹 | **点弹窗外面关掉不会写回 true** → 下次还弹 | `SHOW_PACT_MODAL_ON_STARTUP: boolean = false` + 顺手把 `isAgreePact` 落盘成 true |
| **「后台运行权限设置提醒」**（忽略电池优化）<br>**「通知权限提醒」** | **首次播放**时 `core/player/player.ts` 的 `handlePlay()` 调 `checkIgnoringBatteryOptimization()` / `checkNotificationPermission()` | 上游**只有点「不再提醒」才会记住**，点「我就不」不写任何东西 → 每次启动后的第一次播放都再弹。**开了「启动后自动播放」就等价于每次打开都弹** | `SKIP_PERMISSION_TIPS: boolean = true` 直接不弹；同时把「所有按钮都记住」这个 bug 一起修了 |

> 前三个在启动路径上，第四个在**播放**路径上 —— 一开始我只查了启动路径（`core/init`），
> 所以漏了它。**查「弹窗」不能只查启动代码**：用户说「每次打开」，很可能是因为
> 他开了自动播放，或者一打开就去点歌。
>
> 第四个是靠**实测发现的**：在搜索结果里点一首歌，截图里就弹出来了。
> 光读代码（我 grep 的是 `showIgnoreBatteryOptimizationTip` 这个名字）根本没找到 ——
> 函数实际叫 `checkIgnoringBatteryOptimization`。

四个开关都是显式的 `boolean` 常量，想恢复上游行为逐个改回即可。

**「许可协议」的两道保险**：`config/defaultSetting.ts` 把默认值改成 `true` **只对全新安装生效**
（见 §3.8），所以对已装过的设备靠 `config/portMigration.ts` 强制迁移一次；
代码层面 `core/init` 也彻底不再调 `showPactModal()` —— 不管存的是什么值都不弹。

**去掉第四个的代价**（已写进 `安装说明.txt`）：不再引导用户把应用加进「忽略电池优化」白名单，
部分国产 ROM 可能在后台掐掉播放。需要的话让用户自己去
「系统设置 - 应用 - 洛雪音乐（移植版）- 电池」设成「不受限制」。

---

## 六、代码结构

```
lxmusic-android/
├─ src/harmony/               ← 本次移植新增（鸿蒙 UI 的 RN 实现）
│  ├─ tokens.ts               色板 44 token + 圆角/字号常量（对应鸿蒙 color.json + Theme.ets）
│  ├─ useTokens.ts            跟随深浅模式的 hook
│  ├─ Layout.ts               宽屏适配算法（对应鸿蒙 ui/Layout.ets）
│  ├─ icons.ts                图标语义映射（对应鸿蒙 ui/Icons.ets）
│  ├─ Glass.tsx               玻璃层（对应 ui/Glass.ets 的降级形态）
│  ├─ BottomFade.tsx          底部渐隐蒙层
│  ├─ LxIcon.tsx              图标组件（对应 ui/Icons.ets 的 IconGlyph）
│  ├─ CoverArt.tsx            封面 + 三种占位（对应 ui/Widgets.ets）
│  ├─ SongRow.tsx             歌曲行
│  ├─ MiniBar.tsx             迷你播放栏（对应 views/MiniBar.ets）
│  ├─ TabBar.tsx              悬浮页签栏
│  ├─ Shell.tsx               应用壳层（对应 pages/Index.ets）
│  ├─ SubPageHost.tsx         子页面宿主（对应 HdsNavDestination：设置 / 关于）
│  ├─ PlayerTheme.tsx         播放器深色主题覆盖（播放器恒为深色）
│  ├─ RecommendPage.tsx       推荐页（对应 views/RecommendView.ets）
│  ├─ MinePage.tsx            我的页（对应 views/MineView.ets）
│  ├─ OnlineDetailPage.tsx    在线榜单 / 歌单详情（对应 views/OnlineListView.ets）
│  ├─ Panes.tsx               二级列表页：收藏 / 最近播放 / 本地音乐 / 下载 / 云端
│  ├─ playHistory.ts          播放历史（底座没有，移植层自己持久化一份）
│  └─ builtinSources/         内置音源（首次启动自动装好）
│     ├─ index.ts             清单 + 安装/默认选中规则
│     └─ scripts/*.ts         脚本原文（由 tools/gen-builtin-sources.mjs 生成，勿手改）
├─ HARMONY_UI_SPEC.md         ← 从鸿蒙源码提炼的完整 UI 规格（2401 行，实现依据）
├─ shots/                     ← 手机 / 平板实测截图
├─ tools/                     ← 辅助脚本（内置音源生成、RNTP 音效补丁、postinstall）
├─ android/app/src/main/java/cn/toside/music/mobile/audiofx/  ← 音效原生模块（见 §3.11）
└─ src/…                      ← 安卓版原有代码（仅按需改动，见下）
```

**对安卓版原有代码的改动**（尽量小）：

| 文件 | 改动 |
|---|---|
| `android/app/build.gradle` | **`applicationId` 改为 `...mobile.harmony`**（与原版共存，见 §2.1）；产物名加 `-harmony` |
| `android/app/src/main/AndroidManifest.xml` | 深链接**同时注册** `lxmusic://` 与 `lxmusic-harmony://` |
| `android/app/src/main/res/values/strings.xml` | 应用名改为「洛雪音乐（移植版）」 |
| `src/config/constant.ts` | **`APP_PROVIDER_NAME` 同步改为 `.harmony.provider`**（必须跟 applicationId 一致）；新增 `playHistory` / `langUserChosen` 存储键 |
| `src/core/init/deeplink/index.ts` | 解析时剥掉两个 scheme（`lxmusic-harmony://` 不以 `lxmusic://` 开头，只 replace 后者会解析错位） |
| `src/theme/themes/createThemes.js` | 新增 `lx_red` / `lx_dark` 两个主题 |
| `src/config/defaultSetting.ts` | 默认主题切到洛雪红；新增 `harmonyShell` 开关 |
| `src/core/init/index.ts` | 内置音源安装/自动选中 + 播放历史初始化 |
| `src/harmony/builtinSources/` | **内置音源**（`index.ts` + `scripts/*.ts`，由 `tools/gen-builtin-sources.mjs` 从 `tools/builtin-sources-src/` 生成） |
| `tools/builtin-sources.manifest.json` | 内置音源清单（slug → 脚本路径 + 实测覆盖平台） |
| `SOURCE-TEST-REPORT.md` | 2026-10-07 音源串行实测报告（61 个脚本 / 36 个候选 → 内置 5 个的依据） |
| `src/core/init/i18n.ts` | 英文系统默认给简体中文 + 存量 `en_us` 纠正 |
| `src/utils/message.ts` | 新增 `isThrottleError()`（识别各脚本的限流文案） |
| `src/core/music/utils.ts` | 限流时**停止换源重试** |
| `src/core/player/player.ts` | 限流重试放宽到 30–60 秒；连续 3 次失败弹窗提醒 |
| `src/screens/Home/index.tsx` | 按开关走鸿蒙壳层或原界面 |
| `src/screens/Home/Views/Setting/components/{Section,CheckBoxItem,SubTitle}.tsx` | 壳层开启时走鸿蒙样式（圆角卡片 + 开关 + 分隔线） |
| `src/screens/Home/Views/Setting/settings/Basic/Language.tsx` | 记下「用户主动选过语言」 |
| `src/lang/*.json` | 补 4 个文案键 |
| `src/types/app_setting.d.ts` | 补 `harmonyShell` 类型 |
| `src/screens/Home/Views/Setting/settings/Basic/` | 新增界面壳层开关项 |
| `android/.../java/cn/toside/music/mobile/audiofx/` | **音效原生模块**（`AudioEffectModule` + `AudioEffectPackage`，均衡器/低音增强/环绕声，见 §3.11）；`MainApplication.java` 里注册 |
| `android/app/src/main/AndroidManifest.xml` | 新增 `MODIFY_AUDIO_SETTINGS` 权限（音效需要） |
| `node_modules/react-native-track-player`（由脚本打补丁） | 暴露播放器 audio session id：`tools/patch-trackplayer-audiosession.mjs`（幂等，`--revert` 可还原；已挂到 `postinstall`） |
| `tools/postinstall.mjs` | `npm i` 后自动重打上面那个补丁，失败只警告不阻断 |
| `src/utils/nativeModules/audioEffect.ts` | 音效原生模块的 JS 封装 |
| `src/store/soundEffect/` | 音效状态（`{state,action,hook}.ts`，`soundEffectUpdated` 事件） |
| `src/core/soundEffect.ts` | `refreshSoundEffectStatus` / `applySoundEffect` / `releaseAllSoundEffect` |
| `src/screens/Home/Views/Setting/settings/Basic/SoundEffect.tsx` | 设置 → 基础设置 → 「音效」分组 |
| `src/core/player/player.ts` | 每次开始播放补一次 `applySoundEffect()`（会话出现时会自动重挂，这是保险） |
| `src/lang/*.json` | 补音效文案（17 键 × 3 语言） |
| `src/config/defaultSetting.ts` / `src/types/app_setting.d.ts` | 补 4 个 `player.soundEffect*` 设置项 |

---

## 七、已知边界（不假装有功能）

1. **听书**：鸿蒙版的书源引擎（阅读/Legado JSON 规则）与音乐音源是两套协议，本次未移植，
   页面给明确空态。
2. **收藏歌单**（收藏线上歌单）：该能力在安卓版底座里没有对应实现，给明确空态。
3. **子页面**（本地音乐 / 最近播放 / 下载管理 / 云端音乐 / 设置等）：沿用安卓版原有页面，
   **内容层未重做**；壳层入口已按鸿蒙的「我的」页结构组织好。
4. **全屏播放器 / 播放列表**：沿用安卓版已有的封面页+歌词页结构（与鸿蒙设计一致），
   未逐像素重做。
5. **玻璃模糊**：RN 无系统材质，悬浮栏退化为实底（原因见 §3.3 与规格文档 6.8）。
6. **音效的听感无法在模拟器上验证**：模拟器音频是慢速播放的（§4.11 的 #27），
   只能验「效果器确实挂到了播放会话上」（`dumpsys media.audio_flinger`），
   好不好听要真机戴耳机自己调。另外设备没这个效果库时模块会把原因显示在设置页，不会崩。
7. **音效依赖一处 `node_modules` 补丁**（§3.11）：`npm i` 后必须重打（已挂 `postinstall`）。

---

## 八、构建环境（本机已就位）

本机原本**没有 JDK / 没有 Android SDK / 没有 Gradle**，本次一并搭好：

| 组件 | 位置 | 说明 |
|---|---|---|
| JDK 17 | `D:\android-tools\jdk17` | Gradle 运行时（RN 0.73 强制 `jvmToolchain(17)`，**JDK 21 会失败**） |
| Android SDK | `D:\android-tools\sdk` | platform-tools / android-36 / build-tools 35 / NDK 26.1 / cmake |
| git | `D:\android-tools\git` | 拉取 4 个 git 依赖所必需 |
| Gradle 缓存 | `D:\android-tools\gradle-home` | |
| 模拟器 | AVD `lx_phone` / `lx_tablet` | Android 14 x86_64 |

构建脚本：`D:\android-tools\build-android.ps1`（已配好国内镜像加速）。

---

## 九、许可证

沿用洛雪音乐的 **Apache License 2.0**（见 `LICENSE`）。
本项目不含任何音频内容；播放地址由使用者自己导入的音源脚本解析。
