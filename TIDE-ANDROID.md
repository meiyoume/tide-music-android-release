# 潮汐界面 × 洛雪安卓版内核

把**潮汐界面**（纯 HTML/CSS/JS 的手机版音乐 UI）接到**洛雪安卓版内核**上，
得到一个能真正播放的音乐 App。播放、音源、搜索、榜单、歌单、歌词全部复用内核，
界面只负责显示与控制。

- 界面工程（可独立预览）：`C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\`
- 本工程内的落点：`src/tide/`（桥接）+ `android/app/src/main/assets/tide/`（界面资源）

---

## 一、为什么是 WebView

安卓版底座是 React Native，界面本来是 RN 组件。有三条路：

| 方案 | 工作量 | 判定 |
|---|---|---|
| 把潮汐界面重写成 RN 组件 | 六套皮肤、全部动效、全部布局都要用 RN 样式重做一遍，且以后两边各自漂移 | ✗ |
| 用 WebView 承载现成的 Web 界面，音频仍走原生 | 只写一层桥；界面原样保留 | ✓ **采用** |
| 把内核逻辑搬到 Web | 要重写音源、播放、缓存，等于换内核 | ✗ |

关键点：**音频不由 WebView 播放**，仍由内核的 `react-native-track-player` 负责，
所以后台播放、通知栏、锁屏控制、音效这些原生能力全部不受影响 —— WebView 只是块画布。

---

## 二、架构

```
┌──────────────────────────────────────────────────────────┐
│ RN App                                                   │
│                                                          │
│  Home (src/screens/Home/index.tsx)                       │
│   └─ tideShell 开 → <TideShell/>                         │
│        ├─ <WebView source=file:///android_asset/tide/>   │
│        └─ 原生设置页浮层（点「洛雪原生设置」时压上来）      │
│                                                          │
│  src/tide/bridge.ts                                      │
│   ├─ handle(cmd, args)  界面 → 内核                      │
│   └─ subscribe(emit)    内核 → 界面                      │
│        ↓ 复用                                            │
│  core/player · core/list · core/search · core/leaderboard│
│  core/songlist · core/hotSearch · plugins/player         │
│        ↓                                                 │
│  react-native-track-player（真正出声的地方）              │
└──────────────────────────────────────────────────────────┘
```

### 通信协议

界面 → 原生（`window.ReactNativeWebView.postMessage`）：

| 消息 | 说明 |
|---|---|
| `{id, cmd, args}` | 需要回执的命令，原生用 `TideNative.reply(id, ok, data)` 回 |
| `{cmd, args}`（无 id） | 不需要回执：`navState`、`openNativeSettings`、`toast` |
| `{cmd:'__log'}` | 界面控制台输出，转发到原生日志 |

原生 → 界面（`injectJavaScript`）：

| 调用 | 说明 |
|---|---|
| `window.TideNative.reply(id, ok, data)` | 命令回执 |
| `window.TideNative.event(name, payload)` | 事件推送 |
| `window.TideGoBack()` | 返回键交给界面处理 |

命令表（`bridge.ts` 的 `commands`）：
`init` `home` `charts` `chartDetail` `playlistDetail` `library` `search` `hot` `tips`
`history` `addHistory` `clearHistory` `play` `toggle` `next` `prev` `seek`
`setMode` `like` `queue` `queuePlay` `lyrics` `toast`
`square` `collectList` `share` `createPlaylist` `bootBg` `theme`
`soundEffect` `soundEffectSet`

其中 `tips` 是搜索联想词，`soundEffect` / `soundEffectSet` 是播放音效（见 §四）。

无回执消息：`navState`（返回键状态）、`openNativePage`（请求打开原生页面）、`__log`（控制台转发）

事件：`player`（歌 + 播放态 + 进度 + 模式 + 收藏）、`progress`、`lyrics`、`queue`、`toast`、
`chartCovers`（榜单封面按需补齐后逐条推，见下）、`homePlaylists`（首页「为你精选」后台取到后推，见下）

### 榜单封面是异步补的（v1.9.13 起改成按需）

各平台的**榜单列表接口都不带封面图**（只有 id 和名字），所以榜单卡片原本只能是纯色块 ——
这就是「榜单没有封面」的根因。

`charts()` 只返回带渐变键的列表（界面用渐变 + 首字水印占位），**封面由界面按需来要**：
界面渲染完榜单网格后，用 `IntersectionObserver` 盯着卡片，进入可视区（含上下 240px 余量）
就把 id 批量发给 `chartCovers` 命令；内核那边没缓存的丢进队列，**全局固定 2 路**，
取到一个就 `chartCovers` 推一个，界面贴上去。滚到哪取到哪。

- 为什么要按需：酷我的榜单是 **43 个**（`kw/leaderboard.js` 的 `boardList`），
  以前 `charts()` 一进来就把 43 个榜的首页全排上队。实测冷启动的 44 个网络请求里
  43 个都是它，从 +3.5s 一直占到 +7.5s，和首屏那条数据请求抢带宽。
  改成按需之后：**冷启动只剩 1 个请求，进榜单页首屏只发 6 个**。
- 队列在 `createTideBridge` 闭包里（`coverQueue` + `coverWorkers`），不是每次调用起两个 worker ——
  界面滚动会分批发好几次请求，各自起 worker 的话并发数会随滚动累加。
- 缓存：`boardCoverCache`，进程内有效；`boardCoverPending` 让同一个榜的并发请求只发一次。
- 拿不到封面就保持渐变，不影响其它榜单。
- `getBoardsList` / `getListDetail` 都是**内置平台接口**，不是用户自定义音源，
  但同样只开 2 路，不给接口压力。

### 首屏不等网络（v1.9.13）

`home` 原来把「歌单广场第一页」和「收藏列表」一起 `await` 再返回，而歌单广场那条
酷我请求在模拟器上实测要 **4 秒多** —— 界面 `await Tide.home()` 之后才开始写 DOM，
于是整屏空等 4 秒。

现在 `home` 只读本地库（收藏列表），歌单广场交给 `loadHomePlaylists()` 后台取，
取到推 `homePlaylists` 事件，界面把占位的空卡换成真卡（占位卡是为了不让下面的
「猜你喜欢」被整体推下去）。

页面侧实测（`[TideWeb] t+` 埋点，`app.js` 起算）：

| | v1.9.12 | v1.9.13 |
|---|---|---|
| 首帧 | ~130ms | ~67ms |
| `home` 返回 | 4617ms | 155~246ms |

> 埋点用法：`adb logcat | findstr "t+"`。注意 **logcat 的时间戳会滞后**
> （RN 的 JS 线程被占住时 `console.log` 会攒着一起发），
> 所以要看的是 `t+` 里的数字，不要拿 logcat 时间戳相减。

### 启动底色是「三层同色」

开 App 时有三层会先后露出来，任何一层颜色不对都会看成闪屏：

| 层 | 谁画的 | 怎么定色 |
|---|---|---|
| 系统启动窗口（`onCreate` 之前） | `AppTheme` 的 `android:windowBackground` | `tide_boot_bg`，**跟着系统深浅色走** |
| RN 根视图 / 窗口背景 | `MainActivity.onCreate` + RNN 的 `componentBackgroundColor` | 存下来的界面主题底色，**但「跟随系统」时按系统重算** |
| WebView 首帧 | `index.html` `<head>` 里的内联样式 | 同上；写死明暗时才用 localStorage 的 `tide.bootBg` |

界面每次换主题/皮肤都会 `syncBootBg()`：把当前 `--bg` 写进
`<html>` 的行内样式 + localStorage + 通过 `bootBg` 命令写进原生的 SharedPreferences。
所以浅色主题的用户启动时看到的是浅色，深色主题看到的是深色，不会翻色。

**系统启动窗口这一层只能跟系统走**（`values/` 浅色 + `values-night/` 深色）：
它是 `onCreate` 之前由系统按 manifest 主题画的，读不到 SharedPreferences。
以前这里钉死成深色 `#0A0B0F`，于是「系统浅色 + 界面浅色」的用户每次打开都会
**深色闪一下再变浅**（实测启动录帧里就是这一下）。钉死深色的初衷是防白闪，
但那只在界面主题和系统不一致时才发生，属于少数情况，不划算。

配套的两处改动：

- 默认主题从 `dark` 改成 `system`（`store.get('theme', 'system')`）。
  不这么改的话，全新安装的用户在浅色系统上会拿到「浅色启动窗口 + 深色界面」，
  反而每次打开都闪 —— 比原来更糟。
- `index.html` 的内联脚本在样式表之前就把 `system` 用 `matchMedia` 解成具体明暗，
  否则第一帧会按 `<html data-theme="dark">` 画成深色再翻成浅色（那是页面内的另一层闪）。

#### 主题模式要一起存（v1.9.14）

**光记颜色不够。**「跟随系统」时颜色会随系统变：用户关机时把手机切成深色，
存下来的还是浅色底 —— 下次启动系统启动窗口已经是深色（`values-night`），
RN 根视图却用那份**过期**的浅色，屏幕上就是「深 → 浅 → 深」闪两下。

所以 `TidePrefs` 多存一个 `bootBgMode`（light / dark / system），三处各自按模式判：

| 位置 | 「跟随系统」时怎么做 |
|---|---|
| `MainActivity.applyBootBackground()` | **不覆盖窗口底色** —— AppTheme 的 `windowBackground` 本来就带 `values-night`，已经是当前系统的颜色 |
| `bootBg.ts` 的 `getTideBootBackground()` | 用 `Appearance.getColorScheme()` 取系统深浅，拿默认主题的底色（问不到才退回存下来的） |
| `index.html` 的内联脚本 | 不信存下来的底色，走 `data-theme` 规则的默认底色（与 `values-night` 一致） |

写死明暗时三处都照旧用存下来的颜色 —— 那份是准的，而且带着皮肤色
（比如「午夜」浅色是 `#F5F3FB` 而不是默认的 `#F4F5F8`）。

> XML 注释里不能出现两个连字符，`values-night/colors.xml` 写注释时踩过这个坑：
> 编译报 `注释中不允许出现字符串 "--"`。

#### 最后那一下「闪」是内容一下子跳出来（v1.9.14）

三层同色之后，用户仍然说「开软件还是闪一下黑屏（白天闪白）」。
在模拟器上按「App 跟随系统」跑了一遍启动录帧：**全程只有一种颜色，没有任何翻色** ——
所以剩下的「闪」不是颜色不对，是**内容一下子跳出来**：

RN 那层铺的是纯底色，WebView 的第一帧直接就是整屏界面（问候语、卡片、底栏），
中间没有任何过渡，看着就是「闪一下」。

改法是让界面淡入：`index.html` 的内联脚本先给 `<html>` 打上 `is-boot`
（CSS 里 `html.is-boot .app{opacity:0}`），`app.js` 在首帧（连续两次 `rAF`）后摘掉它，
`.app` 用 `--t5 / --ease` 淡出来。**关键是首帧画出来时是「纯底色」**——
和 RN 那层同色，屏幕上完全看不出切换，随后内容才从底色里浮出来。
兜底放在内联脚本里（1.5 秒），`app.js` 挂了也不会让界面一直藏着。

### 转场（v1.9.14：全站一套）

用户：「有些跳转动画比较生硬，你要统一的跳转动画」。盘下来**页签切换和退子页
是完全没有动画的**（`goTab` 直接换 `display`，`popSub` 把旧页 `remove('is-active')`），
这就是「生硬」的来源。现在每个方向都有动画，且共用一套时长与缓动：

| 动作 | 动画 | 时长 / 缓动 |
|---|---|---|
| 页签切换（同层） | 旧页淡出 + 新页淡入，都带 8px 上浮 | `--t5` (.3s) / `--ease` |
| 进子页 | 新页从右滑入（22%）；旧页**留在原地**往左退 16% 并压暗 | 同上 |
| 退子页 | 子页往右滑出；上一层从左侧回位（起点正是它退到的 -16%） | 同上 |
| 弹层 / 迷你条 | 从下滑入滑出 | 同上 |
| 播放页（整屏浮层） | 从下滑入滑出 | `--t6` (.5s) |
| 启动首帧 | 内容淡入 | `--t5` (.3s) |

两个关键点：

- **旧页不能一下子藏起来**。以前进子页是把上一层 `remove('is-active')`，
  新页滑入时左边 22% 会露出一整块纯底色 —— 看着就是「跳」。现在上一层用
  `is-behind` 留在屏上退到左边，退子页时正好从那个位置滑回来（`pushBack`
  的起点和 `behindOut` 的终点对齐，不然会对不上）。
- **同一时刻只能有一个 `.screen.is-active`**。`is-behind` / `is-leave` / `is-pop`
  都是「还在屏上但不再是当前页」，所以都要把 `is-active` 摘掉 ——
  `currentScreen()` 取的是文档里第一个 `is-active`，留着的话返回键会认错页。

剩下的不一致只有一种：用户在深色系统里手动选了浅色（或反之）。静态资源无法预知，
只能靠 `MainActivity.applyBootBackground()` 在 `onCreate` 里读 SharedPreferences 覆盖
**窗口**底色 —— 那已经晚于系统启动窗口了。

`TidePrefs`（`utils/TidePrefs.java`）走 SharedPreferences 而不是 AsyncStorage，
是因为 `MainActivity.onCreate` 必须**同步**拿到颜色，异步来不及。
RN 侧同步读回走 `UtilsModule.getConstants()` → `NativeModules.UtilsModule.bootBackground`
（见 `src/tide/bootBg.ts`）。

### 冷启动到底慢在哪（v1.9.13 实测）

`am start -W` 的 `TotalTime` / `Displayed` 只有 **0.7~1.3 秒**，剩下的时间全在
WebView 把第一帧画出来之前。**在模拟器上这一段主要是软件 GL**：

```
+1.70s  [TideWeb] t+13ms boot start
+5.72s  Choreographer: Skipped 238 frames!
+5.83s  OpenGLRenderer: Davey! duration=4064ms      ← 一次绘制 4 秒
+5.85s  [TideWeb] t+67ms first paint
+5.87s  [TideWeb] t+4053ms init ok                  ← init 的回执被这 4 秒挡住
```

页面自己的时间线（`t+`）说 67ms 就画好了，屏幕却要好几秒才有东西 ——
差的就是这一次软件绘制。所以：

- **别拿模拟器的「空白时长」当真实设备的指标**，那量的是 swiftshader。
- 量启动要用页面侧的 `t+` 埋点 + `am start -W`，两者都不受软件 GL 影响。
- 同理，**连续 `screencap` 抓帧会自己把被测对象压慢**（一张 0.7~0.9 秒，
  跑循环时 Choreographer 能掉几百帧）。要抓就用 `measure-launch.py sweep`：
  每档延时单独冷启动一次，只在末尾拍一张。

`tools/measure-launch.py` 的四种模式：`time`（am start + 页面埋点）、
`one <ms>`（一次启动 + 一张图 + 日志）、`sweep a,b,c`（逐档延时各一次）、
`frames n delay`（连续抓帧，会扰动，只作参考）。


### 三、播放中主线程在干什么（v1.9.16：进度条那两条过渡）

**症状**：音乐一放，界面就一直有东西在动。肉眼看不出卡，但它是个**持续**开销 ——
不是换歌那一下，而是只要在播就一直有。

**量法**：`node tools/_perf-cdp.mjs <标签>`。它自己起 Edge（`--remote-debugging-port=0`，
端口从 `DevToolsActivePort` 读），连 CDP 读 `Performance.getMetrics` 里的
`LayoutCount` / `RecalcStyleCount` / `LayoutDuration` / `RecalcStyleDuration` ——
**这几个数是渲染进程自己数的，不是估算**。四段工作负载，其中两段是对照：

| 段 | 情形 |
|---|---|
| A 空闲 | 没有歌，屏幕上没有任何东西在动 |
| B 迷你条·暂停 | 有歌、迷你条在屏幕上，但一秒也不推进度（**对照**） |
| C 迷你条·播放中 | 进度 4Hz × 3 秒 |
| D 播放页·播放中 | 同上，播放页开着 |

**C 减 B 就是「播放中那几条进度动画」的净开销。**

**根因**：进度条原来是 `width` + `transition: width .28s linear`，圆点是 `left` + 同样的过渡。
内核每秒推 4 次进度（间隔 250ms），而过渡要 280ms —— **比推送间隔还长，所以那条过渡永远跑不完**，
浏览器只能每帧都重算样式 + 重排。

```
              重排次数   样式重算   重排耗时   样式重算耗时   主线程
B 对照            0         1       0.000s     0.000s      0.003s
C 修之前        501       502       0.053s     0.051s      0.307s   ← 3 秒里占满 10%
C 修之后         13        43       0.003s     0.012s      0.068s
D 修之前        502       503       0.057s     0.072s      0.391s
D 修之后         12        38       0.004s     0.013s      0.064s
```

**改法**（三处，都在界面侧）：

1. `.bar__fill` / `.mini__bar i` 改成 `transform: scaleX()`（合成器动画，主线程一帧都不碰），
   圆角交给外层 `.bar__track` / `.mini__bar` 的 `overflow:hidden` 裁 —— 自己留 radius 的话
   横向一缩放圆头就变成椭圆头。
2. `.bar__knob` 的过渡里**去掉 `left`**：圆点平时是 `opacity:0`，给一个看不见的元素
   每 250ms 跑一次 280ms 的位移过渡纯属白烧；能看见它的两种情形（悬停 / 拖拽）位移都小到看不出来。
3. **只画看得见的那一条**：播放页开着时它整屏盖住迷你条，收起时反过来。两条都写的话
   总有一条是在给看不见的元素做重排 —— 收起态的 `.player` 是 `visibility:hidden`，
   **照样参与布局**。切换目标时补画一次（把「画哪一条」也算进重绘签名里，自动补）。

**顺手量出来的另外三处**（都不是持续开销，是「白做一遍」）：

- 换歌时 `coverGradient()` 每次 `getComputedStyle`（强制一次同步样式刷新），
  而换歌正好要连着写两处封面 → 按色键缓存，换皮肤/主题时清。
  修完 `player-change-song` 从 62ms 降到 25ms。
- 启动时 `applyTheme` 和 `applySkin` 各调一次 `syncBootBg`：白做两回 `getComputedStyle`、
  白写一遍 localStorage、白发一条桥消息 → 按「解析后的深浅色 + 皮肤」签名跳过。
  （**签名要用 `dataset.theme` 不是 `state.theme`**：「跟随系统」时模式一直是 `system`，
  系统一换深浅色 `--bg` 就变了，拿模式当签名会把这次变化吞掉。）
- 点一下页签没反应，用户往往会再点一下 —— 而 `tabLoaded` 是**等 `await` 回来才置位**的，
  那两下就各发一条一模一样的请求。改成发请求前先立标记、失败时清掉重试。
  `perf-run.py` 的 `tab-switch` 里 `charts` / `library` 的请求数从 **10 → 1**，耗时 231ms → 133ms。

> **这轮最值得记的一条**：`transform` 换成 `width` 这种「效果一样、开销差两个数量级」的地方，
> **只看代码是看不出来的** —— `width: 25%` 和 `transform: scaleX(.25)` 在屏幕上一模一样。
> 得有个能量「每帧重排几次」的量具才找得到。数 DOM 变更数也找不到（这一条压根不改 DOM 结构，
> 它改的是样式，而且是浏览器每帧自己在改）。


### 「设置」并进「我的」当一级菜单（v1.9.15）

原来是「我的」右上角齿轮 → 二级页 `scr-settings`。现在**那个二级页没有了**，
设置的分组直接长在「我的」页里（快捷格下面、歌单上面）：

```
我的（scr-library）
 ├─ 头像 / 昵称 / 收藏·歌单·下载 计数
 ├─ 快捷格：最近播放 / 本地音乐 / 我的下载
 ├─ 洛雪原生设置                     ← 设置，一级菜单
 ├─ 偏好：主题与外观 / 播放音效 / 界面音效 / 消息通知
 ├─ 数据与隐私：账号与本机数据 / 隐私设置
 ├─ 其他：关于潮汐音乐 / 帮助与反馈
 ├─ 我创建的歌单
 └─ 我收藏的歌单
```

- **位置放在歌单上面**：用户要的是「设置成为一级菜单」，放歌单后面的话歌单一多就又被埋了。
  想挪到最下面的话改 `index.html` 里那几段 `s-group` 的顺序就行。
- 齿轮按钮删了（设置就在下面，不需要第二个入口）。首页右上角那个头像原来也是进设置，
  改成切到「我的」页签（`data-tab-go="library"`）—— 点头像去自己的页面更符合直觉。
- `syncMini()` 里「设置类页面收起迷你条」的判断去掉了 `scr-settings`：**「我的」是正常页签，
  迷你条该在**，只有 `scr-set-*` 子页要收。
- 顺手清掉两处随着搬家变成死代码的东西：`me-card` 那一套（原来的「本机数据」卡片，
  信息在头像区已经有了）、底部那个**「退出登录」按钮**（点了只弹个 toast，
  而这个版本根本没有账号体系，摆在「我的」页中间更怪）。死掉的 CSS 用
  `tools/find-dead-css.py` 一起清了（它从 7 个类回到 0）。

### 搜歌单 / 音源进「我的」/ 歌单搬进收藏（v1.9.17）

用户一次提了三件，都属于「东西在不该在的地方」：

**1. 能搜歌单了。** 原来搜索页只有歌曲。内核其实一直有歌单搜索
（`core/search/songlist`，底下是各平台 SDK 的 `songList.search` —— kw/kg/mg/tx/wy 五家都有，
bd 没有），只是没人调。加了桥命令 `searchPlaylists`（跨平台聚合 `'all'`，
返回的形状和「歌单广场」完全一样），界面在搜索结果上加「歌曲 / 歌单」两个页签。

**歌单那条是单独一条请求，只在真的切到「歌单」页签时才发** —— 大部分人搜的是歌，
不该为它多等一次网络；两个页签各记一份标题，来回切不会重取、也不会把已有结果清掉。

**2. 音源切换与添加进了「我的」一级菜单。** 新增两行「音源切换」「添加歌源」，
都进原生的音源页 —— 那一页（`Setting/settings/Basic/Source`）本来就是完整实现：
列表点一下就是切换，底下那颗按钮里有「从本地导入 / 在线导入」，弹层里还能删源、看版本。
自己重做一份的话，**文件选择、脚本格式校验、重复导入、更新提醒都得再写一遍**。

- 原生侧新增 `SubPageHost` 的 `apiSource` 分支（新文件 `src/harmony/ApiSourcePane.tsx`，
  只是把 `Source` 套进 `PaneShell`，同样用延迟 `require` 不进首屏）。
- 页面名支持带参数：`apiSource:add` 是「添加歌源」那一行进来的，
  `Source` 多了个 `autoAdd`，进来直接把导入弹层弹出来 ——
  用户点的是「添加」，不该先看到一张列表再自己找按钮。
  带参数的名字在 `SubPageHost` 里按冒号前那段判标题与「这页自不自带标题栏」，
  否则会多出一条写着 `apiSource:add` 的返回栏。
- 「我的」那一行的摘要（当前用的是哪个源、共几个可选）走新命令 `apiSources`。
  **换源是在原生页里发生的，界面那层盖在下面，切回来不会重新走一遍 `goTab`** ——
  所以桥订阅了内核的 `apiSourceUpdated` 事件，换完主动推一份 `apiSources` 给界面。
- 注意：洛雪 1.9.1 的官方音源清单 `api-source-info` 是**空数组**，能用的源
  （见 §二「内置音源」）都在 `userApi` 的 list 里，所以正常情况下 `builtin` 空、
  `user` 里是那 5 个内置源 + 用户自己导入的。

**3. 自建与收藏的歌单搬进了「收藏 · 歌单」页签。** 「收藏」页现在是「歌曲 / 歌单」两个页签：
歌曲 = 我喜欢的音乐（原样），歌单 = 我创建的歌单 + 我收藏的歌单（都从「我的」页搬过来），
「新建歌单」的入口也跟着搬到歌单页签的右上角。理由：自建和收藏的歌单都是「我的歌单」，
跟歌曲收藏是一类东西放一起才找得到；「我的」页留给设置。
「我的」页只留一行入口（「自建与收藏的歌单」，摘要写 `N 个自建 · M 个收藏`），
点它直接落到收藏页的**歌单**页签。

> 收藏歌单本身早就有：歌单详情页那颗「收藏」按钮（`collectList`，
> 榜单走 `collectBoard`、在线歌单走 `collectSonglist`，结果都进「我收藏的歌单」）。
> 这次只是把它和自建歌单一起摆到了用户找得到的地方。

**顺手修掉两个列表的错**（v1.9.18，是上面「搬进收藏」时翻出来的）：
搬过去之后「我创建的歌单」和「我收藏的歌单」并排放在一页上，一眼就看出两处不对 ——
根子在桥的 `library()` 里：

- **「我喜欢的音乐」原来被塞进了「我创建的歌单」**（`my` 的第一项硬编码是 `love`）。
  它有自己的「歌曲」页签，混在自建里既是重复，又让「N 个自建」比真实自建数多 1 ——
  设备上就是「我的」页统计写着 `歌单 0`、收藏页却写着 `1 个自建`。
- **收藏来的歌单会同时出现在两个小节里**：它们在内核里也是 user list（只是带
  `sourceListId`），`my` 用 `users` 全量、`fav` 再 `filter(sourceListId)`，
  于是同一张歌单显示两遍。

改法：`my` 取 `users.filter(l => !l.sourceListId)`（自建），`fav` 取另一半（收藏），
「我喜欢的音乐」两边都不放。

同轮还顺手改了一处：**「新建歌单」页进来就聚焦名字输入框**（和搜索页一样）。
原来不聚焦，用户得先点一下才能打字 —— 自动化里表现为 `adb shell input text` 没有落点、
字全丢了（所以这条是被测试逼出来的，但它是真该改的）。

### 音源页自己画 / 猜你喜欢补足 30 首 / 原生页配色（v1.9.19）

用户一次提了五件，四件是「看起来不对」、一件是「少东西」：

**1. 音源切换改成潮汐自己画的一页。** 原来是内核那页原生界面
（`Setting/settings/Basic/Source`）—— 它是给安卓版原界面做的（红竖条分组标题 +
系统字体 + 固定的绿），压在潮汐这套卡片界面里，用户的原话是「很简陋、割裂感很强」。
切换本身只有「列出音源 + 选一个」这一件事，数据接口（`apiSources` / `setApiSource`）
v1.9.17 就已经在桥里了，所以这一页自己画：

- 新子页 `scr-source`：上面一张「当前音源」卡（强调色渐底 + 大字号名字），
  下面是可选列表（点一下即切，选中那行是强调色标题 + 一个勾），
  最下面一行「添加音源」。
- **导入仍然走原生页**（`apiSource:add`）。文件选择器、脚本格式校验、重复导入检测、
  更新提醒都在那一页里，重做一遍不划算 —— 这一页里那行下面也写清了
  「用系统文件选择器」，用户不会以为是界面自己弹的。
- 切换后两处一起更新：界面自己重画一次，内核广播 `apiSourceUpdated` 时
  桥再推 `apiSources`，所以「在原生页里换的」也会让这一页和「我的」那行摘要跟着变。

**2. 「猜你喜欢」补足到 30 首。** 原来它直接显示「我喜欢的音乐」（本地库）——
用户只收藏了一首时整栏就孤零零一行（原话「猜你喜欢里面就一首歌 要三十首才对」）。
现在：收藏的歌排在前面，不够 30 首的从当前榜单补（`pickSpread` 按日期种子挑，
两页拼成一个池子、去掉已经收藏的那些）。

- 补足要拉榜单，所以**不能挡首屏**：`home()` 照旧只回本地那部分（首屏立刻画出来），
  池子取到后推 `homeLikes` 事件覆盖一次 —— 和「为你精选」那条 `homePlaylists` 同一套做法。
- **种子与「每日推荐」故意错开**（那边是 `day`，这边是 `day * 31 + 7`）：
  两处都从同一张榜里挑，同一个种子会挑出同一批歌，看着就像重复功能。
- 标题上写出首数（`猜你喜欢 30`）。写出来有两个用处：用户一眼看到数字，
  验收也能直接读它 —— 光看列表是数不出行数的（uiautomator 看不见「几行」）。
- 一首收藏都没有时先摆几条占位条，别先闪一句「还没听够」再被补足的内容顶掉。

**3. 原生子页面（洛雪原生设置 / 音源 / 评论 / 最近播放…）的配色跟着界面走。**
这些页面吃的是 `src/harmony/tokens.ts` 那套 token（原来是固定的一套「QQ 绿 + 浅灰」），
而界面有六套皮肤 + 一个可换的主题色 —— 两边不打通就是「深色界面里点设置，
蹦出一张绿底白卡的安卓版设置页」，用户说的「洛雪原生设置也没美化，ui 和软件 ui
对齐审美一致，不然很割裂」就是这个。

改法是把界面**算好的那几个颜色**推过去，而不是让原生去认皮肤名：

- 界面侧 `syncNativeTheme()` 读计算样式（`--bg` / `--card-solid` / `--text` /
  `--text-2` / `--text-3` / `--hairline`）连同深浅、主题色一起走 `theme` 命令推过去，
  按整组色值签名去重（启动时 `applyTheme`→`applySkin`→`applyAccent` 三次调用只会真发一次）。
  **卡片取的是 `--card-solid` 而不是 `--card`**：后者在深色下是 4.5% 白，
  铺到原生页面等于没有卡片。
- 原生侧 `setTidePalette()` 覆盖 harmony token 里对应那几个（bg/card/text/divider
  直接换，主题色换掉 `red`/`redTint`/`recordButton`/`iconGreen`），
  `useTokens()` 订阅它 —— 换皮肤 / 换主题色 / 切深浅时，已经挂在屏幕上的原生页面立刻重渲染。
- 只对得上深浅模式的那一组才用：界面推深色的色值、原生此刻是浅色 token 时用内置的，
  免得混搭出奇怪的颜色。
- 顺带：**同一个 `getTokens()` 必须恒返回同一个引用**（原注释里写得很清楚，
  否则 memo 全废）。所以派生出来的那份按模式缓存，只有调色板真变了才换引用。

**4. 搜索结果的封面。** 用户说「有的有封面有的没有」。根因在酷我搜索里：

```js
img: info.web_albumpic_short ? `https://img4.kuwo.cn/star/albumcover/${...}` : null,
...
img: null,        // ← 同一个对象字面量里又写了一遍，把这行覆盖掉了
```

对象字面量里重复的键**后者胜**，所以前面算出来的真封面被后面那句 `img: null` 覆盖，
酷我那一路的搜索结果每行都退化成渐变块；其它平台（kg/tx/wy/mg）自己拼封面，
所以只有一部分行没封面 —— 正好对上「有的有有的没有」。

- 已实测酷我搜索接口确实回这个字段：`web_albumpic_short` = `120/s3s94/93/211513640.jpg`，
  拼出来的 `https://img4.kuwo.cn/star/albumcover/...` 返回 200 + `image/jpeg` + 9928 字节。
- 修法就是删掉那行重复的 `img: null`（kg 的同类问题 v1.9.8 已经修过）。

**5. 「我的」页最后那行歌单入口也删了。** v1.9.17 把歌单搬进收藏时留了一行
「自建与收藏的歌单」当入口，用户这次说「自建与收藏歌单放到收藏里面，不要放我的里面」——
歌单现在只在「收藏 · 歌单」里，「我的」页一行都不留。

### 「添加音源」自己画 / 原生设置版式换成潮汐那套（v1.9.20）

用户第二次反馈，两句话：

> 原生设置还是没有变化 音源点进去三级菜单还是很割裂 没有变化 继续改

先把上一轮的效果量了一遍再动手 —— 这一步很关键，不然会白改：

- **配色确实生效了**：在设置页截图上取色，开关轨道是 `#3DCCB0` / `#3BC5AA`，
  正是潮汐的薄荷色 `#3ECFB2`，不是内核原来的 `#31C27C`。
- 所以「没变化」指的不是颜色，而是**骨架**：分组标题 17px 深色、卡片圆角 8、
  设置行高 46；而界面的对应值是 12px 浅灰小标题、圆角 22、行高 54。
  颜色再对，两套骨架摆在一起还是一眼看出不是一个应用。

**1. 「三级菜单」= 内核那个「自定义源管理（实验性）」弹层。** 从音源页点
「添加音源」原来会 `openNativePage('apiSource:add')`，弹出的就是它：
绿色头栏 + 居中标题 + 一排「允许显示更新弹窗」复选框 + 一大段免责声明 + 浅绿按钮。
现在自己画一页 `scr-source-add`，三块：

- **从在线地址导入**：地址输入框 + 「导入」。地址只填域名会自动补 `https://`
  （内核只认 `http(s)://` 开头，不补的话用户对着报错发呆）。回车等同点「导入」。
- **从本地文件导入**：一行「选择脚本文件」，落点是**系统文件选择器**
  （`AndroidScoped.openDocument`）—— 那是安卓自己的界面，不存在割裂问题，
  也不用把内核自绘的文件浏览器搬过来。
- **已装音源**：列表 + 每行一个垃圾桶。删除做成**两段式**（点垃圾桶 → 原地换成
  「取消 / 删除」两个小胶囊），免得手滑把正在用的源删了。

干活的还是桥里那三条命令，它们复用内核自己的导入/删除逻辑（`importUserApi` /
`removeUserApi` / `selectFile`），所以脚本校验、重复导入检测、更新提醒都不用重写，
报错文案也直接用内核给的：`importApiSourceUrl` / `importApiSourceFile` /
`removeApiSource`，各返回 `{ok, msg?, sources?}`。

- 用户取消文件选择器时返回 `{ok:false, cancelled:true}`，界面显示「没有选择文件。」
  而不是红字 —— 取消不是错误。
- 下载这一步**自己判状态码**：内核的 `httpFetch` 在 404 时 body 往往是空串，
  只报「下载到的内容是空的」会让人以为地址写错了地方。现在是「服务器返回 404」。

**2. 原生设置页的版式整体换成潮汐界面那套。** 新开一组常量
（`tokens.ts` 的 `SET_*`），取值逐项抄界面 `styles.css`：

| 界面类名 | 取值 | 原来的鸿蒙/QQ 版 |
|---|---|---|
| `.s-group__label` | 12px / 600 / 字距 .03em / **浅灰** | 17px / 500 / 深色 |
| `.s-group` | 圆角 22 + 1px 描边 | 圆角 8、无描边 |
| `.s-row` | 最小高 54 / 内边距 12×16 / 14.5px | 高 46 / 内边距 14×10 / 14.5px |
| `.s-row + .s-row` | 分隔线左缩进 16 | 14 |
| `.switch` | 48×29 胶囊 + 23px 白钮 | RN 原生 Switch（≈36×20）再缩到 0.9 |

- **刻意不动 `R_CARD` / `F_SECTION` / `F_ITEM`**：那几个还被 harmony 自己的页面用着
  （`MinePage` / `RecommendPage` / `SubPageHost` 共 20 处），改一处会连带改一片。
- 开关换成自己拼的 `src/harmony/TideSwitch.tsx`（两个 View + Animated）：
  RN 的 `Switch` 在安卓上是原生 `SwitchCompat`，形状尺寸都对不上，靠
  `transform: scale` 拉大还会把圆钮压成椭圆（横竖比例不同）。
- `Button` / `InputItem` / `Slider` 这三个共享组件**原来根本没有 harmony 分支**，
  一直吃内核主题（`theme['c-button-background']` 那些）—— 所以哪怕调色板推过来了，
  卡片里的按钮、输入框、滑块还是老配色，这也是「没变化」的一部分。这一轮都补了分支。
- 设置页的左右内边距 15 → 18（界面 `.scroll` 是 18），只在壳层开着时生效。

### 全面重构界面（v1.9.21）

用户这一轮只提了一句话：

> 全面重构ui 要求美观大气 简洁实用 做不到就卸载你

不是「某个页面不好看」，而是整套视觉。做法是**保留全部功能与交互钩子，重写
`styles.css` 的视觉层**：283 个 class 一个不删（`tools/_classes.py` 列出来的
清单逐项覆盖），163 项预览断言与 65 项设备断言原样通过。

**设计语言收成一套**：

- **一个强调色**：原来首页四个快捷入口、设置页八个图标各配一套渐变
  （`q-a..q-d` / `i-a..i-h`），现在是同一种强调色浅底 + 强调色图标；
  class 钩子保留，以后想单独调还在。
- **两级表面**：页面底 + 卡片（`--card` + 1px hairline），不再到处叠第三种底色。
- **三级字号**：页面标题 30/700（原 27）、分区标题 17.5/650（原 18）、正文 15/550；
  说明文字 12.5。
- **留白**：页面左右 20（原 18）、分区之间 34（原 28）、设置行 56（原 54）、
  卡片圆角 24/30（原 22/28）。
- **头像**：从皮肤封面渐变（粉紫）改成强调色字母牌 —— 上一版解决了
  「像图片没加载」，但粉紫圆在只有薄荷色的界面里仍然抢眼。
- **播放页**：封面 318、底部六个动作摊开、进度条 4px；结构没动。
- **歌单详情**：封面 132 在左、标题/作者/简介在右（grid 三行），比原来
  150px 封面竖着堆在顶上紧凑。
- **音源页的「添加音源」**：它不在分组里，给 `.scroll > .s-row` 一张自己的卡片，
  免得悬空。
- 版本查询串 `?v=16` → `?v=17`，防止 WebView 吃旧 CSS。

**验证**：预览 `tools/ui-check.py` **163 项全过**（断言没改一行）；
设备 `tools/verify-fx-tips.py` **65 项全过**；亮/暗两套、360/411 两种宽度
逐屏截图（`shots/v2-*.png` / `v2d-*.png`）。设备上还复核了「更大气」带来的
可见行数变化（见坑 57）。

### 播放页重做 / 歌词切换动效（v1.9.22）

用户这一轮说的是两件事：

> 播放页面很难看 全面整改 切换歌词的时候动画很生硬 全面加强动效

**「生硬」的真因不是过渡太短，是根本没有过渡**：旧版 `.lyrics` 用
`display:none` 和封面互斥，`display` 不能过渡，所以点下去就是硬切。这一版把
两态改成同一套层叠结构，用 `opacity / transform / visibility` 交叉淡入淡出。

**播放页视觉**：

- **背景是这首歌的真封面**，不是皮肤渐变。`setPlayerBg()` 把
  `song.pic` 写进 `.player__bg` 的 `background-image`（后面垫一层
  `coverGradient()` 兜底），再 `blur(56px) saturate(1.4)`、`scale(1.15)`，
  所以每首歌的底色跟着封面走。没封面/加载失败时退回皮肤渐变。
- **黑胶唱片** `.player__disc`：344px 圆盘从封面后面探出一圈，conic +
  repeating-radial 画纹路，中心是强调色标签；播放时才转（`.player__art.is-beat
  ~ .player__disc`），30s 一圈。它比封面大，所以 `.player__stage` 故意不裁切。
- **顶部层级**：`.player__meta::before` 用 `content:'正在播放'` 做 9.5px /
  0.22em 的小字眉题；标题 20px/700，歌手 12px。
- **提示做成玻璃胶囊**（`.player__hint`），不再是一行裸字；点胶囊本身也能切。
- **进度条**：4px，填充改成强调色渐变 + 外发光，`transform:scaleX()` 驱动。
- **底部六个动作**从一排图标变成「图标 + 9.5px 标签」（收藏/评论/下载/音效/
  分享/队列），用 `::after` 的 `content` 写标签，DOM 不动。
- **入场分层**：`.player.is-open` 时 top/stage/hint/progress/controls/bottom
  以 0.02/0.06/0.12/0.16/0.2/0.24s 的延迟依次 `playerRise`（16px 上浮 +
  淡入），而不是整页一起出现。
- **背景缓慢漂移** `bgDrift` 26s alternate；黑胶 `discSpin` 30s linear；
  播放键有强调色光晕。全部走 `transform/opacity`，不碰布局。

**歌词切换**：

```css
.lyrics{
  opacity:0; visibility:hidden; pointer-events:none;
  transform:translateY(22px) scale(.975);
  transition:opacity .6s var(--ease), transform .6s var(--ease),
             visibility 0s linear .6s;   /* 退场等淡出完再藏 */
}
.lyrics.is-on{
  opacity:1; visibility:visible; pointer-events:auto;
  transform:none;
  transition:opacity .6s var(--ease), transform .6s var(--ease), visibility 0s;
}
.player__art.is-hidden{
  transform:scale(.82) translateY(-18px); opacity:0; filter:blur(12px);
}
```

同时 `.player__stage.is-lyrics::before` 把封面后面的强调色光晕淡掉，
`.player__art.is-hidden ~ .player__disc` 让黑胶跟着封面一起退场。当前行
`.lyric.is-on` 从 15px/500 长到 18px/700、变白、加 28px 强调色光晕；
非当前行保持 0.28 白、`scale(.97)`。

`toggleLyrics(force)` 除了切 `.lyrics.is-on` 和 `.player__art.is-hidden`，
现在还要切 `#playerStage.is-lyrics` 并改提示文案；点歌词区域、点提示胶囊都能切。

**验证**：预览 `tools/ui-check.py` **170 项全过**（新增 8 项歌词断言：进入后
歌词 opacity > .95、`pointer-events:auto`、封面与黑胶 opacity < .05；退出后
两者恢复）；设备 `tools/verify-fx-tips.py` 新增「点提示进歌词 → 提示变
『轻点歌词返回封面』→ 点歌词回封面」两项，和原有 65 项一起跑，**67 项全过**。

### 搜索 / 榜单 / 歌单的平台选择器（v1.9.23）

用户这一轮说的是：

> 有很多bug 你要全面修复 比如搜索界面不能改音源等

根因是**原生页有、潮汐抄漏了**：原生搜索页顶栏有一个 `SourceSelector`
（kw / kg / mg / tx / wy / all），潮汐搜索页只有输入框；榜单页与歌单广场
也只读内核设置（`leaderboard.source` / `songList.source`），界面上没有入口。
这次三处补同一套 chip：

- **搜索源**：全部 / 酷我 / 酷狗 / QQ / 网易云 / 咪咕，选择写回内核
  `search` 设置（`source` + `temp_source`），原生搜索页与潮汐共用一份；
  搜到一半切源会按新源自动重搜；`tips` 也带上当前源（只有酷我真有 tipSearch，
  其余平台回空、用本地历史/热搜兜底）。
- **榜单平台**：写回 `leaderboard.source`，副标题从写死的「共 12 个榜单」
  改成实际数量 + 平台名（酷我 8 个、酷狗 8 个……接口给多少写多少）。
- **歌单平台**：写回 `songList.source`，切完重拉第一页。

**搜索页顺手修的四个状态 bug**：

1. **停在「歌单」页签搜新词，再切回「歌曲」是空白**：旧 `runSearch` 在 list
   页签只取歌单就 `return` 了，`setSearchTab` 又只补歌单。现在 `searchSongFor`
   记「这个词的歌曲取过没有」，切回歌曲时懒加载。
2. **还没搜就显示「已经到底啦」**：`#searchFoot` 原来在空查询时也 `hidden=false`。
   现在默认 hidden，只在当前页签有结果时显示；空结果/失败也不显示。
3. **只能看第一页**：搜索桥原来写死 `page:1`。现在 `search` / `searchPlaylists`
   接受 `page`，底部给「加载更多」；内核回的是**累积后的完整列表**，界面整段
   重画并保留滚动位置。标题用内核的 `total`（搜「jay」会写「找到 3291 首」，
   而不是只写当前页那几十行）。
4. **点完平台 chip 后打字打空**：chip 把焦点从输入框拿走了。`setSearchSource`
   切完把焦点还给输入框 —— 真机验收脚本点完 chip 直接 `input text`，不还焦点
   就一个字都打不进去（这轮设备测试的两条 FAIL 就是它）。

桥新增 `searchSources` / `setSearchSource`、`chartSources` / `setChartSource`、
`squareSources` / `setSquareSource`；`search` / `searchPlaylists` / `charts` /
`square` / `tips` 都接受 `source`（搜索还接受 `page`）。版本查询串 `?v=18 → ?v=19`。

**验证**：预览 `tools/ui-check.py` **193 项全过**（新增 23 项：搜索源 6 个
chip、切源传桥、切源自动重搜、加载更多、歌单页签懒加载、榜单/歌单平台选择器、
副标题数量）；设备 `verify-fx-tips.py` 新增搜索源两项，并加了只跑搜索页的
`search` 短流程（`python tools/verify-fx-tips.py search`）。

### 原生页面浮层

界面上那些内核里已经有现成实现的入口（洛雪原生设置、音源、最近播放、本地音乐、下载管理、
新建歌单）不在 Web 里重做，而是发 `openNativePage`，由 RN 用 `SubPageHost` 整屏压在 WebView 上。
这样内核设置的增删会自动跟着底座走，不用两边同步。

### 列表的传递方式

界面**不搬运原始歌曲对象**。原生每交出一份列表就发一个 token，
界面只拿 `token + 下标` 回来点播（`{cmd:'play', args:{token, index}}`），
原生凭 token 找到原始 `musicInfo` 数组去 `setTempList`。token 只留最近 40 个。

id 前缀约定（界面与原生共用）：
`board:<source>__<bangId>` 榜单 · `sl:<source>:<id>` 在线歌单 · `ul:<listId>` 自建歌单 · `love` 收藏

---

## 三、怎么用

```powershell
# 1. 改了界面之后，先同步进 assets（否则 APK 里还是旧的）
node tools/sync-tide-assets.mjs

# 2. 打包
powershell -NoProfile -ExecutionPolicy Bypass -File D:\android-tools\build-android.ps1 arm64-v8a assembleRelease        # 真机
powershell -NoProfile -ExecutionPolicy Bypass -File D:\android-tools\build-android.ps1 x86_64 assembleRelease           # 模拟器
```

> ⚠️ **两条命令不要混用**（坑 47）：`-PreactNativeArchitectures` 决定 CMake 为哪个 ABI
> 编原生库，而那个「universal」包只是把 `lib/<abi>/` 下**现有**的文件都打进去 ——
> 用 arm64 构建产出的 universal 包在 x86_64 模拟器上缺 `libquickbase64.so`，
> 一进搜索页就弹「Unexpected error occurred」。**模拟器装 `x86_64` 那个包**
> （单 ABI 的 versionCode 更低，`adb install` 要加 `-d`）。
> 打完包先跑 `python tools/check-apk-assets.py`，确认 APK 里的界面就是刚改的那份。

> 界面源目录可以用环境变量改：`TIDE_UI_SRC=D:/path/to/ui node tools/sync-tide-assets.mjs`

### 三个壳层，逐级回退

「设置 - 基础设置」里有两个开关，优先级从高到低：

1. **使用潮汐界面（WebView）** —— `tideShell`，默认开
2. **使用鸿蒙界面** —— `harmonyShell`
3. 都关掉 → 洛雪安卓版原界面

界面出问题时不用改代码，在设置里关掉就能退回上一个能用的壳层。

### 界面侧的几个开发工具（都在 `music-ui-mobile/tools/`，不进 APK）

| 脚本 | 干什么 |
|---|---|
| `make-perf-harness.py` → `perf-run.py before\|after` | 量界面开销：DOM 变更数 / 桥消息数 / 同步耗时 |
| `_perf-cdp.mjs` + `cdp-bridge.js`（v1.9.16 新加） | 用 CDP 读 `Performance.getMetrics`，量**主线程重排 / 样式重算的次数与耗时**（见 §二之三）。比数 DOM 变更更接近「流畅度」，而且有对照段 |
| `sfx-check.py` | 把 4×10 个音效离线渲染成 PCM，量峰值 / 有效值 / 尾长 / 亮度 |
| `make-sfx-audition.py` | 生成桌面单文件试听页（可直接双击） |
| `shots-features.py` | 无头 Edge 拍这一轮新界面（播放音效面板 / 搜索联想）→ `shots/feat-*.png` |
| `playfx-probe.html` | 量播放音效面板在两个入口的内边距与横向溢出（真跑，不靠截图） |
| `sfx-tabs-diag.html` | 查「点了页签内容换了、页签高亮没动」这类状态不一致 |
| `preview.html` + `preview-shots.py` | 无头 Edge 截图，看某个页面的样子（支持 `clicks` / `type` 驱动） |
| `fetch-eq-presets.py` | 重抓 VLC / AutoEq 的预设，跟 `soundEffectPresets.ts` 里的数字逐条对比（上游更新时用） |
| `verify-fx-tips.py` | 在模拟器上按可见文字真点，验收播放音效 + 搜索联想 + 「我的」设置行 + 音源页（含真换一次源）+ **添加音源页（真下载 + 真导入 + 两段式删除）** + 收藏页签 + 搜歌单 + 猜你喜欢首数 + **原生设置页行高**。**点页面里的行要用 `tap_row`（会在点之前先把它滑进屏幕），点底栏页签要用 `tap_last`，点音源行要用 `tap_source_row`，点某行的垃圾桶要用 `tap_src_trash_of`，点地址输入框要用 `tap_src_url_input`** —— 全是踩出来的，见坑 43/44/47/49/50/51 |
| `check-apk-assets.py`（v1.9.19 新加） | 逐字节比 APK 内 `assets/tide/*` 与界面源目录的 SHA256。**打完包先跑它**，别让「改了界面忘了同步」骗到设备验收 |
| `check-bundle.py`（v1.9.19 新加） | 查 APK 里那份 `index.android.bundle`（Hermes 字节码，**代码搜不到、只有字符串表是明文**）：按字符串字面量确认桥的改动在里面（`homeLikes`/`setTidePalette`/`web_albumpic_short`），再比关键源文件的 mtime 是否都早于 APK |
| `check-pick-spread.mjs`（v1.9.19 新加） | 验 `pickSpread` 不会死循环（21 项）。**从 `bridge.ts` 抽源码**再跑，不是抄一份，见坑 48 |
| `_probe-v1920.py`（v1.9.20 新加） | 只拍「洛雪原生设置」与「添加音源」两页，并 dump 后者的节点 —— 改这两页时几十秒就能看一眼 |
| `_probe-addsrc.py`（v1.9.20 新加） | 只走「我的 → 添加歌源 → 填地址 → 导入 → 删除」这一段（可 `--keep` 不重启 App，也可直接传一个 URL 做对照），调验收脚本时比跑整条 flow 快得多 |
| `_hdrcheck.py`（v1.9.20 新加） | 起一个会**打印请求头**的本地服务，用来判定那条 GET 到底是谁发的（App 的 fetch 带 `Chrome/69` 的 UA + `Accept: application/json`，WebView 不是） |
| `_netcheck.py`（v1.9.20 新加） | 查模拟器的网络：宿主机的 10.0.2.2 通不通、有没有外网、有没有 `curl`/`wget`（`toybox` 里没有，只有 `nc`）。排查「服务端说 200、App 说连不上」时先跑它 |
| `_shot.py <名字>`（v1.9.20 新加） | 拍一张当前屏幕到 `shots/dev-<名字>.png`（改脚本时最常用的一步） |
| `_crashes.py`（v1.9.20 新加） | 把 logcat 里每条 `FATAL EXCEPTION` **翻译成进程名**（还看它往下几行有没有 `Process:`）。区分「应用崩了」和「uiautomator 自己崩了 / 系统应用崩了」 |
| `_emu-up.py` / `_emu-wait.py`（v1.9.20 新加） | 起模拟器（带 `ANDROID_AVD_HOME`，日志写到 `_emu-restart.log`）/ 等它启动完。见坑 56 的两个参数坑 |
| `_mem.py`（v1.9.20 新加） | 看一眼宿主机可用内存。打包 OOM 时先跑它（见坑 55） |
| `measure-launch.py`（在**本仓库** `tools/`） | 量冷启动：`time` / `one <ms>` / `sweep a,b,c` / `frames n delay`，见 §二「冷启动到底慢在哪」 |
| `_launch-requests.py` / `_charts-requests.py`（同上） | 数启动、进榜单页时内核发了几个网络请求（查请求风暴） |
| `_launch-applog.py`（同上） | 把 App 自己进程的 logcat 全量按时间打出来（不做关键字过滤） |
| `check-ids.py` / `find-dead-css.py` | 静态校验：id 与入口是否都能解析、CSS 有没有死类 |
| `audit-entries.py` / `remove-sections.py` | 找重复入口 / 整段删掉一个 `<section>` |
| `ui-check.py` + `ui-check.html` | 在预览里走一遍真实路径并断言**可见结果**（v1.9.20 是 161 项，见 §六） |
| `layout-probe.html` + `probe-run.py` | 量元素 rect 与视口宽，判「有没有横向溢出」（别靠截图右边缘，见坑 18） |
| `shot-states.py` | 截「要点几下才到得了」的界面（`preview.html?clicks=a\|b\|c`） |

---

## 三之二、应用图标（桌面图标 / 启动时的那个图标）

**Android 12 起，系统启动画面上的图标就是应用图标** —— 所以「启动时看到原版洛雪的绿音符」
和「桌面上图标是原版」是同一件事：`android:icon` 指向的那套资源没换过。

图标一共 **12 个文件**，换的时候必须一起换：

| 文件 | 用途 |
|---|---|
| `res/mipmap-{mdpi..xxxhdpi}/ic_launcher.png` | 老系统（API 21–25）的方图标，5 个尺寸 48/72/96/144/192 |
| `res/mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png` | 同上，圆形（四角真透明，不是画个圆上去） |
| `res/drawable/ic_launcher_foreground.xml` | 自适应图标（API 26+）的前景：**只有白色音符** |
| `res/drawable/ic_launcher_bg.xml` | 自适应图标的底：青蓝渐变铺满 108dp |
| `res/mipmap-anydpi-v26/ic_launcher{,,_round}.xml` | 把上面两个拼成 `<adaptive-icon>`，另带 `<monochrome>`（Android 13+ 主题图标） |

几何源文件是 `tools/icon/tide-icon.svg`（与桌面版 `_icon/icon.svg` 同一套，青蓝渐变 + 白音符 + 一道浪）。
改完跑：

```powershell
python tools\icon\make-android-icons.py   # 重出 10 张 PNG（无头 Edge 渲染 + Pillow 缩放/裁圆）
python tools\icon\preview-adaptive.py     # 出 adaptive-preview.png：叠圆形/圆角/方形蒙版看效果
```

两条经验：

- **自适应图标里不能放那道浪**。安全区只有中心 66dp 的圆，浪的两端在 512 视口里
  落在半径约 185 处（安全区只有 156.4），圆形蒙版会把两个头切掉 —— 第一版就是这么翻车的，
  看 `adaptive-preview.png` 才发现。现在自适应图标只用音符，浪留在没有蒙版的方版位图里。
- **★ 矢量的 viewport 是 512，不是 108 —— 换算必须在 512 空间里做**。
  前景的 `viewportWidth=512` 会被映射到 108dp 画布上，所以「居中到 54dp」不是写
  `translate(5.28,12.86)`，而是要把 1 视口单位 = 108/512 dp 代进去算。
  第一版直接把 108 画布里的位移写进 512 坐标系，音符被缩到左上角 17dp 的角落 ——
  真机上只剩一个渐变圆，**而且模拟图看着完全正常**，因为模拟图的 viewBox 用的是 108，
  两边根本不是同一个坐标系。现在模拟图的 viewBox 与 group 和矢量文件逐字一致，
  红虚线圆（半径 156.4 = 33dp）是判断「会不会被切」的唯一依据。
  顺带：渐变坐标也跟着视口走，模拟图里写成 108 空间的 (5.4,0)-(102.6,108) 会只剩左上角一块色。
- **换算写在矢量文件的注释里**（包围盒 → 最远墨点 → scale → 居中位移那几行）。
  这次是靠「离中心最远的墨点是琴梁右上角，距中心 207.3」定出 scale = 156.4/207.3 = 0.7545，
  不写下来下次只能靠试。
- 顺带删掉了 `res/drawable-*/launch_screen.png` 10 张（原版洛雪白底 logo 的启动图）
  和 `values/ic_launcher_background.xml`（原版那个 `#31C27C` 绿底）—— 全仓库搜过，
  **没有任何引用**，启动窗口底色走的是 `@color/tide_boot_bg`。

> 验收要连「桌面上的样子」一起看：`adb shell input keyevent 3` 回桌面、上滑进抽屉、截图，
> 再放大裁图看图标本身。只看 APK 里有没有那几张 PNG 是不够的 —— 这次 PNG 全对、
> 自适应矢量却是坏的，桌面上就是一块纯色圆。

**应用名**：`res/values/strings.xml` 的 `app_name`，现在是「潮汐音乐」。
原来叫「洛雪音乐（移植版）」—— 后缀是为了跟原版洛雪共存时能一眼区分（两个 applicationId 不同、
可以同时装）。图标换成潮汐的之后不需要后缀了，改回干净的名字；系统层面（桌面 / 最近任务 /
应用信息 / 通知）都跟着变。
**没改的是内核自己的文案**：设置里的「关于」等页面走 `src/lang/*.json` 的 i18n，
仍然是上游的名字 —— 那属于内核的身份，不在这次范围内。

---

## 四、接了什么，没接什么

### 已接通内核

- **首页**：歌单广场第一页 →「为你精选」（含真实封面图与播放量）；收藏列表 →「猜你喜欢」
- **每日推荐**：首页那张大卡点进去是一个真的列表页（`scr-daily`，`daily` 命令）。
  内容是从当前榜单的第一张榜里按日期挑 30 首，同一天进来是同一批，「换一批」换下一组。
  **不写「根据你的口味」**——洛雪没有账号体系，拿不到听歌画像，所以页头上写的是
  「今天来自「飙升榜」」。原先这张卡是 `data-play-likes`：点一下只是开始播放、
  什么都不打开，收藏为空时更是连提示都没有（见 §五 第 23 条）。
  取的是榜单的**前两页**拼起来再挑：一页常常就只有 30 首，只取一页的话
  「可选池」正好等于「输出」，「换一批」点了会一动不动（实测踩到过）。
  池子不够 30 时命令会回 `canShuffle: false`，界面把按钮置灰，
  而不是让用户点了发现没反应。
- **歌单广场**：首页「为你精选 · 全部」进一个子页面，按分类标签轮换「换一批」
- **榜单**：内核内置榜单表 + 详情（真实歌曲列表）+ **榜单封面（取该榜第一首歌的专辑图）**
- **搜索**：`search(text, 1, 'all')` 全源搜索，结果可直接播放
- **歌单详情**：在线歌单 / 自建歌单 / 收藏，播放全部、**收藏整单、分享**
- **新建歌单**：界面里输入名字 → `createUserList` → 回「我的」页并刷新列表
- **播放**：`setTempList` + `playList`，走底座现成的 `listAction`（会先播当前页再补齐完整列表）
- **播放页**：真实封面（`meta.picUrl`）、歌手、专辑、进度、歌词（`lrc` + `tlrc` 翻译）、
  收藏、随机/单曲循环、进度拖拽、**分享当前歌曲**
- **播放队列**：读 `LIST_IDS.TEMP`
- **我的**：我喜欢的音乐、自建歌单、收藏的歌单、统计数字
- **底部页签**：推荐 / 榜单 / **收藏** / 我的。
  搜索**不是页签**了 —— 由首页顶部那个搜索框进入一个子页面（进去就聚焦输入框，
  带返回栏）；原来的页签位置给了「收藏」，即「我喜欢的音乐」，
  可以播放全部，每次切到这个页签都重取一次，红心改过之后不会看到旧列表。
- **外观**：六套皮肤、深色/浅色、主题色 —— 这套由界面自己管，存 WebView 的 localStorage
- **界面音效**：点击 / 切页签 / 翻页 / 收藏 / 播放暂停 / 切歌 / 成功 / 失败，四套音色包
  （清透 / 木质 / 电子 / 柔和）+ 开关 + 音量 + 试听。**全部用 Web Audio 现场合成**，
  不带任何音频文件，见下面「音效为什么是合成的」
- **播放音效**：真正改歌的声音的 DSP —— 均衡器预设 + 低音增强 + 环绕声 + 响度增强 + 环境混响。
  走内核的 `soundEffect` / `soundEffectSet`，落盘在内核设置里，原生 `AudioEffectModule`
  把它挂到**播放器自己的音频会话**上。见下面「播放音效的两条路子」
- **搜索联想**：搜索框边打字边给候选词（在线补全 + 本地历史/热搜），点候选直接搜。见下面「搜索联想」
- **原生页面浮层**：洛雪原生设置 / 最近播放 / 本地音乐 / 下载管理 / 帮助与反馈

### 音效为什么是合成的

`assets/tide/sfx.js` 里没有采样，只有振荡器与包络。四条理由：

1. **安装包不变大**。四套音色包一共 20 KB 代码；换成采样至少几百 KB，还要按皮肤挑音色。
2. **不碰版权**。网上抓的 UI 音效来源不明，合成出来的每一个音都是自己算的。
3. **不需要解码器**。Web Audio 直接进音频线程，没有「第一次响要加载」的延迟。
4. **换音色包只是换三支函数**（`tone` / `click` / `sweep`），加一套不用重新打包素材。

信号链：`每支 voice → bus →（干声 + 混响送出）→ master → 软削波 → 低通 → 输出`。
混响是现场生成的一段 0.55 秒衰减噪声，软削波是 `tanh` 曲线 ——
同时叠十几个音也不会数字爆音，只会自然压缩。

三个约束写在代码里：**AudioContext 必须在用户手势里解锁**（安卓 WebView 尤其严格，
所以在 `pointerdown` 就先解，而不是等 `click`，否则第一次点击是哑的）、
**同时发声数封顶 14**（一路狂点不会压住音频线程）、**任何异常都吞掉**
（出不了声可以，影响界面不行）。

`tools/sfx-check.html` 是试听页（也用于校验）：`?check=1` 会把 4×10 个组合逐个
用 `OfflineAudioContext` 渲染成 PCM，量峰值 / 有效值 / 尾长 / 过零率 ——
不看「函数有没有被调用」，看波形。当前 40 个组合全部有声、不削顶、尾长 0.24–0.58 秒。
（事件表里原本还有一个「提示」音，但它在原生侧没有触发点 —— 桥根本没有推 `toast`
事件，只有演示后端推。没有触发点的音效等于死代码，删掉了。）

平台跟随内核设置：榜单用 `getLeaderboardSetting().source`，歌单广场用 `getSongListSetting().source`，
不再硬编码 `kw`（用户在原生界面切过平台后，潮汐这边也会跟着走）。

### 播放音效的两条路子（v1.9.12）

均衡器预设走两条路，但**共用一套下标空间**，所以界面上是同一个列表、存同一个下标：

1. **设备预设**（10 个）—— 安卓效果库自带那套（标准 / 古典 / 舞曲 / …），下标直接交给原生 `usePreset`；
2. **开源自带的曲线**（37 个）—— 不走 `usePreset`，而是把 10 段曲线插值到**这台设备**的频点上，逐段 `setBandLevel`。

分界线是 `soundEffectState.devicePresetCount`：下标 ≥ 它的就是自定义曲线。内核设置页直接渲染
`soundEffectState.presets`（设备预设 + 自定义），所以那边不用改结构就能看到并选中开源曲线。

**开源的 37 条曲线**（`src/utils/soundEffectPresets.ts`，数字全是抓下来的原值，没有一条是编的）：

| 组 | 条数 | 来源 | 许可 |
|---|---|---|---|
| 经典均衡 | 18 | VLC 的 `modules/audio_filter/equalizer_presets.h` | LGPL-2.1-or-later（VLC authors / Laurent Aimar） |
| 耳机校正 | 19 | AutoEq 的 `results/…/<型号> FixedBandEQ.txt` | MIT（Jaakko Pasanen） |

两家的频点不一样（VLC 是 60/170/310/600/1k/3k/6k/12k/14k/16k，AutoEq 是 ISO 的 31.25…16k），
所以 `mapCurveToBands` 按**对数频率**插值到设备频点上。

**削顶保护**——安卓的 Equalizer 没有 VLC 那种单独的 preamp，提升太多会爆音。两家处理方式不同：

- AutoEq 的 `Preamp` 本来就是**削顶补偿**（正好抵掉最大提升），直接叠进去，结果全是衰减，天然安全；
- VLC 的 `f_preamp` **不是**补偿，而是它自己「Global gain」滑块的默认值
  （`equalizer.c` 里选预设只是 `var_SetFloat("equalizer-preamp", preset->f_preamp)`），
  所以不采用；改成整条曲线下移，使最大提升不超过 +6 dB —— 形状不变，只是绝对电平低一点。

**设备只有几段**：常见机型是 5 段（60 / 230 / 910 / 3600 / 14000），跟 10 段曲线对不上，
插值出来是**近似形状**而不是逐段复刻，这是硬件限制。段数取自原生 `describe()` 报的 `bandCenters`，各机型自适应。

**响度增强 / 环境混响**是另外两个 AOSP 效果器（`LoudnessEnhancer`，0–1200 毫贝；`PresetReverb` 7 档里取 6 档），
和均衡器并联挂在同一个会话上。

⚠️ **效果器必须挂在播放器自己的 audio session**（`AudioSessionHolder`，由打了补丁的 RNTP 发布）。
session 传 0 会被系统当成全局输出混音，那样连微信语音、视频的声音都会被改掉 ——
拿不到会话时**宁可不生效**。

界面侧：播放页的音效弹层和「设置 → 播放音效」是**同一份状态、同一份模板**
（`app.js` 的 `pfTemplate()` 生成到每个 `[data-playfx]` 里），改哪边都一样。
弹层里分成「播放音效 / 界面音效」两个页签 —— 两者名字里都有「音效」，
不分开的话连用户都会搞混（这一版之前就混过一次）。

### 搜索联想（v1.9.12）

`tips` 命令打的是内核各家 SDK 自己的 `tipSearch`（酷我那个是 `tips.kuwo.cn/t.s`）。
⚠️ **只有酷我（kw）**在 `musicSdk/<平台>/index.js` 里真挂上了，kg / mg / tx / wy 那几家都被注释掉了，所以：

- 在线候选取不到（或平台不支持）时命令回空数组，界面**不白等**；
- 界面同时给**本地候选**：搜索历史 + 热搜里含当前输入的那些 —— 0 延迟、离线也有，
  而且自己搜过的词命中率往往比在线补全还高。

顺序是先用本地候选画一版，250ms 后再补在线候选，并用序号丢掉过期回包
（打字快时先发的可能后到，不丢会把新词的结果盖回去）。问哪个平台看 `search.temp_source`
（内核搜索页用的也是它），不是 `source`。

**顺带改掉的一个问题**：原来搜索框是「停 350ms 就直接搜」，等于每打一个词都发一次完整搜索请求。
现在改成「先出联想词，回车或点候选才真搜」——少发请求，也是各家音乐 App 的通行做法。
联想列表第一行永远是「搜索原文」，所以用户打的字本身照样能直接搜。

### 没接通（别当它有）

- **和内核设置重复的页面已经删掉**：「播放与音质」「下载设置」「存储与缓存」三个子页
  连同设置页里的入口一起移除 —— 「洛雪原生设置」里都有真身，潮汐界面不再重复做一遍。
  设置页底部那句说明现在直接指向原生设置。
  同理删掉了「我的」页底部那个和右上角齿轮重复的「设置」行、
  和首页重复的「私人 FM」快捷格（该行列现在是三列）。
- 潮汐界面里「账号与安全」「消息通知」「隐私设置」**只有界面、没有内核行为**。
  洛雪没有账号体系，这三页是原型阶段的界面资产（不是重复，所以留着）。
  **但假数据一律清掉了**（v1.9.8）：账号页原来写着昵称、`138****6620`、「微信 已绑定」、
  「当前 3 台设备在线」，全是编的，现在整页改成「这个版本没有账号系统 + 本机真实数据」；
  消息通知与隐私两页底部各加一句「这一页的开关目前不生效 / 只是展示」——
  说清楚比装得像真事好。
- 音质、下载、缓存、同步、桌面歌词这些**真正的内核设置**，走设置页里的
  **「洛雪原生设置」**（整屏压上原生设置页）。**音源单独拎出来了两行**
  （v1.9.17：用户要求进「我的」一级菜单），落点同样是原生页面，见上文。
- **整单下载 / 单曲下载**：内核没有可复用的公开下载入口（下载逻辑在原生列表菜单里），
  界面上这两个按钮只给一句说明性提示，不做假动作。
- **歌曲行上的「…」已经删掉**（v1.9.8）：原来点它只弹一句「歌曲操作菜单」，而这个移植里
  没有「对任意一首歌」的内核动作（收藏、加队列都只对**当前播放**的那首生效）。
  行本身就是播放，留一个什么都不做的「…」比没有更差。要做的话得先在桥里加
  `addListMusics` 一类的命令。
- 点通知栏进入播放页时打开的仍是**原生播放详情页**，不是潮汐的播放页 ——
  这条路由在内核的通知处理里，还没改。

### 实测记录（2026-10-07，Android 14 / x86_64 模拟器）

第一轮（v1.9.1）逐项截图确认：界面启动、真实歌单与封面、榜单与详情、**真实播放（ExoPlayer position 持续推进）**、
播放页真实封面与时长、**真实同步歌词**（周深《大梦归》，当前行高亮）、迷你播放器进度、
全源搜索（"Jay" → 154 首）、我的页、返回键逐级退出、原生设置浮层。
日志只有一条 `[TideWeb] tide bridge ready, backend = native`，无桥接报错。

第二轮（v1.9.2）修完三个问题后重测：

- **闪屏**：`tools/capture-launch.ps1` 抓 30 帧逐帧比对，全帧最亮只有启动图里的图标，
  不再出现 `#FAFAFA` / `#FFFFFF` 那几帧（修复前是 2 帧 250 + 2 帧 255）。
  现在的顺序是「深色启动图（带图标）→ 深色底 → 首页」。
- **点不进去**：首页「最近播放」→ 原生最近播放（8 条记录、真实封面）；
  「我的收藏」→ 切到「我的」页签；「帮助与反馈」→ 原生关于页；
  「新建歌单」→ 建出 `TideCheck` 并刷新列表与统计；歌单详情「收藏」→ 原生「收藏成功」、
  「分享」→ 系统分享面板；播放页「分享」→ 分享面板带歌曲名与酷我详情链接；
  「歌单广场 · 换一批」→ 换了一批（换分类标签）。
- **榜单封面**：12 个榜单卡片全部显示真实专辑图，精选位显示封面 + 前三首歌
  （1 月亮替我望故乡 / 2 大梦归 / 3 Sold Out）。
- 顺带确认：歌单广场子页、本地音乐页、在线歌单收藏到「我收藏的歌单」都正常。

> 注（v1.9.8 已修）：酷我的**歌单**接口在内核里写死 `img: null`（只有榜单接口给 `img: item.pic`），
> 当时把歌单详情的渐变封面当成「数据源限制」记下来了 —— **这个判断是错的**。
> 接口其实带封面：搜索回 `web_albumpic_short`，歌单可以走酷我新接口
> `bd-api.kuwo.cn/api/service/playlist/<id>/musicList?source=4` 拿 `albumPic`，
> 酷狗回 `Image` / `album_info.sizable_cover`。详见 §七。

第三轮（v1.9.3）删重复后重测：

- **「我的」页**：快捷区剩三项（最近播放 / 本地音乐 / 我的下载）并铺满整行（新增 `.quick--three`），
  底部那个和右上角齿轮重复的「设置」行已删。
- **设置页**：「播放与音质 / 下载设置 / 存储与缓存」三个入口已删，底部说明改为
  「……音质、下载、缓存、同步等内核设置统一在「洛雪原生设置」里」。
- **主题与外观**：整页仍正常；字号滑块（唯一保留的滑块）拖动后标签从「标准」变「较大」、
  全站字号跟着变，说明删掉另外两个滑块绑定时没误伤。
- 静态校验（`music-ui-mobile/tools/` 下）：`check-ids.py` 报「all lookups and entry points
  resolve」，`find-dead-css.py` 不再有因本次删除产生的死类。

> 验收用 x86_64 包（模拟器是 x86_64，arm64 包装不上）。两者同一份代码与资源，
> 只差 native so。另注意：本机 Gradle 只保留**最后一次** `-PreactNativeArchitectures`
> 对应的 release 输出，先编 arm64 再编 x86_64 会把 arm64 的包清掉；
> 而且要交付的那次要**单独编**，否则 universal 包里 `libquickbase64.so` 会缺非目标 ABI
> （实测在模拟器上 `dlopen failed: library "libquickbase64.so" not found` 直接崩）。
> 现在这步走 `tools/build-both.ps1`：两个 ABI 都编，每编完一个立刻复制到 `build-staging/`。

第四轮（v1.9.4）页签调整后重测（真机点击）：

- 底部页签：推荐 / 榜单 / **收藏** / 我的（收藏用红心图标）。
- 首页搜索框 → 打开搜索子页：带返回栏、进去就聚焦输入框（键盘自动弹出）、
  搜索历史与热搜榜正常；输入 `zhou` 回车 → 「找到 141 首」，结果带真实封面。
- 「收藏」页签：空的时候显示「还没有收藏的歌曲」并且「播放全部」置灰；
  在播放页点红心（提示「已加入我喜欢的音乐」）后回到该页签，
  列表出现「视奸 · zhou6」且当前播放行高亮，点「播放全部」能重播。
- 全程 `[TideWeb]` 只有 `tide bridge ready` 一条，无桥接报错。

第五轮（v1.9.5）音效与优化后重测（真机点击）：

- 设置 →「音效」：四行音色包点哪行选中哪行（圆点跟着走）、音量滑块从 65% 拖到 75%
  数值跟着变、界面音效开关关掉后回设置页摘要显示「已关闭」，再打开变回「木质 · 75%」
  （说明开关 / 音色包 / 音量三样都真的落盘了）。
- 「试听」那一排点「成功」连点三下，`dumpsys audio` 里出现
  `type:AAudio u/pid:10203 state:started`（WebView 的音频输出确实在出声）。
- **放歌时点音效不会打断音乐**：播放页从 0:34 走到 1:06（其间点了封面、随机、循环、
  歌词四处，每处都会响一声），进度一直在走；`dumpsys audio` 里同时有两条
  `state:started` 的音轨 —— `android.media.AudioTrack`（内核 ExoPlayer，44.1kHz）
  与 `AAudio`（WebView，48kHz）；焦点栈只有一条且 `loss: none`，没人来抢焦点。
- 回归：搜索框进搜索页（键盘自动弹出、历史 `zhou`/`love`、热搜 `茶汤`）→
  输入 `zhou` 回车 → 141 首带封面 → 点第一首开始播，
  行首序号变成跳动的频谱条且标题变主题色（新的 markCurrent 只动了该动的那一行）→
  迷你条 → 播放页 → 歌词当前行高亮并居中滚动。
- 榜单页（延迟渲染那一路）12 个榜单封面与前三首歌名正常；「我的」「收藏」正常。
- 全程 `[TideWeb]` 只有 `tide bridge ready` 一条。

**这一轮最大的坑**：音色包那一行点了没反应，查了很久（见 §五 第 21、22 条）。
真相是逻辑一直是好的 —— `applySfx()` 把 `is-on` 加到了**按钮**上，
而圆点是按钮里的 `<span class="radio">`，CSS 写的是 `.radio.is-on`，
所以状态变了、屏幕没动。浏览器探针没查出来，因为它断言的是按钮的 class。
最后靠 `pointerdown` 加一行日志重编一次拿到
`DIAG pack hit wood before=soft` 才定位。

---

## 四之二、开销（v1.9.5 专门做了一轮）

### 怎么量的

`tools/perf-harness.html`（由 `tools/make-perf-harness.py` 从 index.html 生成）
在 **api.js 之前**插一段 `tools/perf-bridge.js`：它把自己伪装成原生桥，
每条命令都记一笔、然后同步回一份假数据。这样界面跑的是**原生后端**那条代码路径，
但「发了多少条 postMessage、改了多少个 DOM 节点」全能数出来。

必须插在 api.js 之前 —— api.js 一看 `window.ReactNativeWebView` 在不在就定后端，
插在它后面界面会静默退回演示后端，量到的全是 0。

跑法：`python tools/perf-run.py before|after`。它自己起一个 HTTP 服务，
页面把结果 POST 回来（**不要用 `--virtual-time-budget`**：虚拟时钟下
`performance.now()` 不前进，所有耗时都是 0）。`before` 那一版读的是
`tools/perf-baseline-app.js`（旧 app.js 的存档），两边的差别只有 app.js。

假数据里两处长列表都是 300 行、歌单也点开成一个子页，所以 `markCurrent`
要面对 600 行 —— 这是搜索结果那一档的规模。

### 数字

| 工作负载（各 200 次） | 优化前 | 优化后 |
|---|---|---|
| 换歌（歌变了） | 64.2 ms，navState 201 条 | **24.9 ms**，navState 1 条 |
| 播放/暂停（歌没变） | 49.8 ms，封面重建 300、迷你条 200，navState 200 条 | **1.7 ms**，封面 200、迷你条 1，navState 0 条 |
| 进度事件 | 3.8 ms | 2.7 ms |
| 切页签 40 次 | 5.0 ms，navState 40 条 | 4.5 ms，navState 0 条 |
| 启动期间发出的消息 | 9 条（含 hot / history / charts / library） | **4 条** |

两个最频繁的事件类型合计：114 ms → 26.6 ms，并且**少发 400 条桥消息**。
（换歌那一路的 DOM 变更数两边都是 809 —— 那是「把高亮挪到新行」真正必须做的事，
省掉的是找那一行时的扫描，不是写入。）

### 改了什么

1. **播放事件不再无脑重建封面**。原来每个播放事件都重写两处封面 `innerHTML`，
   等于每次按暂停都新建一个 `<img>`（重新解码、重绘，偶尔还看得见闪一下）。
   现在按 `歌key + 图片地址` 的签名分层：文字/歌词/标红只在换歌时做，
   封面只在换歌或换图时重建，图标/红心/进度每次做。
2. **`markCurrent` 不再全文档 `querySelectorAll('[data-token]')`**。
   改成「容器 → {token, rows}」的登记表（`renderedLists`），
   先拿**数组**算出目标下标，只在真的换了行时才碰 DOM，而且只碰两行。
   同一个容器换列表时顺手把旧 token 的数据删掉，长会话里 `state.lists` 不再无限涨。
3. **`notifyNav` 去重**。它原来挂在 `syncMini` 里，于是每个播放事件都往原生发一条
   `navState`（一首歌下来几百条）。现在值没变就不发。
4. **歌词行只在切换时改两个节点**，节点数组缓存下来（原来是每秒 4 次把几十行全 toggle）。
5. **启动不再一次发五条命令**。先 `await renderHome()` 把首屏画出来，
   榜单与「我的」丢给 `requestIdleCallback`（手快点进去时 `goTab` 会补一次）；
   热搜与历史本来就是搜索子页的数据，改成打开那个子页时才取。
6. **进度条位置没变就不写 DOM**（拖拽时手动置空签名，让进度事件重新接管）。
7. **`.song` 行加 `content-visibility:auto`**：屏幕外的行跳过布局与绘制，
   配 `contain-intrinsic-size:auto 64px`（带 auto，渲染过的行记住真实高度，滚动条不跳）。
8. **播放页那个 6 秒呼吸动效只在播放页真打开、且没被歌词盖住时才跑**。
   收起态是 `visibility:hidden`，动画照样一直跑，等于一边放歌一边白占一个合成层。
9. **删掉三个捕获阶段的点击处理器**（单选圆点 / 分段控件 / 步进器）——
   对应的控件在上一轮删重复设置页时就没了，留着只是让**每一次点击**都多跑三趟 `closest`。
10. **`bridge.ts` 的 `wrapSongs` 少映射一遍**：原来 `list.map(toSong)` 写了两遍
    （搜索一页 140 首就白造 140 个对象），返回的 `raw` 也没人用。
11. **顺手修了一个真 bug**：字号滑块以前只改不存，重启就回默认。现在存 `fontScale` 并还原。

### 特意没做的

- `playerPayload` 里那次 `love.some(...)`（判断当前歌是否已收藏）可以缓存成 Set，
  但内核从别处改收藏列表时未必替换数组引用，缓存会读到过期数据 ——
  省下来的是微秒级，换一个「红心不亮」的偶发 bug 不划算。
- 主点击处理器那一串 `closest()` 合并成一次带多选择器的 `closest()` 能省几次祖先遍历，
  但可读性会明显变差，收益是微秒级。

---

## 五、踩过的坑

1. **WebView 缓存会让升级后界面不更新**。改完界面重新打包，装上去还是旧界面，
   极难排查。已在 `TideShell` 里 `cacheEnabled={false}` + `cacheMode="LOAD_NO_CACHE"`，
   界面的 `index.html` 里另加了 `?v=` 版本号作为第二道保险（改了界面记得一起改版本号）。

2. **榜单 id 别丢给歌单接口**。界面所有详情入口都调 `playlistDetail`，
   如果不在桥里按 `board:` 前缀分流，榜单会被当成歌单查，
   结果是「点飙升榜进去看到的是我喜欢的音乐」—— 而且不报错，只是内容不对。

3. **`UserListInfo` 上没有 `musicInfo` 字段**（只有 `id/name/source/sourceListId/locationUpdateTime`），
   自建歌单的歌数要从 `listState.allMusicList` 里取，写 `l.musicInfo.length` 会永远是 0。

4. **事件总线有两个**。界面数据层里「门面」和「后端」各有一个 emitter，
   `Tide.on` 必须订阅后端那个，否则界面永远收不到播放状态（表现为点了歌没反应）。

5. **返回键要先问界面**。界面是单页应用、自己维护子页面栈。
   界面每次导航变化都上报 `navState.canBack`，原生据此决定注入 `TideGoBack`
   还是交还系统；不做的话在设置子页按返回会直接退出 App。

6. **热搜必须传 `'all'`**。`getHotSearch(source)` 传单个平台时常常返回空列表 ——
   部分平台没有 `hotSearch` 接口（`core/hotSearch.ts` 里直接 `return []`），
   传 `'all'` 才会聚合所有有该接口的平台。

7. **状态栏高度 WebView 里取不到**。`env(safe-area-inset-top)` 在 WebView 里是 0，
   由原生把 `useStatusbarHeight()` 注入成 CSS 变量 `--safe-top`。

8. **开 App 闪白**（2026-10-07 修）。用「设备端连续抓帧」定位到三段：
   `#FAFAFA` 两帧（AppTheme 是 DayNight，浅色模式下启动窗口是近白底）→
   `#FFFFFF` 两帧（RNN 根视图用的是原生主题的 `c-content-background`，浅色下就是白）→
   约 2.7 秒 `#0A0B0F` 空白（WebView 首帧还没画出来）。
   修法是「三层同色」，见上面「启动底色是三层同色」一节。
   抓帧工具：`tools/capture-launch.ps1` + `tools/analyse-launch.py`
   （这台机器没有 ffmpeg，`screenrecord` 的 mp4 解不出来，所以用设备端 `screencap` 循环抓）。

9. **`Set-Content -Encoding UTF8` 会写 BOM，而 BOM 会让 RN CLI 读不了 `package.json`**。
   症状极具迷惑性：Gradle 报 `React Native CLI failed to determine Android project
   configuration`，并打印 `dependencies:[] commands:[]` —— 看着像 node_modules 坏了，
   其实只是 package.json 开头多了 3 个字节。用 PowerShell 改 JSON 之后
   一定要确认没有 BOM（`python -c "print(open('package.json','rb').read()[:3])"`）。

10. **PowerShell 的 `>` 重定向会按 UTF-16 写文件**，所以
    `adb exec-out screencap -p > x.png` 拿到的是坏图。改成设备端
    `screencap -p /sdcard/x.png` 再 `adb pull`。

11. **手算点击坐标不可靠**。按截图估的坐标连续点空好几次（WebView 内容
    `uiautomator` 看不见，只能估）。原生界面一律用 `tools/ui.ps1 -Find` 拿真实 bounds
   再点；WebView 里的控件就先截图、裁剪放大确认位置。

12. **`__log` 之外还要看 `window.onerror`**。界面里 JS 抛在 `boot()` 早期时，
   表现是「静态骨架画出来了但数据区全空」，很像加载慢，实际是脚本挂了。
   临时在 `<head>` 里挂个 `window.onerror` 浮层能立刻看到是哪一行。

13. **别用「init 回执成功」当事件通道的开关**。冷启动时 RN 的 JS 线程很忙，
   实测出现过一次 `init` 回执超过界面侧 20 秒超时（日志里是 `Tide.init failed {}`）。
   当时的写法是「init 成功才 `readyRef = true`」，一旦超时这个标志就永远是 false，
   **之后所有事件（播放态 / 进度 / 歌词 / 榜单封面）被静默丢掉** ——
   界面看着能点、但不刷新，而且一声不响。
   现在改成：收到 `init` 这条消息就开通道（页面能发消息就说明它活着），
   与回执是否成功无关。

14. **`console.log(error对象)` 经桥接日志通道会变成 `{}`**。`CONSOLE_BRIDGE` 对非字符串参数
   做 `JSON.stringify`，而 `Error` 的可枚举属性是空的。要打 message 就自己拼：
   `log('xx failed:', e && e.message)`。靠这一条才看出上面第 13 条是 `bridge timeout` 而不是桥接报错。

15. **「所有命令都超时」也可能是模拟器被拖死了，不一定是代码问题**。
   实测有一次所有命令全超时（界面显示「加载失败：bridge timeout: home」），
   原因是后台开着 Chrome + 主机在跑 Gradle，模拟器被饿到
   `InputDispatcher: ... spent 4433ms processing FocusEvent`、`Failed to receive
   transaction ready in 1000ms`。杀掉 Chrome、等主机空闲后冷启动即恢复正常
   （日志重新出现 `[TideWeb] tide bridge ready`）。排查这类问题先看这两条 logcat 信号。

16. **Gradle 只保留最后一次 `-PreactNativeArchitectures` 的 release 输出**。
   连着编 arm64 再编 x86_64，`release/` 下的 arm64 包会被清掉。
   要交付的那次必须**单独编**，编完先把它复制出 `release/` 再干别的。
   另外 `universal` 包**不能**当验收包用：`react-native-quick-base64` 跟随
   `-PreactNativeArchitectures`，在 arm64 那次构建里产出的 universal 包
   只有 arm64 的 `libquickbase64.so`，装到 x86_64 上直接崩：
   `Fatal: Error Exception in HostFunction: java.lang.UnsatisfiedLinkError:
   dlopen failed: library "libquickbase64.so" not found`。

17. **无头 Edge 加 `--virtual-time-budget` 之后，`performance.now()` 不前进**。
   虚拟时钟只在渲染进程空闲时往前跳，同步执行的 JS 里读到的 delta 全是 0 ——
   第一次跑压测，200 次事件的耗时打印出来是 `0 ms`，看着像「优化到了极致」，
   其实是根本没在计时。要真时钟就别加这个参数，让页面把结果 POST 回来
   （`tools/perf-run.py` 就是这么做的）。

18. **`--window-size` 不等于视口宽度**。Windows 上浏览器窗口有最小宽度，
   传 460 实际会渲染出 ~480 的视口，而截图还是 460 宽，于是**右边被裁掉一截**。
   别拿这个当「界面横向溢出」的证据 —— 先用同一尺寸截一张已知正常的页面做对照
   （这次就是先截首页，发现它也裁，才确定是预览环境的问题）。

19. **`--screenshot=` 的相对路径会写错地方**。它的基准目录不是当前目录，
   报错是 `Failed to write file shots\x.png: 系统找不到指定的路径`。给绝对路径。

20. **验证音效别只看「函数被调用了」**。用 `OfflineAudioContext` 把每个音渲染成 PCM，
   量峰值 / 有效值 / 尾长才是证据。顺带一个经验：**带通滤过的噪声能量掉得极快**，
   木质音色包里那支「划过」原本 Q=1.4，渲染出来峰值只有 0.018（其它事件都在 0.1–0.3），
   等于听不见；把 Q 降到 0.9 并补 5 倍增益才对齐。

21. **状态类要加在「CSS 真正画的那个元素」上，不是它的容器上**。
   音色包那一行是 `<button data-sfx-pack>` 里面套一个 `<span class="radio">` 圆点，
   而 `applySfx()` 把 `is-on` 加在了**按钮**上 —— 逻辑全对、`state.sfx.pack` 也真的变了，
   屏幕上却什么都不动（CSS 写的是 `.radio.is-on`）。这个坑最阴的地方是
   **浏览器探针查不出来**：探针断言的是按钮的 class，那个确实变了。
   探针改成查圆点的**计算样式**（`getComputedStyle(dot).backgroundColor`）才复现。
   → **断言要看渲染结果，不要看中间 DOM 属性。**

22. **「点了没反应」先让程序自己说话，别靠推理**。这一条上面那个 bug 排查了很久：
   坐标量了、DOM 结构打了、命中测试做了、浏览器里点通了，设备上就是没反应 ——
   一度怀疑点击没送到页面。最后是在 `pointerdown` 上加一行日志、重编一次（增量只要 1 分半），
   一条 `DIAG pack hit wood before=soft` 就说明「其实一直在工作」，
   方向立刻从「点击有没有到」转成「到了之后为什么看不见」。
   **加一行日志重编一次，比再推十个假设便宜。**

23. **命令失败不能只是「resolve 一个 ok:false」**。内核的 `play` 在列表为空时
   回的是 `{ ok: false }`，桥把这当成一次**成功**的回执 resolve 掉，
   界面 `.catch` 不触发、`.then` 也没人看返回值 —— 于是「点一下什么都不发生，
   连个提示都没有」。用户报的「首页推荐 30 首点不进去」有一半就是这个。
   现在的约定：**要显示给用户的失败必须 reject**，并且用 `err.tideUser = true`
   标出来，界面才敢把这句话直接显示（超时之类的技术错误一律换成一句人话，
   别把 `bridge timeout: play` 甩到用户脸上）。

24. **头像是纯渐变圆的时候，用户会以为「图片没加载出来」**。洛雪没有账号体系、
   拿不到真头像，原来的 `.avatar__img.cover.cover--d` 就是一个彩色圆 ——
   逻辑上没错，观感上就是一张坏图。现在改成「名字首字的字母牌」
   （`.avatar__img--mono`，底色仍跟着皮肤走），一眼看上去是个正常头像。
   **占位物要长得像「有意为之」，不能长得像「还没加载」。**

---

## 六、真实用户走查（v1.9.8）

用户的原话是「模拟真实用户使用，再看看有什么地方不合理、功能不能用、图片不显示」。
这一轮不是加功能，是**把假的东西变真、把丢的东西找回来**。

### 怎么点的

`tools/tide-device.py` —— 用 `uiautomator dump` 拿节点和 bounds，然后**按文字点**。

关键发现：**WebView 里的文本节点在 uiautomator 里是看得见的**（原生 a11y 树会把 web 文本暴露出来），
所以「点那个写着『音效』的按钮」可以精确做到，不用再对着截图猜坐标（坑 11 的解法）。
按钮没有文字就补 `aria-label`，它会变成节点的 `text`：

```powershell
python tools\tide-device.py dump "排序"        # 找节点
python tools\tide-device.py tap "\u6392\u5e8f" # 按文字点（中文参数走命令行会被 GBK 拆坏，用 \u 转义）
python tools\tide-device.py shot 03-sort-name  # 截图到 shots/dev-*.png
```

### 找到并修掉的

| 现象 | 真正的原因 | 处理 |
| --- | --- | --- |
| 歌单里每首歌都是渐变块（用户截图） | 酷我 `kw/songList.js` 的 `filterListDetail` 写死 `img: null`；`kw/musicSearch.js` 也是 | 搜索用接口本来就回的 `web_albumpic_short` 拼全；歌单并发请求酷我新接口拿 `albumPic` 按 id 贴回（2.5s 上限，失败就保持渐变）。酷狗同理：`Image` / `album_info.sizable_cover` |
| 歌单 / 榜单详情的**头图**是渐变 | **两层**：桥里 `songs.find(s => s.img)` 字段名写错（`toSong` 的字段叫 `pic`）；`api.js` 的 `normalizeDetail` 是白名单重建，`img` 被静默丢掉 | 两处都改；`normalizeDetail` 改成不白名单（见坑 26） |
| 播放页右上角「更多」只弹一句 toast | 占位 | 改成真的「更多」弹层：音效 / 播放队列 / 查看评论 / 分享这首歌 |
| 播放页「评论」只弹 toast | `SubPageHost` 没有 `comment` 分支 | 接上内核 `screens/Comment`（它自己从 `playerState` 取当前播放的歌，不用传参） |
| 歌单页「排序」只弹 toast | 占位 | 做成真的：默认 → 歌名 → 歌手。**排序在原生侧做**，界面只换模式重取 —— 界面按下标点歌，两边顺序不一致就会「点 A 放 B」 |
| 每行歌曲都有个「…」只弹「歌曲操作菜单」 | 占位，且这个移植没有「对任意一首歌」的内核动作 | 直接删掉（行本身就是播放） |
| 「我的」页写着 428 收藏 / 12 歌单 / 86 下载 / 连续听歌 128 天 / VIP 角标 | 全是画出来的假数字 | 换成内核真值（收藏 / 歌单 / 下载），去掉 VIP 与连续天数 |
| 「账号与安全」页有昵称、`138****6620`、「微信 已绑定」、「当前 3 台设备在线」 | 这个移植没有账号系统，整页是编的 | 整页重写：「没有账号系统」+ 本机真实数据 + 隐私设置入口 |
| 隐私设置里「清除搜索历史」弹「已清除」但历史还在 | 只弹提示、没真清 | 接上 `Tide.clearHistory()` |
| 深色界面里点「评论」「最近播放」蹦出一张**白页** | 原生子页面用的是**内核主题**，跟界面这套明暗完全是两回事 | 界面切主题时调 `Tide.theme(dark)`，桥里 `setTheme('black' / 'green')`（内核 `auto` 用的也是这两个 id） |

另外把播放页的**音效控制**搬了上去（用户点名要的）：底部第 4 个按钮（喇叭图标）打开音效弹层，
里面是总开关 + 四个音色包 + 音量 + 试听。**和「设置 → 音效」是同一份状态**：
两个入口的控件都按 `data-sfx-switch` / `data-sfx-pack` / `data-sfx-range` / `data-sfx-val` / `data-sfx-sum`
找，`applySfxInner()` 一处同步，改哪边都一样（这条是坑 21 的推广，见坑 27）。

### 这轮的新坑

25. **字段名写错不会报错，只会静默退化**。桥里写 `songs.find(s => s.img)`，
   而 `toSong` 返回的字段叫 `pic` —— 结果永远取不到，头图一直是渐变，
   没有任何报错。**改完「取某个字段」的逻辑，要顺手断言渲染结果变了**，
   否则「代码改了、画面没变」这种最难查。
26. **白名单式重建会吃掉字段**。`api.js` 的 `normalizeDetail` 原来是
   `{ title, author, desc, cover, songs, token }` 手工重建 —— 后来桥里加了 `img`，
   这里没跟着加，于是**原生明明把封面传过来了，界面拿不到**。
   现在改成 `Object.assign({}, r, { songs: songsOf(r.songs) })`：
   **透传 + 只改需要改的**，以后加字段不会再被吃掉。
27. **一个设置项画两个控件时，控件要按 `data-*` 找，不要按 id 找**。
   音效设置现在有两个入口（设置页、播放页弹层），如果各自写 `$('#sfxSwitch')`，
   加第二个入口就得改一遍逻辑、而且很容易只同步一边。现在的写法是
   `$$('[data-sfx-switch]')` 一把全同步，加入口不用动 JS。
   注意：**状态类要加在 CSS 真正画的元素上**（坑 21），弹层里选中行的底色画在按钮上，
   所以按钮和圆点都要 `is-on`。
28. **原生页面和 WebView 界面是两套主题**。界面这套（深色 + 六套皮肤 + 主色）是界面自己的，
   原生子页面（评论、最近播放、本地音乐、原生设置）用的是内核的 `theme.id`。
   不同步的后果是深色界面里点「评论」蹦出一张白页 —— 逻辑没错，观感像坏了。
29. **无头浏览器里 CSS 过渡可能冻在 t=0**。同一段断言（点音色包后读圆点的
   `backgroundColor`）跑两次，一次过、一次读到起始值 `rgba(0,0,0,0)`。
   无头模式不持续渲染时过渡不会推进。**断言状态就断言 class**，
   计算样式只能当佐证；否则会得到「同一个 build 时好时坏」的假 bug。
30. **块注释里不能出现 `*/`**。写文档注释时举了个路径 `musicSdk/*/index.js`，
   里面的 `*/` 直接把注释提前闭合了，后面整段变成代码 —— 报出来的是十几条
   `TS1005 ',' expected` 和 `Unterminated template literal`，位置全在无辜的行上。
   路径里的通配符要写成 `musicSdk/<平台>/index.js`。
31. **`WritableMap` 没有 `putIntArray`**。想回一个 int 数组给 JS，得自己
   `Arguments.createArray()` + `pushInt()`，再 `putArray()`。编译期就报，
   但错误信息是「找不到符号 putIntArray」，容易先怀疑 import。
32. **`PresetReverb` 没有 `getNumberOfPresets()`**（`Equalizer` 才有）。
   混响的档位数是常量（AOSP 那套 0..6）。别照着 Equalizer 的写法套。
33. **`.sheet` 自己带 18px 内边距**。往弹层里塞新面板时，如果给面板容器加内边距，
   设置页（在 `.s-group` 里、没有这层 padding）和弹层就会差一截。
   内边距要加在**面板自己的分组**上，两个入口才对得齐 —— 实测左边界 35 / 34px。
34. **无头截图在 3 步以上的点击链上会抓拍在动画中途**。`--virtual-time-budget`
   下点击链跑得飞快，但弹层入场动画还没走完就截图了，看到的是「页签高亮在 A、
   内容却是 B」这种自相矛盾的画面。**深层状态改走短路径**（比如从设置页直接进，
   而不是播放页→迷你条→弹层），或者用真跑的探针（`probe-run.py`）核对，
   别拿这种截图当 bug 去改代码 —— 这轮为它白查了一轮。
35. **模拟器的「启动慢」和「启动闪」量的是 swiftshader，不是应用**（v1.9.13）。
   这一轮为了「打开还是闪一下、优化打开速度」在模拟器上量了很久，越改越困惑：
   页面侧埋点说 67ms 就画完了，屏幕却要 5~9 秒才有东西。最后靠
   `_launch-applog.py`（全量 logcat）看到真相是
   `OpenGLRenderer: Davey! duration=4064ms` —— **一次软件绘制占了 4 秒**，
   连 `init` 的回执都挡住。真实设备有 GPU，这一段基本不存在。
   **结论：模拟器只用来验「逻辑对不对」（埋点、请求数、交互），
   不要用它量渲染耗时，更不要为它去砍界面效果。**
36. **连续 `screencap` 抓帧会自己把被测对象压慢**（v1.9.13）。抓帧循环本身
   （一张 0.7~0.9 秒）在软件渲染的模拟器上就是重负载：同一版包，抓帧时
   `Skipped 276 frames`、空白到 8.8 秒；改成「每档延时单独冷启动、只拍一张」
   才稳定。**量「什么时候出现画面」要用 `measure-launch.py sweep`。**
37. **logcat 里 RN 转发过来的 `console.log` 时间戳会滞后**（v1.9.13）。
   RN 的 JS 线程被占住时，这些行会攒着一起发，于是相邻两行的时间戳差
   4 秒、而页面自己报的 `t+` 只差 54ms。**跨行算耗时要看 `t+` 里的数字，
   别拿 logcat 时间戳相减**（`[TideWeb]` 那几行尤其明显）。
38. **XML 注释里不能出现两个连字符**（v1.9.13）。`values-night/colors.xml` 的注释
   里写了 `--bg`，编译直接失败：`注释中不允许出现字符串 "--"`。
   写 Android 资源注释时别引 CSS 变量名。
39. **模拟器会把「页面更高」的页签拖成假 ANR**（v1.9.15）。点「我的」页签时报
   输入分发超时，`/data/anr/` 里的 trace 显示主线程卡在
   `ViewRootImpl.performTraversals → performDraw → ThreadedRenderer.draw → syncAndDrawFrame`。
   「我的」页比别的页签高，软件光栅化一次绘制就要好几秒 —— **是模拟器，不是 JS**。
   判据：ANR trace 的主线程栈若停在 `ThreadedRenderer` / `syncAndDrawFrame`，
   先怀疑光栅化；换干净启动的模拟器重跑确认。
40. **「首页渲染出来了」只数文本节点，桌面（launcher）也是文本节点**（v1.9.15）。
   应用没起来时自动化会对着 launcher 断言成功（图标名也是文本节点，33 个）。
   修法：`launch()` 轮询 `foreground() == 包名`，并**要求出现一句只属于本应用界面的文字**
   （这里用「想听点什么」），再往下走。**光靠节点数量区分不开应用和桌面。**
41. **数 DOM 变更数找不到「样式层面的持续开销」**（v1.9.16）。进度条那条 `width` 过渡
   让播放期间每帧都重排（501 次 / 3 秒），但**一个 DOM 结构都没改** ——
   `perf-run.py` 那几个工作负载里它全是 `变更=0`。要找这类问题得数
   **重排 / 样式重算的次数**（CDP 的 `Performance.getMetrics`）。
   `width: 25%` 和 `transform: scaleX(.25)` 在屏幕上一模一样，只有量具能分辨。
42. **验「动画/过渡的终态」要等得比过渡本身长**（v1.9.16）。断言在 `seek()` 之后
   只等 150ms 就量，量到 `scaleX=0.148`（过渡是 280ms，还在半路）。
   和桌面版那条「截图要等淡入播完」是同一类错：**别把中间帧当成终态。**
43. **uiautomator 对屏幕外的节点照样给坐标，直接点会点到被裁到边缘的位置**（v1.9.17）。
   「我的」页加了音源两行之后变长，「播放音效」那行滑出了屏幕，`tap_text` 按它报的
   坐标点下去 —— **点到了底栏的「收藏」页签**（页面被裁到屏幕边缘，那个坐标落在底栏上），
   表现出来是「播放音效设置页打不开」，查了半天代码，其实是点歪了。
   → 点页面里的行一律用 `tap_row`：先看 y 在不在安全区（`SAFE_TOP` ~ 屏高-360），
   不在就先滑，滑到了再点。
44. **页面里的标签会和底栏页签重名，`find` 取第一个会取错**（v1.9.17）。
   「我的」页统计里有「收藏」，底栏也有「收藏」，而统计在前面 ——
   点「收藏」点到了那个**非可点的 span**，界面当然不动。
   → 点底栏用 `tap_last`（取 y 最大的那个，底栏永远在最下面）。
   推论：**按文字点之前先想一下这个名字在屏幕上唯一吗**；不唯一就得有别的判据。
45. **`logcat` 里的 `FATAL EXCEPTION` 不一定是你**（v1.9.18）。断言「没有崩溃」时
   原来只找 `FATAL EXCEPTION` 这一行，结果**冷启动的模拟器上系统自带的
   Google Messages 开机时崩了一次**（`Must call PhenotypeFlag.init() first`），
   于是每次冷启动都误报一条崩溃。→ 判据要落到进程名：
   从 `FATAL EXCEPTION` 往下几行里找 `Process: <包名>`，只认自己那个
   （解析不出进程名时仍然算失败，免得把真崩溃漏掉）。
46. **`adb` 被打断会把整条链路卡死，而且看起来像「应用没起来」**（v1.9.18）。
   我中途 `TaskStop` 掉一次正在跑的验证脚本，它当时正卡在 `adb exec-out screencap` 上；
   之后新一轮跑出来的截图是 **0 字节**、脚本一直挂着不动，看着像模拟器坏了 ——
   其实 `adb devices` 也空了，模拟器进程已经没了。
   恢复步骤：`adb kill-server` → 用 **`ANDROID_AVD_HOME=D:\android-tools\avd`**
   重新起模拟器（这个 shell 里没有那个环境变量，不设就报 `Unknown AVD name`）。
   **教训：别在验证脚本跑到一半时硬杀它**，要杀就先把 adb 那边收拾干净。

47. **「universal」APK 不是真的全 ABI —— 它的非主 ABI 原生库是上一次构建的残留**（v1.9.19）。
   我这轮用 `build-android.ps1 arm64-v8a assembleRelease` 打包（给真机的），
   顺手把同一次产出的 `*-universal.apk` 装到 x86_64 模拟器上验收，结果一进搜索页
   就弹「💥Unexpected error occurred💥」。logcat 里的真因是：

   ```
   UnsatisfiedLinkError: dlopen failed: library "libquickbase64.so" not found
      at eapiRequest → getList → hot        （网易云 eapi 加密）
   ```

   也就是 `libquickbase64.so` 这个原生库在 APK 里**只有 arm64-v8a 一份**。
   原因：构建脚本把 `-PreactNativeArchitectures=arm64-v8a` 传给了 Gradle，
   CMake 那一层就只为 arm64 编了；而 universal 包是把 `lib/<abi>/` 下**现有**的文件
   都打进去 —— 其它 ABI 目录里剩的是更早某次全 ABI 构建留下的 `libquickmd5.so` 之类，
   所以它「看起来」是全的。

   判据与做法：
   - 验之前先看包里有什么：`zipfile` 里数 `lib/<abi>/libquickbase64.so` 在不在；
   - **模拟器（x86_64）要用 `build-android.ps1 x86_64 assembleRelease` 单独打**，
     真机的 arm64 包另外打（这一条 `§三 怎么用` 里本来就有，我是没照做）；
   - 装 x86_64 包时会被 `INSTALL_FAILED_VERSION_DOWNGRADE` 拦住
     （单 ABI 的 versionCode 比 universal 低），要加 `-d`。

   附带一个**不是** bug 的观察：这个错误是**同步原生调用**抛出来的，所以它会走
   `setJSExceptionHandler` 的 fatal 分支弹窗，而不是像 Promise 那样被 `.catch` 掉 ——
   缺原生库时用户看到的是一个吓人的报错弹窗，而不是「热搜没出来」。

48. **`pickSpread` 里写死的步长在 n 是 7 的倍数时死循环，整个 JS 线程卡死**（v1.9.19）。
   这是这一轮翻出来的**最严重**的一个问题，而且不是我这轮引入的（`daily` 一直在用它）：

   ```js
   idx = (idx + 7) % n          // 7 是质数 → n 只要是 7 的倍数，
   while (out.length < k && seen.size < n)   // idx 就只在 n/7 个位置上打转
   ```

   n = 35/42/49/56/63 时 `seen` 最多涨到 5/6/7/8/9，`out` 也涨不到 k，
   于是 `while` **永远成立** —— JS 线程 100% 占住，App 表现是「点什么都没反应」。

   ```
   n=35  旧实现：走出 5 个 / 看过 5 个位置 / 1000001 步 → 死循环
   n=42  旧实现：走出 6 个 / 看过 6 个位置 / 1000001 步 → 死循环
   ```

   （用 `tools/_prove-pick-spread-hang.mjs` 数步数证明的：真跑会卡死，只能数步数。）

   为什么会踩到：榜单两页拼出来的池子常常正好是这些数（一页 30 首、有重叠或去重之后
   就是 35/42/…）；我新写的「猜你喜欢补足到 30 首」又拿它挑歌（`n = 池子 - 已收藏`），
   用户收藏了 4 首、池子 60 首时就是 56 → 一进首页就卡死。

   改法：**步长从 7 往上找一个与 n 互质的**（互质才能遍历全部位置），
   再加一个 `guard` 兜底 —— 以后谁把步长改坏了也不会把线程挂住。
   回归测试 `tools/check-pick-spread.mjs`（21 项）：它**从 `bridge.ts` 里把函数源码抽出来**
   用项目自己的 typescript 去掉类型注解再跑，测的是真身而不是抄一份。

49. **同一个模拟器上不能同时跑两个验收脚本**（v1.9.20）。
   这一轮排查「从在线地址导入报『无法连接到服务器』」花了不少时间，最后发现是
   **自己踩自己**：`python tools/verify-fx-tips.py launch` 在后台跑着（它其实是
   「启动 + 走完整条 flow」，不是只启动 —— 见坑 52），同时我又起了一个只走
   「添加音源」这一段的小脚本。两个进程一起点同一块屏幕，导入就失败了。

   最误导人的地方是**证据互相矛盾**：服务端日志里那条 GET 明明回了 200
   （还带着 `?_=` 缓存戳，是 RN 的 fetch 才会加的），App 里却报网络错误。
   独占模拟器重跑一次就成功了 —— 所以遇到「服务端说成了、客户端说没成」，
   先确认台上只有自己一个演员。

   > 后来发现这一条其实是**两件事叠在一起**：并发确实会坏事，但真正让
   > 「服务端 200 / 客户端连不上」反复出现的是**测试服务端自己不合规**（见坑 53）。
   > 两条都要记：先独占，再查量具。

50. **`adb shell input text` 是「追加」，不会替换**（v1.9.20）。
   输入框里原来有 `http://10.0.2.2:37991/tide-test.js` 时再打一个地址，会拼成
   `http://10.0.2.https://registry.npmmirror.com/...2:37991/tide-test.js` 这种怪物
   （看着像地址解析坏了，其实是打字叠了）。先清空：`input keyevent 123`（MOVE_END）
   再删一串 DEL —— 而 **`input keyevent` 可以一次传多个键码**
   （`input keyevent 67 67 67 …`），120 个 DEL 一次调用就够，不用循环 120 次 adb。

51. **uiautomator 给的是像素，RN 用的是 dp —— 比高度必须除以 density**（v1.9.20）。
   这一轮要证明「设置行高从 46 变成了 54」，直接在 uiautomator 里读到的却是
   126 和 148 —— 差 22 像素，看着几乎一样，很容易得出「没改」的结论。
   除以密度（`wm density`，这台模拟器是 2.75）才对上：46dp / 54dp。
   顺带一条：**WebView 里的 `<input>` 在 uiautomator 里是 `EditText`，它的 text 是
   「内容」不是 placeholder** —— 空的时候是空串，按占位文字找不到，要按 class 找。

52. **`verify-fx-tips.py launch` 不是「只启动」，它会接着走完整条 flow**（v1.9.20）。
   `main()` 里 `cmd == 'launch'` 只是跳过装包，函数末尾**无条件**调 `flow()`：

   ```python
   if cmd == 'install': install(...); launch()
   elif cmd == 'launch': launch()
   flow()        # ← 不管前面走的是哪个分支，都会跑
   logs()
   ```

   想只把 App 拉起来（比如后面要接自己的小脚本），得单独调 `launch()`，
   或者干脆用 `adb shell am start`。坑 49 就是被它坑的。

53. **自己搭的测试服务端是 HTTP/1.0，会让 App 的 fetch 报「无法连接到服务器」**（v1.9.20）。
   这条是坑 49 的**真正根因**，而且比坑 49 更值得记：

   ```python
   ThreadingHTTPServer(('127.0.0.1', 0), SimpleHTTPRequestHandler)   # ← protocol_version 默认 HTTP/1.0
   ```

   症状是**证据自相矛盾**：服务端日志里那条 GET 明明回了 `200`，
   App 那边却抛 `Network request failed`（RN 翻译成「无法连接到服务器」）。

   原因是这个组合不合规：Python 用 `HTTP/1.0 200 OK` 去回一个
   **HTTP/1.1 + `Connection: Keep-Alive`** 的请求，而且因为
   `close_connection=False` 它**不关连接**；OkHttp 收到 HTTP/1.0 的响应会认为
   「这连接该关了」，于是自己关/等。同一套点击流程时而成功时而失败。

   改法：测试服务端 `protocol_version = 'HTTP/1.1'` + 回 `Connection: close`。
   改完同一个流程稳定成功。**真实音源地址都是正经 HTTP/1.1 服务端，所以这不是
   App 的 bug** —— 但排查时先怀疑自己的量具，比怀疑被测代码划算。

   （判定「那条 GET 到底是谁发的」用 `tools/_hdrcheck.py`：它把请求头打出来，
   App 的 fetch 带 `Chrome/69` 的 UA + `Accept: application/json`，WebView 不是。）

54. **`tap_text('^取消$', 1.5)` 里的 1.5 是「第几个」，不是「等几秒」**（v1.9.20）。
   `tap_text(pat, want=0, wait=1.2)` —— 第二个位置参数是 `want`（取第几个匹配）。
   写 `tap_text('^取消$', 1.5)` 会被当成 `hits[1.5]`：匹配只有 1 个时返回 None，
   于是报「找不到可点的『取消』」—— 而屏幕上明明有；匹配 ≥2 个时直接 `TypeError`。
   同一轮里 `hide_keyboard()` 里的 `tap_text(label, 0.8)` 就是这么崩的（崩在验收脚本里，
   看着像被测功能坏了）。

   改法不只是把这几处改成 `wait=`：**把 `want` / `wait` 做成只能按关键字传**
   （`def tap_text(pat, *, want=0, wait=1.2)`），以后写错会直接报
   「unexpected positional argument」，而不是静默走偏。

   顺带一条同类的：**「删除」在屏幕上同时有两种** —— 每行右边那个垃圾桶
   （`aria-label=删除`）和确认态里那颗红胶囊。`tap_text('^删除$')` 取第一个会取到
   **别的行**的垃圾桶，表现是「点了删除，确认态跑到另一行去了，什么都没删掉」。
   确认态里「取消」和「删除」同一行，所以按「离『取消』最近」取（`tap_confirm_delete`）。

55. **模拟器开着的时候打包会 OOM**（v1.9.20）。这台机器 15.7 GB 内存，
   模拟器开着时可用只剩 ~2.3 GB，Metro 的 transform worker（jest-worker）
   直接 `FATAL ERROR: Zone Allocation failed - process out of memory`，
   接着 Gradle daemon 也一起消失，报「Gradle build daemon disappeared unexpectedly」。
   同一台机器、同一个命令，模拟器关掉就一次过。

   **把 `NODE_OPTIONS=--max-old-space-size` 调大反而更糟**（每个 worker 都拿到
   更大的上限，宿主机被过度承诺）—— 正解是**腾出内存**，不是给 Node 更多配额。
   做法：`adb emu kill` → 打包 → 再起模拟器（起一次 24 秒，用快照）。

   （打包前后用 `tools/_mem.py` 看一眼 `available`，比事后猜快得多。）

56. **`emulator -no-window` 别再加 `-gpu swiftshader_indirect`，会卡在 offline**（v1.9.20）。
   带上它时 `adb devices` 一直是 `emulator-5554 offline`、`sys.boot_completed`
   永远读不到（等了 6 分钟）；`adb kill-server` 也没用。
   去掉这个参数、只留 `-no-window -no-audio -no-boot-anim`，24 秒就起来了。

   `ANDROID_AVD_HOME` 必须显式给（`D:\android-tools\avd`）—— 这个 shell 里没有
   那个环境变量，不给的话 emulator 找不到 AVD。启起来的进程名是
   `qemu-system-x86_64-headless.exe`（-no-window 的后果），headless 下
   `screencap` 与 uiautomator 都正常。

57. **「留白更大」会让只读当前可见节点的断言假失败**（v1.9.21）。设备验收里的
    `texts()` / `nodes()` 只拿得到屏幕上那一屏：新版把「我的」页的「界面音效」、
    音源页的「添加音源」、收藏页的「我收藏的歌单」都顶到了首屏之下，断言就报
    「缺行」。**先滚一屏再断言**（滚得到就不是缺）；这不是界面少了东西。
58. **原生设置行高断言会把迷你播放器算进去**（v1.9.21）。量「可点宽行」时，
    浮在设置页上层的 `展开播放页` 按钮也满足 `width > 400`，而它高 45dp
    （封面 44px），正好落进「老的 46dp 行」区间。过滤掉这个文本，别把
    「界面没改」的结论建立在浮层上。
59. **本地导入测试服务端别用随机高位端口**（v1.9.21）。`bind(('127.0.0.1', 0))`
    分到 38949 那轮，服务端日志明明 200，App 却报「无法连接到服务器」；
    换成固定 3208（占用再退回随机）后稳定。模拟器访问 10.0.2.2 的高位端口
    偶发不通，和 HTTP/1.0 那个坑（坑 53）不是一回事。
60. **每轮测试新建的歌单会累积**（v1.9.21）。`section_count()` 为了找
    「我收藏的歌单」会把收藏页滚下去，而「新建」在列表最上面、已经不在
    无障碍树里，`tap_row` 直接报「找不到」。点「新建」之前先往回滑到顶。

### 实测记录（2026-10-08，v1.9.8，Android 14 / x86_64 模拟器）

按上面那张表逐项真点真截图（`shots/dev-01..20-*.png`）：

- 歌单详情：**头图是真封面**（和首页卡片同一张）、**30 行歌曲全是真封面**；
- 搜索 `zhou` → 141 首，**结果行全带真封面**（修之前是一片渐变块）；
- 榜单详情「飙升榜」：头图是首曲专辑图（兰香如故），行内封面正常；
- 排序：`排序：默认 → 歌名 → 歌手 → 默认`，列表真的重排，
  **点第 1 行播出来的就是第 1 行那首**（「11」而不是排序前的「春娇与志明」）——
  这是排序最危险的地方（下标与原生数组必须同序），专门验了；
- 播放页：底部 6 个动作（收藏 / 评论 / 下载 / 音效 / 分享 / 队列）都在，
  点「音效」弹出音效弹层，切到「电子」后摘要行与圆点都跟着变（`电子 · 75%`）；
- 右上角「更多」弹出更多弹层（带当前歌名），点「查看评论」进原生评论页；
- **评论页是深色的**（「春娇与志明」的评论，热门 988 条），最近播放页也是深色的；
- 我的页统计是内核真值；账号页没有任何假身份信息；
- 歌单页的歌曲行里已经没有那个「更多操作」按钮（a11y 树里也搜不到了）。

`tools/ui-check.py`（预览里跑，46 项断言）全过；`tools/layout-probe.py` 确认
音效弹层与播放页底栏都没有横向溢出（`rect.right` 均小于 `innerWidth`，
截图右边被切是无头 Edge 的最小窗口宽造成的，见坑 18）。

### 实测记录（2026-10-08，v1.9.12，Android 14 / x86_64 模拟器）

`tools/verify-fx-tips.py`（新，19 项断言全过，截图 `shots/dev-fx-*.png`）：

- **播放音效**：播放页 →「音效」→ 弹层默认停在「播放音效」页签，两个页签、三个预设分组
  （设备预设 / 经典均衡 / 耳机校正）都在；切到「经典均衡」显示「VLC 经典预设（LGPL-2.1+）」，
  点「重低音」后开关行摘要变成 `重低音 · 低音 60% · 响度 50%`；切「耳机校正」列出
  索尼 WH-1000XM5 / 森海塞尔 HD 600 / 水月雨 …；滚下去三个滑块（低音 / 环绕 / 响度）
  与 6 档混响都在；切「界面音效」页签音色包还在。
- **效果器真的挂在播放会话上**：`dumpsys media.audio_flinger` 里有 5 行
  `Effect ID: N Session ID: S`，S 全是同一个播放会话 id（本轮 313）。
  **这是唯一算数的证据** —— UI 上选中了不代表效果生效。
- **两个入口同一份状态**：设置页那行摘要是 `重低音 · 低音 60% · 响度 50%`，
  和弹层里一字不差；进「设置 → 播放音效」后分组还停在上次看的「耳机校正」。
- **搜索联想**：搜索页输入 `zhou` → 出「搜索『zhou』」+ **周杰伦 / 周深 / 周传雄 /
  周杰伦全部歌曲 / 周华健 / 周笔畅 / 周慧敏 / 周华健全部歌曲 / 周杰伦 太阳之子 / 周兴哲**
  （酷我 `tips.kuwo.cn` 在线联想，**认拼音**）；出联想时历史与热搜已收起；
  点「周杰伦」→「找到 168 首」，行内是真封面。
- logcat 无崩溃、`LxAudioEffect` 无报错。

预览侧 `tools/ui-check.py` 从 46 项加到 **74 项**，全过（新增音效面板与搜索联想两段）。

### 实测记录（2026-10-08，v1.9.13，Android 14 / x86_64 模拟器）

这一轮只做两件事：**打开时那一下闪** + **打开速度**。

- **闪屏没了**：`tide_boot_bg` 改成跟着系统深浅色走（`values/` 浅 + `values-night/` 深），
  默认主题改成「跟随系统」，页面内联脚本在样式表前就把 `system` 解成具体明暗。
  实测启动录帧：**第 0 帧（t≈100ms）就已经是浅色 `#F4F5F8`，全程没有一帧深色**。
  改之前是「深色启动窗口 → 浅色界面」，那一下就是用户说的闪。
- **冷启动网络请求 44 → 1**：那 43 个全是酷我榜单封面（榜单有 43 个），
  以前一进 App 就全排上队（+3.5s ~ +7.5s）；改成滚到哪取到哪之后，
  冷启动只剩首屏那条 `getRcmPlayList`。**进榜单页首屏只发 6 个封面请求**（截图
  `shots/dev-charts-lazy.png` / `dev-charts-scrolled.png` 逐张都有真封面）。
- **首屏不再等网络**：`home` 只返回本地收藏列表，歌单广场改推事件。
  页面侧埋点：`home` 返回 **4617ms → 155~246ms**，首帧 130ms → 67ms。
- 启动时不再预画 43 张榜单卡（`renderCharts` / `renderLibrary` 本来 `goTab` 里就有懒加载，
  空闲回调里那次纯属白干）。

`tools/verify-fx-tips.py` 19 项断言全过（含播放音效与搜索联想两段回归）。
这一轮给它加了两处**重试**（`check()` 最多 8 次、首页节点数最多 10 次）：
慢速模拟器上「点完了画面还没换」会误判成失败，实测两次都误报过，
截图里界面明明是好的。

预览侧 `tools/ui-check.py` 74 项全过。

> **这轮最大的方法坑**：一开始拿模拟器的「空白时长」当指标，量出来 5~9 秒，
> 越改越困惑。最后靠「页面侧 `t+` 埋点 + 全量 logcat」才看清 —— 页面 67ms 就画完了，
> 是模拟器软件 GL 的一次绘制占了 **4064ms**（`OpenGLRenderer: Davey! duration=4064ms`），
> 把 `init` 的回执都挡住了。**模拟器的空白时长量的是 swiftshader，不是应用逻辑。**

### 实测记录（2026-10-08，v1.9.14，Android 14 / x86_64 模拟器）

用户报：**「手机黑暗模式开软件还是闪一下黑屏，白天模式会闪一下白色；有些跳转动画
比较生硬，你要统一的跳转动画」**。

- **先把「闪」分层定住**。在模拟器上按「界面跟随系统」跑了一遍启动录帧（深色）：
  **全程只有一种颜色（`#0A0B0F`），一次翻色都没有**。所以剩下的「闪」不是颜色不对，
  而是**内容一下子跳出来**（RN 那层是纯底色，WebView 首帧直接是整屏界面）。
  → 加淡入（`is-boot` / `revealApp`），见上文「最后那一下『闪』」。
- **顺手修了一个真的会翻色的场景**：主题存的是「跟随系统」时，用户关机时切了系统深色，
  存下来的还是浅色底 → 启动时系统窗口深色、RN 根视图浅色，深→浅→深闪两下。
  → 主题模式一起存（`bootBgMode`），三处按模式重算，见上文「主题模式要一起存」。
- **两种模式都录了帧**：深色下 `启动器 → #0A0B0F → 内容`，浅色下 `启动器 → #F4F5F8 → 内容`，
  **都没有跨主题的中间帧**。
- **转场**：页签切换与退子页补上了出场动画，进子页时上一层不再一下子消失
  （见上文「转场」那张表）。
- `tools/verify-fx-tips.py` 19 项全过（含返回键 —— 它走的就是 `currentScreen()`，
  正是这轮改动最容易碰坏的地方）。预览侧 `tools/ui-check.py` 74 → **84 项**全过，
  新增的一整段「转场」断言的是「动画类真的加上了 + 过程中两个屏幕同时可见」，
  只断言最终状态的话把动画删掉也能过。

> **动画的观感没法在这里自动验证**：一次 `screencap` 要 0.7~0.9 秒，
> 抓不到 0.3 秒的转场。所以转场只验了「机制对不对」（类的增删、可见性、返回键），
> 顺不顺眼得人看。

### 实测记录（2026-10-08，v1.9.15，Android 14 / x86_64 模拟器）

用户报：**「把设置并到我的里面成为一级菜单」**。

- **删掉了 `scr-settings` 二级页**（81 行 / 4423 字符），设置分组直接长在「我的」页里，
  见上文「『设置』并进『我的』当一级菜单」。截图确认「我的」页从上到下依次是：
  头像区（**没有齿轮**）→ 计数 → 快捷格 → **洛雪原生设置** → **偏好**（主题与外观 ·
  跟随系统 · 墨黑 · 薄荷 / 播放音效 重低音 / 界面音效 清透 · 65% / 消息通知）→
  **数据与隐私**（账号与本机数据 / 隐私设置）→ **其他**（关于潮汐音乐 / 帮助与反馈）→
  备注 → 我创建的歌单 → 我收藏的歌单。
- **两个入口还是同一份状态**：设备上先在弹层里把播放音效选成「重低音」，
  退回「我的」页，那行摘要就是 `播放音效 重低音`；再进「设置 → 播放音效」，
  分组仍停在「耳机校正」。断言直接落在**画出来的摘要文字**上，不是内部变量。
- `tools/verify-fx-tips.py` **24 项全过**（v1.9.14 是 19 项，新增「我的」页设置行那一段）。
- 预览侧 `tools/ui-check.py` 84 → **90 项**全过（把原来的「点齿轮进设置页」换成
  「设置行内联在『我的』里」+ 转场那 13 项）。
- `tools/check-ids.py`「所有 `data-*` 入口都能解析」、`tools/find-dead-css.py`
  「259 个类 0 个没用」都过。

> **这轮踩的坑：模拟器把「我的」页的首次绘制拖成了假 ANR**。点「我的」页签时
> 输入分发超时（5s），从 `/data/anr/` 拉 trace 看主线程卡在
> `ViewRootImpl.performTraversals → performDraw → ThreadedRenderer.draw → syncAndDrawFrame`
> —— 是**模拟器软件光栅化**（页面比别的页签高，一次绘制要好几秒），不是 JS。
> 换一台干净启动的模拟器重跑，页面正常渲染。
> **另一条**：设备回归连着三次报「找不到推荐/没能起播」，截图里却是**桌面（launcher）**
> —— 测试框架那句「首页渲染出来了」只数文本节点，而 launcher 的图标也是文本节点。
> 修法是让 `launch()` 轮询 `foreground() == 包名` 并**要求出现「想听点什么」这句界面文字**，
> 之后 24 项全过。

### 实测记录（2026-10-08，v1.9.16，Android 14 / x86_64 模拟器）

用户报：**「全面优化代码 减少开销 优化流畅度」**。

这一轮**先做量具再动手**：原来只有 `perf-run.py` 数 DOM 变更数，而这一轮的问题
（进度条的 `width` 过渡）**一个 DOM 结构都不改** —— 它改的是样式，而且是浏览器
每帧自己在改，数变更数根本看不见。所以新写了 `tools/_perf-cdp.mjs`（见 §二之三），
连 CDP 读 `Performance.getMetrics`，直接数重排/样式重算的次数与耗时。

- **播放中主线程 0.307s → 0.068s（每 3 秒），重排 501 → 13 次**，见上文那张表。
  对照段（有歌、迷你条在屏幕上、但不推进度）一直是 **0 次重排**，
  所以现在能说清楚「空闲时是真的什么都不做」。
- 三处「白做一遍」也一并修了：封面色渐变缓存（`player-change-song` 62ms → 25ms）、
  `syncBootBg` 去重（启动桥消息 2 → 1 条）、页签重复请求（`charts`/`library` 各 10 → 1）。
- **预览断言 90 → 93 项全过**，新增的三条是给进度条这个**新机制**补的：
  用 `getBoundingClientRect()`（会把 transform 算进去）验「真的画在 1/4 处」，
  再加一条「布局宽度仍满格、渲染宽度只有 1/4」—— 后者才是机制本身的证明，
  改回 `width` 的话布局宽度会跟着变。
- `tools/verify-fx-tips.py` **24 项全过**；设备截图里 `0:17 / 2:37`，
  进度条白色部分占轨道约 10.6%（17/157 = 10.8%），圆角由轨道裁出来，正常。

> **量具自身的一个坑**：第一版断言在 `seek()` 之后只等了 150ms 就量，
> 量到 `scaleX=0.148` —— 因为过渡本身就是 280ms，那时候还在半路上。
> **验「动画/过渡的终态」要等得比过渡长**，不然量到的是中间帧（和桌面版那条
> 「截图要等淡入播完」是同一类错）。等 600ms 之后就是 `scaleX=0.2506`。

### 实测记录（2026-10-08，v1.9.17，Android 14 / x86_64 模拟器）

用户一次提了三件（外加一条确认）：

> 「只能搜歌曲不能搜歌单 · 歌源切换和增加要加到我的一级菜单里 · 我创建的歌单放到收藏里 ·
> 还要能收藏歌单和创建歌单」

做法见上文「搜歌单 / 音源进「我的」/ 歌单搬进收藏（v1.9.17）」。实测：

- **搜歌单**：设备上搜 `jay`，切「歌单」页签 → **找到 74 张歌单**（跨平台聚合，
  卡片带真封面与播放量，点进去就是同一个歌单详情页）；切回「歌曲」→ 找到 154 首。
- **音源**：「我的」页那两行在（`音源切换 HYWmusic_beta_公益测试 · 共 5 个可选` /
  `添加歌源`）；点「音源切换」进原生音源页，列出了 `自定义源 / 星海音乐源 v3.2.15` 等
  与「自定义源管理」入口；点「添加歌源」**直接弹出导入弹层**
  （`自定义源管理（实验性）`，里面能看到已装的 `HYWmusic_beta_公益测试 v0.74.0`）。
- **收藏页**：「歌曲 / 歌单」两页签，歌单页签里是 `我创建的歌单 1`（带「新建」）
  与 `我收藏的歌单 0`；页头副标题写 `1 个自建 · 0 个收藏`。
- **「我的」页不再堆歌单列表**，只留一行入口（`自建与收藏的歌单`）。
- `tools/verify-fx-tips.py` **38 项全过**（v1.9.16 是 24 项）；预览侧
  `tools/ui-check.py` 93 → **113 项全过**；`check-ids.py` / `find-dead-css.py` 都过。
- 原生侧改动的 eslint：新文件 `ApiSourcePane.tsx` 与 `Source.tsx` 零报错，
  `bridge.ts` 只多了 1 条（与文件里既有的同类写法一致）。

> **这轮的两条方法是踩出来的，都记进坑 43/44 了**：「我的」页变长之后
> `tap_text('播放音效')` 点到了底栏的「收藏」（uiautomator 对屏幕外节点照样给坐标，
> 点下去落在被裁到边缘的那个位置）；而点「收藏」时又点到了「我的」页统计里的
> 「收藏」那个非可点 span（`find` 取的是第一个匹配，统计在底栏前面）。
> 于是加了两个助手：`tap_row`（点之前先滑进屏幕）和 `tap_last`（点最下面那个）。
> **都是「按文字点」这条路本身的坑，不是应用的 bug** —— 界面在两次误点之后都渲染得好好的。

### 实测记录（2026-10-08，v1.9.18，Android 14 / x86_64 模拟器）

只修上面那两个列表错 + 「新建歌单」自动聚焦。另外这一轮把**「收藏歌单 / 创建歌单」
这两件事真做了一遍** —— 上一轮只验了入口在不在，那不算数：

- **新建**：收藏 → 歌单 → 新建 → 输入 `tide120221` → 创建 → 「我创建的歌单」
  从 1 变 2，那个名字就出现在列表里。
- **收藏**：搜索 `jay` → 歌单页签 → 点开一张真歌单（`jay / 漩涡小小魚y · 30 首`）
  → 详情页点「收藏」→ 回「收藏 · 歌单」，第一次跑是 `0 → 1`。
- **列表不再重复**：动手前读到的是「我创建的歌单 0 / 我收藏的歌单 0」，
  「我喜欢的音乐」不再混在自建里（这正是这一版修掉的）。
- `tools/verify-fx-tips.py` **42 项全过**；预览 `ui-check.py` 113 项全过；
  `logcat 没有崩溃`（判据改成只看自己进程之后，不再被模拟器自带应用的崩溃误报）。

> 这一轮**连着假失败了五次**，全在测试脚本这一侧，都记进坑 43-46 了：
> 点歪到别的元素（屏幕外的行 / 重名的标签）、`SAFE_TOP` 设太大把标题栏按钮挡在外面、
> 崩溃判据没看进程名、在页签层多按一次返回（App 退到后台，后面全都找不到）、
> 以及**跨轮数据没考虑**（上一轮已经收藏过同一张歌单，重复收藏不计数才是对的，
> 断言却按 +1 写）。界面本身每次都是好的 —— 截图里能看见。

### 实测记录（2026-10-09，v1.9.19，Android 14 / x86_64 模拟器）

用户提了五件事，四件「看起来不对」+ 一件「少东西」。按 §二之四 逐项真点真截图
（`shots/dev-fx-*.png`）：

- **音源页是潮汐自己画的那一版**：进页面有「当前音源」卡（强调色渐底 + 大字号名字）、
  可用音源列表（`可用音源 5`，五行带版本与说明，当前那个是强调色标题 + 勾）、
  底部「添加音源」。**真点了一下另一个源**：`HYWmusic_beta_公益测试 → 星海音乐源`，
  卡里的名字跟着变、有提示，退回「我的」页那行摘要也变成新源。再点一次切回来。
- **「猜你喜欢」是 30 首**：标题上写着 `猜你喜欢 30`（本地收藏 0 首 + 榜单补足 30 首）。
- **搜索结果的封面**：搜 `周杰伦` → 168 首，截图 `dev-fx-12b-search-covers.png` 里
  前六行（含同一首歌的三个不同平台版本）**全是真专辑封面**，没有渐变块。
- **「我的」页没有歌单入口行了**：整页里「歌单」两个字只剩统计里的那个 `歌单` 计数。
- **原生子页面的配色跟着界面走**：设置页、音源页、评论这些原生页面的底色/卡片/文字/
  强调色都是界面推过去的那一组（预览里用 `Tide._lastTheme()` 断言了推的就是
  界面此刻的计算样式；设备上表现为深色界面里点设置不会蹦出白页）。
- `tools/verify-fx-tips.py` **50 项全过**（v1.9.18 是 42 项）；预览 `tools/ui-check.py`
  113 → **135 项全过**；`check-pick-spread.mjs` 21 项全过；
  `logcat 没有崩溃` + `原生音效模块没有报错`。

> **这一轮最大的收获是翻出一个会让 App 假死的死循环**（见坑 48）：
> `pickSpread` 里写死的步长 7 在池子长度是 7 的倍数时永远走不出循环。
> 它不是这轮引入的（「每日推荐」一直在用），但这轮新写的「猜你喜欢补足」又拿它挑歌，
> 触发面变大了。修完补了 `tools/check-pick-spread.mjs`（从源码抽函数来测，不是抄一份）。

> 另外两次「假失败」也都记下来了：**装错了 ABI 的包**（坑 47，用 arm64 构建产出的
> universal 包装到 x86_64 模拟器上，缺 `libquickbase64.so` → 一进搜索页弹报错弹窗），
> 以及**音效弹层两个页签的抖动**（截图证明界面是好的，是无障碍树没跟上 ——
> 所以那两条断言改成了「点了没换成就再点一次」，见 `tap_until`）。

### 实测记录（2026-10-09，v1.9.20，Android 14 / x86_64 模拟器）

用户第二次反馈：「原生设置还是没有变化 音源点进去三级菜单还是很割裂 没有变化 继续改」。
按 §二之五 逐项真点真截图（`shots/dev-fx-*.png`）：

- **「添加音源」不再是内核那个弹层**：页面自己有「从在线地址导入」（输入框 + 导入）、
  「从本地文件导入」（选择脚本文件）、「已装音源」列表（每行一个垃圾桶）；
  界面上**找不到**「自定义源管理」「实验性」这些字。
- **真跑了一遍完整导入链路**（不做假动作）：起一个本地 HTTP/1.1 服务放一份真脚本
  （拿内置 `helloworld.js` 改个 `@name`）→ 在界面里填 `http://10.0.2.2:<port>/tide-test.js`
  → 点「导入」→ **「导入成功」+ toast「音源已导入」+「已装音源」6 → 7**。
- **删除是两段式**：点垃圾桶 → 原地出现「取消 / 删除」；点「取消」那条还在；
  再点垃圾桶、点「删除」→ 那条不见了、「已装音源」7 → 6（回到动手前）。
- **原生设置页的骨架换了**：可点宽行的行高（按 `wm density` 2.75 换算）是
  `[8, 43, 55, 56, 64, 65]` dp —— **54dp 那一档在**（潮汐的 `.s-row`），
  **46dp 那一档没了**（安卓版原来的行高）。截图里也能直接看到：居中的 16px 标题、
  12px 浅灰小标题、22 圆角带描边的卡片、54dp 行、48×29 的薄荷色开关。
- `tools/verify-fx-tips.py` **65 项全过**（v1.9.19 是 50 项）；预览 `tools/ui-check.py`
  135 → **163 项全过**；`logcat 没有崩溃` + `原生音效模块没有报错`。

> 这一轮**排查占的时间比写代码多**。三条值得记住的（详见坑 49~56）：
> ①自己搭的测试服务端是 HTTP/1.0，让 App 的 fetch 报「无法连接到服务器」，
> 而服务端日志明明 200（坑 53）；②同一个模拟器上不能同时跑两个验收脚本（坑 49）；
> ③模拟器开着的时候打包会 OOM，把 `max-old-space-size` 调大反而更糟（坑 55）。
>
> 还有一条产品侧的改动是**从证据里得出来的**：App 自己的日志显示那次 fetch 只活了
> 254 ms 就失败（同一进程此前开了很多音频连接），所以给「从在线地址导入」加了
> **一次重试** —— 真实用户遇到偶发网络抖动也不该重新点一遍「导入」。

### 实测记录（2026-10-19，v1.9.21，Android 14 / x86_64 模拟器）

用户要求「全面重构ui 要求美观大气 简洁实用」。这一轮没有加功能，只重写视觉层：

- 预览 163 项、设备 65 项全过；亮/暗、360/411 逐屏截图（`shots/v2-*.png`、
  `v2d-*.png`、`v2-home-360.png`）。
- 设备上首页/我的/音源/添加音源/收藏/歌单/设置/播放页都按新版画出来了；
  原生设置页保持 v1.9.20 的潮汐骨架（54dp 行、薄荷开关）。
- 第一次设备跑挂在**音源**上：当前源 `HYWmusic_beta_公益测试` 取不到播放地址
  （弹「这首歌暂时放不出来」），换成 `星海音乐源` 后同一套流程 8 秒起播。
  这是外部源的问题，不是界面（截图在 `shots/dev-fx-02-player.png`）。
- 为了「大气」后的可见行数变化，设备脚本补了三处滚动（我的/音源/收藏），
  并过滤了原生设置页上的迷你播放器浮层（坑 57~60）。
- 交付前 `deliver-arm64.py` 的版本号检查顺手修了：`aapt dump badging` 的输出
  是 **versionCode 在前、versionName 在后**，旧正则按相反顺序匹配，永远读不到
  （这轮 `aapt2` 手工复核是 `1.9.21 / 106003`）。

### 实测记录（2026-10-19，v1.9.22，Android 14 / x86_64 模拟器）

用户要求「播放页面很难看 全面整改 切换歌词的时候动画很生硬 全面加强动效」。

- 预览 **170/0**（新增 8 项歌词断言）；设备 **67/0**（新增 2 项歌词切换断言）。
- 设备截图确认：真封面做模糊背景、黑胶从封面后探出、底部六项带标签、
  歌词态当前行白色 + 光晕、提示胶囊文案随状态切换。
- 这轮**代码没出问题，出问题的是模拟器环境**：另一个会话的 Starbase harness
  反复拉起 `lx_phone`（5554），我又在 5556 起了同一个 AVD，两个实例共用
  一份 userdata → qemu `c0000005` / system_server 重启；表现是「点播放页没反应」
  「截图 0 字节」「突然跑到星幕影院」。最终用**独立 AVD `lx_phone2`** +
  `ANDROID_SERIAL=emulator-5556` + `NO_SHOTS=1`（跳过 screencap）跑完 67 项。
- `shot()` 现在支持 `NO_SHOTS=1`；要拍设备截图时去掉它，用
  `verify-fx-tips.py player` 单独跑一遍即可。
- 另一个测试侧的修正：`flow()` 开头先 `go_home()`（冷启动可能落在上次停留的
  页面）；进播放页前等 0.8s，让迷你条的 `.3s` 入场动画落位再点。

### 实测记录（2026-11-15，v1.9.23，Android 14 / x86_64 模拟器）

用户说「有很多bug 你要全面修复 比如搜索界面不能改音源等」。

- 预览 **193/0**（新增 23 项）；设备全量 **67/0** + 搜索短流程 `search` **7/0**。
  全量第一跑出的 2 条 FAIL（联想列表没出、历史/热搜没收起）根因是**点完平台
  chip 焦点被拿走**，`input text` 打到了空处 —— 不是联想挂了；`setSearchSource`
  把焦点还给输入框后，`search` 短流程 7 项全过。
- 全量复跑没能在同一台模拟器上跑完：宿主机内存只剩 2.3GB（UnrealEditor 占
  1.85GB），qemu 起来几分钟就被压崩。改动的搜索路径已经用短流程在设备上验过，
  其余 67 项与焦点修复无关、首跑已全过。
- 这轮的教训：**加工具函数前先撞一眼现有名字**。这轮写了个 `sourceName(list,id)`
  当平台短名查询，跟音源页早就有的 `sourceName(d,id)` 撞名 —— 后声明覆盖先声明，
  音源页立刻变成「正在读取…」+ 0 个源，预览套件当场红了一片。改成
  `platformName` 才好。命名冲突在 JS 里不报错，只有测试能兜住。

### 更新下载提速 + 更新弹窗重做（v1.9.35；v1.9.34 是同一轮首版、已作废）

用户原话：「下载界面超级慢 还很容易失败 下载界面也很难看」，附手机截图：弹窗里一屏
**裸 Markdown**（`##`、`**`、反引号原样露出来）、长说明把进度挤到看不见、158 KB/s
下到 2.66 MiB / 14.32 MiB（18.61%）。

**1. 下载前并发测速择优**（`probeSpeed`，`src/utils/version.js`）
- 对 manifest 里的每个源（官方直连 + 两个 ghproxy）并发下一个 300KB 的 `Range` 段，
  实测 B/s，从快到慢排序后再下整包。慢源不再挡路：以前是「按数组顺序试」，
  第一个源 158 KB/s 用户就得跟着等十几分钟。
- 每个源独立临时文件（`tide-probe-<i>.tmp`）——并发写同一个路径会互相覆盖，测出来不准。
- 300KB 或 5 秒任一先到就停；不可达的源记 0 分排到最后。
- 下载失败立刻换下一个源（`unlink` 残包 → 下一个），超时收紧到连接 10s / 读 20s。
- 每个源落盘后校验 `size` + `sha256`，不符抛「校验失败：内容与官方发布不一致，已丢弃」。

**2. 更新弹窗重做**（`VersionModal.tsx` + 新增 `src/utils/markdown.tsx`）
- 自写零依赖 Markdown 渲染（复用已有的 `he` 解实体）：`#`–`######` 标题、`**加粗**`、
  `` `行内代码` ``、`-`/`*` 列表、空行间距。裸符号不再露出来。
- `Content` 加 `compact`：**下载中只显示两行版本号**，长说明整段折叠，把空间让给进度。
- 新增**真实进度条**（6px 圆角，按 `progress.current/total` 填充）+ 百分比与 MiB 文本。
- 下载中 / 失败都显示「👉 打开网页手动下载」（`openReleasePage()` → Linking；
  i18n 三语加 `version_manual_download`）。

**3. 一个真 bug：manifest 地址拼成了 `version.jsont=...`**
- 起因：raw / ghproxy 会按路径缓存 `version.json`，换 manifest 后老用户几小时拿不到新内容
  （实测 GitHub Contents API 已是新内容，raw 还在吐旧版），所以要加缓存击穿参数。
- 第一版写成 `const bust='?t='+…; base + (base.includes('?')?'&':'') + bust.slice(1)`，
  `slice(1)` 把 `?` 切掉了 → URL 变成 `…/version.json` + `t=…` 粘连，manifest 全源失败，
  关于页显示「检查失败」。改成 `bust='t='+…` + `(base.includes('?')?'&':'?')` 后正常。
- **v1.9.34 的 Release 资产是修复前打的包，已作废**；线上 manifest 直接指向 v1.9.35。

**4. 设备实测（x86_64 模拟器 + 本地 mock 更新源）**
- 起 `tools/_mock-server.mjs`（8899，APK 限速 300KB/s、测速探针 ≤512KB 全速返回，
  免得限速把测速排序带偏），manifest 指向 `10.0.2.2:8899`，装 1.9.34 测试包。
- 更新弹窗自动弹出：Markdown 标题/加粗/行内代码/列表全部正确渲染。
- 点「更新」后截到中间态：绿色进度条约 10%，「正在努力下载中... 1.57 MiB/14.63 MiB
  (10.74%)」，长说明已折叠、只剩两行版本号，下方「打开网页手动下载」+「后台下载/安装」。
- 完整下载过 sha256 校验并调起系统安装器（模拟器拒绝未知来源，属预期）。
- 中途把 mock 的 sha256 写成旧包的值，客户端确实丢弃并切下一个源 —— 校验链路有效。

**5. 发版**
- Release v1.9.35：`TideMusic-v1.9.35-arm64.apk`（15,013,619 B，
  `fd811f64b77ffad3b98f3656332644eabfd34d9f0b513d6702a884b59a79353c`）、
  `TideMusic-Pad-v1.9.35-arm64.apk`（15,013,628 B，
  `a36979086fba868cf768fd94593d1ac4282a4a741f4d60393c755544463dae5c`）。
- 线上 `version.json` 已覆盖成 1.9.35（此前测试期间一度是伪造的 1.9.99，已清掉），
  三个 manifest 源实测都能取到新内容；GitHub API 的资产 `digest` 与 manifest 逐字节一致。

### 关于页「检查失败」的真因：门面白名单漏挂（v1.9.36）

用户装了 1.9.35 后点「关于 → 检查更新」永远「检查失败」。模拟器上复现，logcat 显示
manifest 7/7 源全部命中（网络没问题）；把 catch 到的 message 临时显示到界面上抓到真因：
**`Tide.checkUpdate is not a function`** —— `music-ui-mobile/api.js` 把后端方法挂到
`Tide` 门面时用的是**白名单数组**，`checkUpdate` 从来没加进去。所以从「关于页加检查更新」
那版（v1.9.32）起这个按钮就一直是坏的；之前看到的更新弹窗都是**启动时自动检查**弹的。
修法：白名单加 `'checkUpdate'`，展示逻辑改成先判 `r.latest`（否则会显示
「新版本 v<当前版本>」）。**同类坑：白名单和 app.js 的调用没有静态约束**，以后新增桥命令
必须两处同时改；`tools/_scan-tide-api.mjs` 这种比对脚本可以临时重写（本轮用完已删）。

顺带把 manifest 拉取从「串行试源」改成**并发抢占**（v1.9.36）：
- 7 个源（fastly/gcore/cdn jsDelivr + ghproxy/gh-proxy/ghfast + raw 直连）全部并发，
  单源 8 秒超时（RN fetch 默认**没有**超时，被黑洞的源能挂到系统 TCP 超时）；
- 收集所有成功响应后取**版本号最高**的一份，防止某个 CDN 缓存旧 manifest；
- APK 下载镜像新增 `ghfast.top`，仍逐源测速择优 + size/sha256 校验。

设备实测（x86_64 模拟器，真实网络）：同一台机器上 1.9.35 点「检查更新」立即「检查失败」，
1.9.36 显示「已是最新」。

### 国内更新源加固 / manifest 驱动（v1.9.33）

用户问「主要国内用 会不会下载很慢」「主要别人也要用啊」，并指了「新闻重构2」
（= `D:\anzhuang\新闻配音重构\`，源码在 `draft-a8ffe8e8…/news_dub`）说「这个项目就做了国内源」。
照搬它的做法，把更新链路从「写死 GitHub Releases API」改成 **manifest 驱动**。

**新闻那套的核心**（`app/config.py` + `app/updater.py`，已读源码）：
- 更新源是一个可配置的 `version.json`：`{version, notes, zip, mirrors:[], sha256, size}`。
- manifest 地址本身走多镜像：`ghproxy.net` → `gh-proxy.com` → `raw.githubusercontent.com`
  依次试（国内 raw 常被墙，ghproxy 抽风就退下一个）。
- 下载包按 `zip` → `mirrors` 逐个试，每个都校验 size + sha256，坏包/篡改包丢弃换源。
- **精髓**：下载地址全在 json 里，换源只改 json，老用户不用装新版。

**本版照搬**：`src/utils/version.js` 整份重写——
- manifest 放本仓库 main 根目录 `version.json`；App 只写死 manifest 地址
  （`ghproxy.net/` → `gh-proxy.com/` → raw 直连三个前缀）。
- `getVersionInfo()` 先读 manifest（取 version/notes/history），**失败自动回退** GitHub
  Releases API（老链路），不会因为一个 json 抽风就完全查不了更新。
- manifest 结构：`{version, notes, history:[{version,notes}], apk:{phone:{url,mirrors,sha256,size}, tablet:{…}}}`。
- `downloadNewVersion()` 从 manifest 取对应 flavor 的 apk 配置，按 `url` → `mirrors`
  逐个下载，每个校验 `stat().size` + `hash(path,'sha256')`（`react-native-file-system`
  的 `hash` 支持 sha256），全失败才抛错。
- 更新弹窗错误态加「打开网页手动下载」链接（`openReleasePage()` → Linking），
  i18n 三语都加了 `version_manual_download`。

**下载源顺序（按本机实测，2026-11-18）**：
| 源 | 速度 |
| --- | --- |
| GitHub 官方 asset（302 到 release-assets CDN） | 470 KB/s，**最快** |
| ghproxy.net | 168 KB/s |
| gh-proxy.com | 121 KB/s |
| manifest 三个源 | 都 200，2094B |

所以 manifest 里 `url` 放 GitHub 官方直连、`mirrors` 放两个 ghproxy 兜底——
官方直连在国内大多可用且最快，ghproxy 只是「别人网络不通官方时」的后备。
**没掺第三方镜像做首选**：下的是安装包，镜像随时挂且过第三方手里有篡改风险，
但即便走了镜像也有 sha256 兜底。

**发版流程变化**（以后换下载源不用发版）：
1. 改代码只改 App 行为时照旧 bump + 打包 + 发 Release。
2. **只换下载地址/版本说明**：直接改仓库 main 的 `version.json`（PUT），
   把新的 `sha256`/`size`/`url` 填进去——老用户下次检查更新就走新地址。
3. manifest 里的 sha256/size 必须与 Release 资产**逐字节一致**，否则客户端会
   `校验失败，已丢弃` 并换下一个源（这正是防护）。核对命令见 `build-staging/version-*.json`。

**端到端已核对**：manifest 三源都 200 且线上==本地；v1.9.33 两个 Release 资产的
size/sha256 与 manifest 完全一致；两个 APK bundle 都含 `version.json`/`ghproxy.net`/`sha256`
逻辑。

### 应用内更新 + 自己的 Release 仓库（v1.9.32）

用户要求「把软件放我仓库里 软件也要有应用内更新功能」。

**仓库与资产约定**

- 公开仓库 `meiyoume/tide-music-android-release`（只放 release，不放源码）。
- 每个 release 传两个资产，名字是这条链路的契约（`src/utils/version.js` 靠它挑包）：
  `TideMusic-v<version>-arm64.apk`（手机）/ `TideMusic-Pad-v<version>-arm64.apk`（平板）。
- 挑包**不看版本号，只看有没有 `Pad`**：这台设备是哪个 flavor 由
  `NativeModules.UtilsModule.appId` 决定（以 `.tablet` 结尾 = 平板），
  这个常量是本轮在 `UtilsModule.getConstants()` 里补的。

**链路**

1. `GET /repos/{owner}/{repo}/releases?per_page=20` → 第一条非 draft/非 prerelease
   当最新版，`tag_name` 去 `v` 得版本号，`body` 当更新说明，`slice(1,9)` 当历史列表。
2. 版本比较用内核原有的 `checkUpdate()`（`src/core/version.ts`），命中新版本走上游
   已有的 `VersionModal`（下载进度 / 忽略此版本 / 历史说明都是现成的）。
3. 点「更新」→ `downloadFile()` 落到缓存目录 → `installApk()`（FileProvider，
   manifest 里 `REQUEST_INSTALL_PACKAGES` 原本就有）。

**为什么上游这条链以前是关的**：`src/utils/version.js` 原来拿 `package.json` 的
author/name 去对 `lyswhut/lx-music-mobile`，本移植版版本号永远落后 → 永远提示有新版本，
下载到的还是原版洛雪 APK。换成自己的仓库后这两个理由都不成立，
`src/core/init/index.ts` 的 `CHECK_UPDATE_ON_STARTUP` 改回 `true`（异步、不挡首屏）。

**两个必须一起改的地方**

- `src/core/version.ts` 的 `checkUpdate()` 原来**不返回** versionInfo（两条分支都
  `return` 空），桥里拿不到版本号。改成返回 versionInfo。
- 桥的 `init` 现在回 `version`（读 `package.json`）+ `form`（phone/tablet），
  界面「我的 → 关于」的版本号就来自这里，不再手写。

**界面侧**：「设置/我的 → 关于」显示真实版本；下面多一行「检查更新」，
点一下把按钮文字依次改成 检查中… → 已是最新 / 发现新版本 vX / 检查失败，
并用 toast 兜底；发现新版本时弹的还是内核那个 `VersionModal`（可直接下载）。

**实测到哪一步（诚实记录）**

- 在模拟器上装了临时打的 1.9.31 x86_64 包，点「检查更新」→ 弹窗正确显示
  「发现新版本 / 最新版本: 1.9.32 / 当前版本: 1.9.31 / 更新说明…」（截图核对过）。
- 点「更新」**下载失败**：这台模拟器上不了 github.com（宿主机自己也要走
  `127.0.0.1:7897` 代理才能下 release）。探过一批镜像（ghproxy.net / gh-proxy.com →
  400，gitproxy.click 回 HTML，其余不通），没找到可用的。**所以「下载 → 安装」这段
  只验证到接口与 URL 正确，没在设备上跑通**；能上网的手机上应该正常，
  但如果用户那边也下不动，第一嫌疑就是这个网络。
- 验证完成后把 `package.json` 改回 1.9.32 并重打了 arm64 包交付。

**发版流程**（下次照抄）

```bash
# 1. 改 package.json 的 version / versionCode，写 release notes
# 2. 同步界面资源 + 前台打包两个 flavor（见上面「怎么用」）
# 3. 交付校验（顺手把桌面旧包删掉）
python tools/deliver-arm64.py <version> harmony
python tools/deliver-arm64.py <version> tablet
# 4. 传 release —— 这台机器 git 不在 PATH，gh 必须显式 -R
gh release create v<version> build-staging/TideMusic-v<version>-arm64.apk \
  build-staging/TideMusic-Pad-v<version>-arm64.apk \
  -R meiyoume/tide-music-android-release \
  -t "潮汐音乐 <version>" -F build-staging/release-notes-<version>.md
```

**versionName 必须严格递增、且与 tag 一致**，否则「永远有新版」或「永远没新版」。
检查用 `Get-Content` 看 `package.json`，别只看 tag。

### 冷启动提速（v1.9.31）

用户报「软件打开速度要狠狠的优化」。先量再改：x86_64 模拟器上（`tools/_startup.py`，
用 `am start -W` + logcat 的 `Displayed` / `Running "lxm.HomeScreen"` /
`[TideWeb] t+…` 与进程启动时间对齐）拆出来是四段：

| 段 | 改前 | 改后 | 说明 |
| --- | --- | --- | --- |
| 进程启动 → RN JS 开始执行 | ~460ms（重启后 650–900） | 没动 | SoLoader/Hermes/RN bridge，是原生固定成本 |
| JS 开始 → HomeScreen（内核初始化） | ~576ms（慢时 990ms） | **~420–460ms** | 把「音源/播放器恢复」挪出关键路径 |
| HomeScreen → 页面 app.js 开始 | ~780ms | **~600ms**（页面加载 352ms） | 资源压缩 + 脚本 defer |
| app.js → 首帧 | ~100–200ms | 没动 | 页面自己的启动（init + renderHome） |

**做了什么**

1. **内核初始化拆两段**（`src/core/init/index.ts` 的 `initBackground`）。首屏真正需要的
   只有「设置 → 主题 → i18n → 列表 → 公共状态」；`installBuiltinSources`（写 24 个脚本，
   实测 183ms）、`initUserApi`（43ms）、`initPlayer`（234ms，含**恢复上次播放会给上游发
   真实请求，网络不好时能卡 1.5–3s**）全部移到后台。触发点是界面把首屏数据（`home` 命令）
   取回来之后（`src/tide/background.ts` + bridge 的 home 分支），另有 4s 兜底。
   桥的 `init` 用 `kernelReady`（`src/tide/ready.ts`）挡住，保证回给界面的快照一定是
   内核就绪之后的 —— 不会出现「首页空着 / 迷你条没有上次那首」。
   **实测证明这个拆分不是省 460ms 那么简单**：对照包（串行版）HomeScreen 时间会
   在网络差时飙到 +1216~+1957ms，拆分版稳定在 +420~+690ms。
2. **Web 资源压缩**（`tools/sync-tide-assets.mjs`）：386KB → 271KB。
   JS 用 terser 但**只去注释/空白**（`compress:false, mangle:false`，不冒险重写逻辑）；
   CSS 用脚本里的扫描器去注释 + 折叠空白（跳过字符串里的 `/*`，不删 `calc(a + b)` 与
   后代选择器 `a :hover` 需要的空格）；HTML 不动。
3. **三个脚本从 body 末尾挪到 head + `defer`**：原来要等 75KB HTML（含整份图标 sprite）
   解析完才去请求它们；defer 让浏览器从头部就开始抓取/编译，顺序与语义不变
   （`app.js` 照样在 DOM 就绪时启动）。页面加载 653ms → **352ms**。

**试过但回退的（都是实测负收益或持平，别再加回来）**

- **WebView 缓存**（`cacheEnabled` + `LOAD_DEFAULT`）：HomeScreen→页面脚本反而从
  ~700ms 涨到 ~860ms，且引入「升级了 APK 界面还是旧的」风险。已回到 `LOAD_NO_CACHE`。
- **onCreate 里建一个 1×1 透明 WebView 预热 Chromium**：模拟器只有 4 个 vCPU，
  WebView 初始化与 RN 启动互相抢 CPU，`TotalTime` 从 ~0.6s 涨到 ~2.0s。
- **先 setRoot 再跑内核初始化**（让 WebView 和内核并行）：RNN 的 `setRoot` 自己就要
  ~450ms，和内核初始化抢 JS 线程后，首帧并没有变早（1353 → 1507ms），已回退。
- **把播放监听单独留在关键段**（想消除「首帧后 ~200ms 内点歌没有状态反馈」的窗口）：
  实测 HomeScreen 偏移从 ~460ms 涨到 540–900ms，为了一个几乎点不到的窗口不值，已回退。
  现在的顺序是：首帧出来后后台段先装音源再 `initPlayer`（注册监听 + 恢复上次播放），
  监听大约在首帧后 150–200ms 挂上。

**怎么复现这笔账**

- `python tools/_startup.py 3`：连续冷启动，按进程起点打一张表
  （jsstart / homescreen / loadstart / appjs / paint / home，并给出「从 jsstart 起」的差值）。
- 要看每一步内核初始化的耗时：把 `src/utils/bootLog.ts` 的 `BOOT_LOG_TIMING` 改成
  `true` 重新打包，`adb logcat | findstr "\[Boot\]"`。
- **量具坑（这次踩了两条）**：① 模拟器上残留的**别的 App** 会毁掉所有数字 ——
  实测 `com.starbase.phone` 独占 79% CPU，那几轮 `TotalTime` 全是 2–5s 的假数
  （`adb shell top -b -n 1` 先看一眼，必要时 `pm disable-user` 再测）；
  ② **跨会话的数字不可比** —— 模拟器重启后原生启动段能从 460ms 变成 900ms，
  只有同一会话里交替装 A/B 包的中位数才有意义（这次 A/B：jsstart→首帧
  **1353ms vs 2733ms**，`TotalTime` 1269 vs 1647）。

**顺带调整的交付校验**：`tools/deliver-arm64.py` 原来拿 APK 里的界面资源跟
`music-ui-mobile` 源码逐字节比 —— 现在 assets 是有意压缩的，改成跟**构建输入**
（`android/app/src/main/assets/tide/`）比，另加一条「构建输入不旧于源码」的 mtime 检查，
防止改了界面却忘了 sync。

### 进度条拖拽卡顿 / 延迟（v1.9.30）

用户报「播放音乐界面 拖动播放条快进或者后退 比较卡顿 也有延迟 哪个条也延迟的厉害」。
三个原因叠在一起：

1. **拖拽期间内核还在推进度**（4 次/秒）。原来的 `paint()` 只是把 `progressSig` 清空，
   于是下一个进度事件照样调 `updateProgressUI()`，按**正在播放的位置**重画 ——
   手指拖到 80%，250ms 后条子自己弹回 30%，再拖又弹。看着就是「拖不动 / 延迟」。
   现在加 `seeking` 状态位：拖拽期间 `updateProgressUI` 直接 return，位置只由手指写。
2. **每次 pointermove 都 `getBoundingClientRect()`**：读数紧跟在写样式后面，
   等于每个移动事件都强制同步重排一次。改成按下时量一次缓存，拖拽期间用缓存。
3. **移动事件比屏幕刷新还密**，每来一个就写三处 DOM。改成 rAF 批处理，每帧最多画一次。

松手那一下的「延迟」：原来是 `Tide.seek()` 之后要等内核下一帧进度事件（0~250ms）才动。
现在松手先在 `is-dragging` 状态下把条子和时间画定（无过渡），再去 seek；另用
`seekHold`（900ms）挡住可能还在路上的旧位置事件，避免松手后回弹一下。

顺带：拖拽时给 `<html>` 加 `is-seeking`，把播放页那两个常驻合成动画（背景 56px 模糊
漂移 + 封面呼吸）暂停掉 —— 低端机上它们会和条子抢合成器。

**量具**：`music-ui-mobile/tools/_probe-seek2.mjs`，用 CDP `Input.dispatchMouseEvent`
走**真实指针路径**（命中测试 + `setPointerCapture`）拖一次，读 `#pFill` 的 scaleX：

```
down20 0.2 → move50 0.5 → 停手 900ms（内核推 3~4 次进度）仍是 0.5
→ move80 + 松手 0.8 → 600ms 后 0.802（从 seek 目标继续走）
```

停手 900ms 不变这一条就是这次的核心：换回旧代码它会往「播放位置」漂回去。

### 全站视觉重构 + 平板版（v1.9.28）

用户原话：「ui很难看 重构ui 美化 好看 简单 实用 颜色搭配合理 也要做个平板版的 两个一起交付」。

**视觉层**（`music-ui-mobile/styles.css` 末尾追加一整段 v3，不动类名与 JS 钩子）：

1. 表面只留两种 —— 页面底 `--bg` / 卡面 `--bg-elev`。强调色只给「选中 / 正在播 / 主按钮」。
   上一版每个入口、每个设置图标都铺一层强调色浅底；暖砂（琥珀）皮肤下整页像蒙了层米色脏滤镜。
2. 字号收四级（25–28 / 17 / 14.5 / 12），标题统一负字距；圆角只留 22–28 / 14–16 / 99 三档。
3. 新增 `--accent-ink`：浅色下把强调色压深 62% 再当文字/图标色。琥珀 `#FFB454`
   直接写小字，白底对比度不到 2:1（看着发糊）。暖砂皮肤同时重调成干净纸感
   （底 `#F7F5F1` + 纯白卡面），不再米黄发浑。

重画到的：首页（胶囊搜索、深色「每日推荐」编辑卡、中性图标快入口）、分区标题、歌单卡、
歌曲行（正在播的整行加 7% 底色）、榜单特色卡（左信息 / 右前三）、搜索 chips 与热搜、
设置分组、迷你条、页签栏（选中态加浅肤色胶囊）、播放页（标题层级、封面 26 圆角、
主色播放键）、抽屉。

**平板版**：同一份源码、同一套 UI。CSS 断点 `@media (min-width:820px) and (min-height:520px)`：

- 232px 左侧栏（品牌位 + 四个页签，替换底部栏）
- 内容区宽留白；首页 12 栏网格（每日卡占 7 栏、快捷入口 2×2 占 5 栏、底边对齐）
- 为你精选自动网格、歌曲列表两列、榜单三列、歌单两列
- 播放页双栏：左封面 + 曲名/歌手/提示，右进度条/控件/六个动作
- 抽屉变居中对话框

断点为什么带 `min-height`：手机横过来也有 ~870 CSS 宽，但只有 ~390 高 ——
侧栏 + 双栏播放页在那种比例里会挤成一团。带高度就把「横过来的手机」挡在外面。

**打包开关**：

```powershell
# 手机版（行为不变：方向 unspecified）
powershell -File D:\android-tools\build-android.ps1 arm64-v8a assembleRelease
# 平板版
powershell -File D:\android-tools\build-android.ps1 arm64-v8a assembleRelease -Ptablet
```

`-Ptablet` 只换四样：applicationId `…harmony.tablet`（与手机版/原版共存、数据独立）、
桌面名「潮汐音乐 Pad」、`sensorLandscape`、产物名 `-tablet-`。
manifest 里两处占位：`android:label="${appLabel}"`、`android:screenOrientation="${tideOrientation}"`。

**这轮的坑**：

- 无头 Edge 的 `--screenshot` 合成路径**会漏画**带模糊/变换/滚动的层：队列抽屉整块白板、
  平板播放页右栏消失 —— DOM 里量出来的 rect/opacity 全正常。截图改走 CDP
  `Page.captureScreenshot`（`tools/_shots-v3.mjs`）。
- `preview.html` 在 `noboot=1` 时顺手加 `html.no-motion`：虚拟时间不推进 opacity 类合成动画，
  带 delay 的入场动画会停在 `opacity:0`。
- 这台机器上**从 Python 的 subprocess 拉 msedge 会 0.1 秒退出**（rc 0、不写文件、不报错），
  从 Node 的 `spawn` 拉正常 → `ui-check.py` 的浏览器那一半改成 `tools/_edge-open.mjs`。
- 平板播放页把 `.player__top` 改成 `display:contents` 后，`.player__meta` 与两颗按钮
  失去原来 `z-index:2` 的层叠上下文，被 `.player__veil` 压成灰字 →
  给它们单独 `position:relative; z-index:2`。
- `.feature__body` 在平板上变 grid 后，`.feature__badge` 默认 stretch，
  胶囊被拉成整栏宽 → `justify-self:start`。
- **gradle 会删掉上一次的产物**：assembleRelease 结束后 `outputs/apk/release/` 里
  只剩本次的 APK（先构手机再构平板，手机包就没了）。所以每个包构完要立刻拷进
  `build-staging/`。`build-both.ps1` 当年就是为这个写的。

**v1.9.29 微调（同一轮）**：用户发回截图说「右上角的夜字 和另一张图的潮字 很难看改掉」——
两处都是**中文单字头像**（首字圆牌），既不像头像也不像 logo。处置：

- 首页右上那颗 `.avatar--sm`（写死「夜」）**整颗删掉**：底部页签就能到「我的」，
  头部只剩问候 + 大标题，反而更干净。
- 「我的」页的 `.avatar--lg`（写死「潮」）换成 `.brandmark`：64px 主色渐变方块 + 音符，
  和启动图标、关于页是同一套符号；音符颜色走 `--on-accent`（浅色主题深字、午夜皮肤白字）。

### 冷启动恢复上次播放（v1.9.27）

用户报「关闭后再打开没有记忆上次播放的歌曲，想要打开就有上次那首、点播放就能
继续听」。**内核其实一直在恢复**：切歌时 `musicToggled` 把 `{listId,index}`
落盘（`playProgress.ts` 的 `handleSetPlayInfo`），启动时 `initPlayInfo` 读回
`playList(...)` 恢复，恢复态是**暂停**的（`player.startupAutoPlay` 默认
false，不会自动出声），`handleRestorePlay` 只补封面/歌词/进度不真播。

**断的是界面这一环**：恢复发生在 **WebView 就绪之前**，`playMusicInfoChanged`
等一串事件界面一个都没收到；`init` 命令以前也只回 apiSource/playMode。
修法两处：
- bridge：把订阅里的 `playerPayload()` 提成共享的 `playerSnapshot()`；
  `init()` 返回值里带 `player: playerSnapshot()`；`subscribe()` 注册完事件
  立即补推一帧（WebView 重载/后订阅也能拿到）。
- app.js：boot 里 `applyPlayer(boot0.player)`（`song` 为 null 时函数自己
  早退，首次安装无影响）。

实测：起播 → `force-stop` → 冷启动 → 迷你条带着上次那首（暂停态）→
点迷你条的播放键 → 进度 19s→27s 在走（真出声）。

### 播放页视觉重做 / 搜索切源不弹键盘（v1.9.26）

用户两张截图提了两件事：①「搜索后再点酷狗等平台，点一次就弹出输入法很难受」；
②「播放界面很丑」。

**① 弹键盘**：v1.9.23 为了让验收脚本点完 chip 直接 `adb input text`，在
`setSearchSource` 里加过 `searchInput.focus()` —— 真机上每次点平台都弹输入法。
直接删掉（切源只是换结果来源，不是要继续输入）；验收脚本改成打字前自己点
一下输入框（UIA 里找 `EditText`），并新增断言：点 chip 后
`dumpsys input_method` 里不出现 `mInputShown=true`。

**② 播放页丑**：用户截图里最丑的是**「方卡压在一个黑圆盘里」**——v1.9.22 加的
黑胶盘只比封面大 44px，真机上不是「唱片边缘」而是一圈死黑边。改动：
- **删掉 `.player__disc`（黑胶盘）**：HTML span、3 条 CSS、两条动画豁免里的引用全清；
  封面成为唯一主视觉（`min(76vw,316px)`，大圆角 + 双层柔和投影 + 1px 白描边）。
- 顶部「正在播放/标题/歌手」层级微调（标题 18px、歌手提亮）。
- 进度条：**触屏常显一颗白色小圆点**（`@media (hover:none)`，原来只在 hover
  出现，手机上永远看不见进度位置）。
- 底部六动作：去掉实线分隔（改成两端淡出的渐变细线）、图标 22px、标签 10px。
- 顺带修一个 **v1.9.25 带出来的真 bug**：`.player__bottom .iconbtn[data-toast]::after`
  靠 `data-toast` 属性画「下载」标签，v1.9.25 去掉下载按钮的 data-toast 后
  标签就没了；选择器改成 `#pDownload::after`。

**⚠️ 这轮最大的坑：改播放页背景会崩模拟器**。给「背景/veil/光晕」换成更大的
模糊（72px、430px 光晕）后，`player` 流程**连崩 5 次 qemu**（0xc0000005），
每次都在「打开播放页后第一次 uiautomator dump」——单步探针证明播放页本身
渲染正常（screencap 994KB），是 **dump 触发的全量合成让 qemu 进程内的
SwiftShader 崩掉**（search 流程不崩=页面没有重型合成层）。把
`.player__bg`（56px/opacity .66）、`.player__veil`（原两层渐变）、
`.player__stage::before`（350px/blur 38px）三块**回退成 v1.9.25 原版**后
一切稳定。**结论：这台机器的模拟器对「大面积模糊 + 多层渐变」的组合极敏感，
以后动播放页背景/光晕，一次只改一块并立刻跑 player 流程**；用户真机是低端
设备，本来也不该堆这些开销。

### 歌曲下载 / 队列清空 / 我的下载（v1.9.25）

**下载是真的**：解析播放地址（`getOnlineMusicUrl`，`isRefresh: true` 强制不走
播放的地址缓存）→ `RNFS.downloadFile` 串行落盘 → `/sdcard/Music/TideMusic/`。
命名走内核设置 `download.fileName`（默认「歌名 - 歌手」）+ 扩展名从 URL 推
（mp3/flac/m4a/ape…），重名自动加 `(1)` 不覆盖。targetSdk 29 + legacy storage
+ `requestStoragePermission()`（`install -r -g` 装的包权限已给，真机首次下载会弹）。

- **串行泵**在 bridge 里（`dlQueue` + `pumpDownloads`）：一次一首、首间 600ms ——
  音源「取地址」接口按 IP 限流，**下载绝不并发**（与音源测试同一条规矩）。
- 进度/完成/失败走 `download` 事件：单首 `start` 也播报；批量只播 `done/error`
  （40 首的 start 会刷屏）；`progress`（每 10%）不弹 toast。
- 入口：播放页底部「下载当前歌」（`downloadSong {current}`）、歌单详情「下载」
  （`downloadList {token}` 整张入队逐首下）。
- **两个实测坑**：①拿播放的地址缓存下载 → 0.3 秒「完成」、文件 0 字节（缓存
  URL 早已失效，响应是错误页）——所以 `isRefresh: true` + 校验 `statusCode`；
  `stat` 校验 size>0 兜底。②播放页显示着歌不代表 `playMusicInfo` 活着：
  URL 解析失败链收尾时 `handleToggleStop` 会把它清成 null。

**队列清空 = 待播全清 + 保留正在播的这首**（与主流音乐 App 一致）。
⚠️ 不能真全清：`watchList.ts` 监听列表变化，全清会被判成「当前歌被移除」→
`playNext(true)` → 空列表 → `handleToggleStop` → **停播 + playMusicInfo 清 null**
（实测就是这个链）。保留当前歌后 `getPlayIndex` 找得回它，播放不断。
**保留用的是 playMusicInfo 里的对象本身**，不回原列表按 id 找 —— 换源后
当前歌的 id 已经变成新平台的，按旧 id 找是空的（实测）。

**顺手修了一个老 bug**：bridge `queue()` 原来读 `listState.allMusicList` ——
那个 store Map **从启动到现在没有任何写入方**（真数据源在 `utils/listManage`
的 `allMusicList`），真机上的「播放队列」**一直是空态**（预览 mock 有数据
看不出来）。改读 `getListMusicSync(LIST_IDS.TEMP)` 后队列才真正显示。

**「我的下载」**：原来 `data-native-page="downloads"` 开的是原生 stub 页
（整页一个字）。现在潮汐自己画 sheet（`#dlSheet`）：列 `/sdcard/Music/TideMusic/`
的文件（名字去掉扩展名 + 大小 + mtime 排序）、逐个删除（内核 `unlink`）。

### 设置页真开关 / 摆设开关分流（v1.9.24）

用户上一轮说「全面检查修改」，这轮把**设置页里所有「翻了不存」的开关**分了流：

**接上真状态的（主题页「播放页」分组）**：

- **封面背景虚化**：存 `ui:playerBlur`，关掉时 `#playerBg` 加 `is-noblur`
  （`filter` 从 `blur(56px)` 退成不糊但压到 30% 透明，正文压得住）。
- **显示歌词翻译**：存 `ui:lyricTr`，`html.no-tr .lyric__tr{ display:none }`。
- **界面动效**：存 `ui:uiMotion`，`html.no-motion` 与「无动效偏好」同一套处理
  （过渡/动画压到 0.001s，无限旋转直接停）。
- **桌面歌词**：这颗是真接原生 —— 新桥命令 `setDesktopLyric`，与原生设置页
  同一个动作：开 = 先查悬浮窗权限，过了再 show；没过就打开系统设置页并回
  `ok:false`，界面把开关按回原位并 toast 引导。关 = `hideDesktopLyric`。
- 四个开关存进 `store`（`ui:*`），启动 `applyUiPrefs()` 画回去；
  **整行都可点**（`data-ui-row` 转发给开关按钮）—— 移动端 28px 的开关太小。

**摆设的（通知页 7 颗 / 隐私页 6 颗 / 沉浸式状态栏）**：压暗到 50% + 不可交互，
点一下只响一声、**不许翻** —— 原来翻了又什么都不存，还弹回默认，纯粹骗人。
两页页尾本来就有「开关只是展示」的说明，现在视觉上也分得出来。

**顺手修的**：榜单页首卡/网格在数据回来前 `data-playlist=""`，点了会去查空 id
（兜底到第一个歌单）；现在点了提示「还没加载完」。榜单加载失败时副标题
写「榜单加载失败」而不是永远「共 — 个榜单」。

**验证**：预览 **200/0**（新增 7 项：四颗真开关闭环、摆设开关不可翻且压暗、
拨回默认）；设备 `verify-fx-tips.py theme` **2/0**（桌面歌词开→关，真悬浮窗），
`search` **7/0**、`player` **4/0**。版本查询串 `?v=20`。

### 实测记录（2026-11-17，v1.9.28，Android 14 / x86_64 模拟器）

- `python tools/ui-check.py`：**220 条全过，0 FAIL**（含下载/队列清空/冷启动恢复/主题/进度条/
  平台切换/音源增删）。换视觉层没有碰任何行为，这一轮就是它的用处。
- 手机竖屏：装**桌面上的交付包**（arm64，模拟器 1080×2400）→ 首页、榜单、歌单详情、
  播放页截图都正常；方向仍是 `unspecified`。
- 平板：`adb shell wm size 1600x1000` + `wm density 256`（= 1000×625 CSS）装平板包 →
  侧栏版式、每日卡 + 快捷 2×2、为你精选三列、歌曲两列都正常；
  `aapt dump xmltree` 确认 `screenOrientation=0x6`（sensorLandscape）。
- 两个包的 `applicationId / label / versionName / versionCode / ABI / 签名 / assets 逐字节`
  全部由 `deliver-arm64.py` 复核：手机 `113003 / 潮汐音乐`，平板 `113003 / 潮汐音乐 Pad`。
- 预览走查用了两套尺寸：411×914（手机）与 1120×780（平板），共 21 张 CDP 截图；
  浅色暖砂与深色墨黑各跑一遍。

### 实测记录（2026-11-17，v1.9.27，Android 14 / x86_64 模拟器）

- 预览 **220/0**（新增「冷启动恢复上次播放」4 条：迷你条出现 / 写着上次那首 /
  恢复态是暂停的 / 点播放键变暂停图标；mock 的 `init` 也回了恢复快照）。
- 设备新流程 `restore` **4/4**：起播 → force-stop → 冷启动 → 迷你条在
  （轮询等 WebView 画完，固定 sleep 太早会假红）→ 点迷你条的播放键 →
  进度 19→27 秒在走。`player` **4/4** 回归无问题。
- 两个量具坑：①dump 文本里带 emoji（✨）会让 PRINT 在 GBK 控制台抛
  `UnicodeEncodeError` 把流程打断 —— `ok/fail` 加了 `_gbk_safe` 兜底；
  ②启动类断言必须轮询（WebView 渲染 1-3 秒），固定等 4 秒就 dump 会假红。

### 实测记录（2026-11-16，v1.9.26，Android 14 / x86_64 模拟器）

- 预览 **216/0**（删掉的两条黑胶断言换成「舞台只剩封面一层」）。
- 设备：`player` **4/4**、`search` **9/9**（含新断言「点搜索源不会弹出输入法」）、
  `dlq` **12/12**（下载/清空/我的下载无回归，真落盘「失眠 - Suki刘舒妤.mp3」）。
- 崩溃排查过程见上面 v1.9.26 段的 ⚠️：连崩 5 次，靠「screencap 先行 + dump 后置」
  的单步探针把崩溃点定位到 **dump 时的全量合成**，再用「背景三块回退」一次治好。
  教训：**播放页的 dump 比 screencap 危险**——screencap 走 SurfaceFlinger 取
  已合成 buffer，dump 会触发 WebView 重新合成；排查播放页崩溃先 screencap。

### 实测记录（2026-11-15，v1.9.25，Android 14 / x86_64 模拟器）

- **预览 217/0 全绿**（`python -I tools/ui-check.py`；新增「下载 / 队列清空」16 条：
  清空传桥+保留一行+toast、下载当前歌传桥+完成 toast、我的下载 sheet 列表/删除、
  整单下载传桥+确认 toast）。
- **设备 dlq 12/12 全过**（新流程 `python -I tools/verify-fx-tips.py dlq`）：
  起播 → 下载当前歌（toast「开始下载」→「已下载」）→ `ls /sdcard/Music/TideMusic/`
  真有文件（`琵琶曲(DJ筱轩版) - 郑浩、冰洁.mp3`，命名规则生效）→ 清空队列
  （toast 带「保留」）→ 队列 sheet 保留当前歌那行（计数 1，不是空态）→
  我的下载 sheet 列出文件 → 删除 → 目录同步少一个。player 短流程也复跑全过。
- 这轮设备的坑（都写进了上面功能段）：地址缓存下载出 0 字节文件、
  清空队列触发 watchList 停播链、换源后 id 对不上、`queue()` 读空 Map 的老 bug。
  排查靠给下载泵每步加 `[Tide] dl ...` 日志 + `logcat` 抓真值，定位后日志已摘。
- `toast` 只显示 **1.7 秒**：设备断言「弹了什么 toast」的 dump 必须在
  `wait=0.7` 附近做，`wait=2.0` 必错过（这轮实测踩的）。
- 模拟器丢点击依旧：下载按钮第一次 tap 常见吞掉，流程里改成
  「点 → dump 找反馈 → 没有就重点」×5 的重试环。

### 实测记录（2026-11-15，v1.9.24，Android 14 / x86_64 模拟器）

- 主题/搜索/播放三条短流程全过。中间 `player` 连着两次挂在「点提示进歌词」，
  疑似回归 —— 给 `toggleLyrics`/`openPlayer` 加了临时日志重跑：**处理链完全
  正常**（`openPlayer → toggleLyrics true → false`），是模拟器把两次点击吞了。
  教训：**这台模拟器丢点击是常态，别急着当产品回归；先加日志确认处理链再下结论**。
- 宿主机内存依旧紧张（UnrealEditor 占 1.85GB），qemu 隔几分钟崩一次；
  这轮全部改用短流程（`player` / `search` / `theme`）验收，每条一分钟内跑完。

### 交付

**当前最新**（v1.9.28 起是**两个包**，手机版 + 平板版，桌面各留一个）：

- 手机：`C:\Users\meiyou\Desktop\ai做的安装包\潮汐音乐-手机版-1.9.36.apk`（14.32 MB，
  SHA256 `FECA5EAE07A3499691475310BA223BB6A73AB26E03015B2152D51CE2B8383BB1`，
  安装身份 `cn.toside.music.mobile.harmony`，桌面名「潮汐音乐」）
- 平板：`C:\Users\meiyou\Desktop\ai做的安装包\潮汐音乐-平板版-1.9.36.apk`（14.32 MB，
  SHA256 `EEC07884AAB9AEE2A711E567154926D28490CE857BFF55EDB2FC591534BF1EFC`，
  安装身份 `cn.toside.music.mobile.harmony.tablet`，桌面名「潮汐音乐 Pad」）
- Release：<https://github.com/meiyoume/tide-music-android-release/releases/tag/v1.9.36>
  （资产 `TideMusic-v1.9.36-arm64.apk` / `TideMusic-Pad-v1.9.36-arm64.apk`；
  手机装手机包、平板装平板包）
- 更新 manifest：<https://raw.githubusercontent.com/meiyoume/tide-music-android-release/main/version.json>

> 2026-11-18 起所有 AI 做的安装包统一放 `桌面\ai做的安装包\`，**每次交付只留该产品最新版**
> （`deliver-arm64.py` 复制完就删同系列旧包；手动清理用 `tools/prune-delivered-apks.py`，
> 旧名字 `tools/prune-desktop-apks.ps1` 只剩一层 ASCII 包装）。文件夹里别的项目的包不动。

（历史：v1.9.30 = 14.35 MB，手机 `B5006A43…` / 平板 `65371E5F…`；v1.9.29 = 14.35 MB，手机 `DB68C8B7…` / 平板 `5BD815FC…`；v1.9.28 = 14.35 MB，手机 `0C574DB2…` / 平板 `28272B8C…`；v1.9.27 = 14.34 MB，`8D6B3C75…`；v1.9.26 = 14.34 MB，`D0F83E31…`；v1.9.25 = 14.34 MB，`6AFA03B2…`；v1.9.24 = 14.34 MB，`0E1E09E7…`；v1.9.23 = 14.34 MB，`43D4665F…`；v1.9.22 = 14.33 MB，`2A1EE3F9…`；v1.9.21 = 14.33 MB，`E373E3DE…`；v1.9.20 = 14.33 MB，`717E11E4…`；v1.9.19 = 14.32 MB，`4EF42B39…`；
v1.9.18 = 14.31 MB，`B788E1A2…`；
v1.9.17 = 14.31 MB，`53D9D479…`；v1.9.16 = 14.31 MB，`FBAA95F4…`；
v1.9.15 = 14.31 MB，`8BEA1C29…`；v1.9.14 = 14.31 MB，`B1D064A2…`；
v1.9.13 = 14.31 MB，`6A2EF87E…`；v1.9.12 = 14.30 MB，`564D954D…`；
v1.9.8 = 14.54 MB，`5F871B11…`；v1.9.11 = 14.29 MB，`D8AAA0AD…`。
旧包按用户要求清掉了。）

> v1.9.35 = 更新下载提速 + 弹窗重做：下载前对每个源**并发测速择优**（官方直连/两个 ghproxy
> 各探 300KB，按实测速度排序），失败立刻换源、每源校验 size+sha256；更新说明改**自写
> Markdown 渲染**，下载中**折叠长说明**只留版本号 + **真实进度条**，下载中/失败都有
> 「打开网页手动下载」。修掉 manifest 缓存击穿参数把 URL 拼成 `version.jsont=...` 的 bug
> （v1.9.34 为此作废）。改完两个包重打交付，模拟器 + mock 源验到进度条 10.74% 与
> sha256 校验拒收坏包。`version.json` 已指向 1.9.35。

> v1.9.33 = 国内更新源加固：照搬「新闻配音重构」的 manifest 方案，更新改读仓库的
> `version.json`（下载地址和校验值全在里面，换源只改 json 不用发版）；manifest 与 APK
> 都走多镜像（官方直连优先 + ghproxy 后备）并校验 size/sha256；失败弹窗加「手动下载」。
> 实测 GitHub 官方 asset 直连 470KB/s 最快，ghproxy 120–170KB/s 兜底。两个包重打交付。

> v1.9.32 = 应用内更新 + 自己的 Release 仓库（`meiyoume/tide-music-android-release`）：
> 「我的 → 关于」显示真实版本并多一行「检查更新」，启动时也自动查一次；
> 发现新版本走内核现成的 `VersionModal`，可直接下载 APK 调起系统安装器，
> 平板包按 applicationId 自动挑 `Pad` 资产。设备上验到「弹窗显示 1.9.32 / 当前 1.9.31」，
> **下载步因模拟器上不了 github.com 未跑通**（正文有记录）。两个包重打交付。

> v1.9.31 = 冷启动提速：内核初始化拆「首屏关键段 / 后台段」（音源安装、音源沙箱、
> 恢复上次播放移出关键路径，网络差时不再卡 1–3 秒）、Web 资源压缩 386KB→271KB、
> 三个脚本挪到 head + defer（页面加载 653→352ms）。同会话 A/B：jsstart→首帧
> 1353ms vs 2733ms。`cacheEnabled`、原生 WebView 预热、提前 setRoot 三个实验
> 实测无收益/负收益，已回退并记进正文。两个包走同一套 deliver 校验（校验口径
> 已改成跟构建输入比），220 项 UI 断言全过。

> v1.9.30 = 进度条拖拽卡顿/延迟修复：拖拽期间不再被内核进度事件拽回、rect 改为按下量一次、
> 移动事件按 rAF 批处理、松手乐观显示 + seekHold 防回弹。两个包重打交付；
> SHA256 见上（手机 `B5006A43…`，平板 `65371E5F…`）。

> v1.9.29 = 去掉两处中文单字头像（首页「夜」整颗删掉、「我的」页「潮」换成主色渐变 + 音符的
> `.brandmark`）。两个包都重打、走同一套 deliver 校验；SHA256 见上
> （手机 `DB68C8B7…`，平板 `5BD815FC…`）。

> v1.9.28 = 用户要求「ui很难看 重构ui 美化 好看 简单 实用 颜色搭配合理，也要做个平板版的，
> 两个一起交付」。视觉层整段重画（样式表末尾追加 v3）+ 平板骨架（≥820×520 断点）。
> 两个包都走 `python tools/deliver-arm64.py 1.9.28 [tablet]`：签名 / 纯 arm64 /
> 界面五文件逐字节 / versionName / **applicationId 与桌面名**六项全过才复制到桌面。
> 平板包额外用 `aapt dump xmltree` 复核 `screenOrientation=0x6`（sensorLandscape），
> 手机包是 `0xffffffff`（unspecified，行为没改）。

> v1.9.27 = 冷启动恢复上次播放（init 回播放快照 + 订阅即推；内核本来就恢复，
> 断在界面收不到启动事件）。交付走 `python tools/deliver-arm64.py 1.9.27`；
> 复核 `versionName=1.9.27 / versionCode=112003 / native-code 只有 arm64-v8a`；
> 界面五个文件与源码逐字节一致；SHA256 见上。

> v1.9.26 = 搜索切源不再弹键盘 + 播放页视觉重做（删黑胶盘、封面主视觉、
> 进度条常显圆点、底部栏去实线）。交付走 `python tools/deliver-arm64.py 1.9.26`；
> 复核 `versionName=1.9.26 / versionCode=111003 / native-code 只有 arm64-v8a`；
> 界面五个文件与源码逐字节一致；SHA256 见上。（⚠️ 背景/光晕别堆大模糊——
> 会把模拟器的 SwiftShader 干崩，详见 v1.9.26 段。）

> v1.9.25 = 歌曲真下载（串行泵落盘 Music/TideMusic/）+ 队列清空（保留正在播）
> + 「我的下载」sheet + 修 `queue()` 读空 Map 的老 bug。交付走
> `python tools/deliver-arm64.py 1.9.25`；复核 `versionName=1.9.25 /
> versionCode=110003 / native-code 只有 arm64-v8a`；界面五个文件与源码
> 逐字节一致；SHA256 见上。（顺带：deliver 脚本 aapt 步骤补了显式
> `encoding='utf-8'`——aapt 输出撞 GBK 解码会把 stdout 弄成 None。）

> v1.9.24 = 设置页真开关/摆设开关分流。交付走 `python tools/deliver-arm64.py 1.9.24`；
> `aapt2 dump badging` 复核 `versionName=1.9.24 / versionCode=109003 / native-code 只有 arm64-v8a`；
> 界面五个文件与源码逐字节一致；SHA256 见上。

> v1.9.23 = 搜索/榜单/歌单平台选择器 + 搜索页状态 bug。交付走
> `python tools/deliver-arm64.py 1.9.23`；`aapt2 dump badging` 复核
> `versionName=1.9.23 / versionCode=108003 / native-code 只有 arm64-v8a`；
> 界面五个文件与源码逐字节一致；SHA256 见上。

> v1.9.22 = 播放页重做 + 歌词切换动效。交付走 `python tools/deliver-arm64.py 1.9.22`；
> `aapt2 dump badging` 复核 `versionName=1.9.22 / versionCode=107003 / native-code 只有 arm64-v8a`；
> `check-apk-assets.py`（界面五个文件逐字节一致）与 `check-bundle.py` 也过；
> SHA256 见上。

> v1.9.21 = 用户要求「全面重构ui 要求美观大气 简洁实用」。交付走
> `python tools/deliver-arm64.py 1.9.21`；`aapt2 dump badging` 复核
> `versionName=1.9.21 / versionCode=106003 / native-code 只有 arm64-v8a`；
> `check-apk-assets.py`（界面五个文件逐字节一致）与 `check-bundle.py`
> （bundle 字符串 + 源文件 mtime 早于 APK）也都过。

> v1.9.20 = 用户第二次说「原生设置还是没有变化 / 音源的三级菜单很割裂」。
> 交付走 `python tools/deliver-arm64.py 1.9.20`；`aapt2 dump badging` 复核
> `versionName=1.9.20 / versionCode=105003 / native-code 只有 arm64-v8a`；
> 另外两道检查也跑了：`check-apk-assets.py`（界面五个文件逐字节一致）
> 与 `check-bundle.py`（bundle 里有 `homeLikes`/`setTidePalette`/`web_albumpic_short`，
> 且相关源文件 mtime 都早于 APK）。

> v1.9.17 与 v1.9.18 是同一轮：**功能都在 v1.9.17 里**，
> v1.9.18 只是把那一轮末尾翻出来的两个列表错（见上文「顺手修掉两个列表的错」）补上。
> 两个包都只有 v1.9.17 短暂存在于桌面上，v1.9.18 是最终产物。

> v1.9.19 就是用户提的那五件事 + 一个死循环修复（见坑 48）。
> 交付走 `python tools/deliver-arm64.py 1.9.19`（签名 / ABI / assets 逐字节 / 版本号 / SHA256
> 五项都过才复制到桌面）；另外**这一版还跑了两道新加的检查**：
> `tools/check-apk-assets.py`（界面五个文件逐字节）和 `tools/check-bundle.py`
> （bundle 里的字符串 + 源文件 mtime 早于 APK）。

`tools/deliver-arm64.py <版本>` 把交付前的检查固化下来，任何一项不过就不复制：
签名（apksigner）、ABI 只有 arm64-v8a、`assets/tide/` 五个文件齐全、
`index.android.bundle` 存在；并打印 SHA256 与体积。
**另外逐字节比 APK 内 `assets/tide/*` 与源目录的 SHA256** —— 这是 v1.9.12 新加的硬门槛，
防的是「改了界面忘了 `sync-tide-assets.mjs`，打包进去的是上一版界面」。

**清旧包**（用户：「别的版本都清掉 留最后一个」）用两个脚本，都是**移进回收站**不是硬删：

- `tools/prune-delivered-apks.py` —— 清 `桌面\ai做的安装包\` 里潮汐音乐的旧包，
  手机/平板各自只留最新版（`--dry` 只看不删）；`prune-desktop-apks.ps1` 是它的 ASCII 包装。
- `tools/prune-stale-apks.ps1`（v1.9.13 新加）—— 工程内的构建产物：`build-staging/`
  每个版本留一对（那是 `build-both.ps1` 的设计），`android/.../apk/debug/` 会攒下很久以前的
  调试包。默认按 `package.json` 的版本号保留，也可 `-Version 1.9.13` 指定。

### 已知没做（想做的话）

搜索联想现在**只有酷我（kw）**有在线补全（内核 SDK 里只有它真挂了 `tipSearch`），
换到酷狗/QQ/网易就只剩本地候选（历史 + 热搜）。桌面版（`_lxdl` 那个工程）当年把
kg/tx/wy 的 `tipSearch` 从 `index.js` 的注释里挂了出来，还修了 `kg/tipSearch.js` 的
`body[0]` → `body.data[0].RecordDatas`；安卓这边照做即可，但要逐个平台实测
（切平台 → 打字 → 看候选），本轮没做。

---

## 七、调试

界面里的 `console.log / console.error / window.onerror` 都会转发到原生日志：

```powershell
adb logcat | findstr TideWeb
```

会看到类似 `[TideWeb] tide bridge ready, backend = native` 的行。
桥接命令失败也会打在这里（`[TideWeb] 命令 xxx 失败: ...`）。

要看 WebView 内部（chrome://inspect），把 `TideShell.tsx` 里的 `DEBUG_WEBVIEW` 改成 `true`
再打包 —— 默认关着，因为它会拖慢启动。
