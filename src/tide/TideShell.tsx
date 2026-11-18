/**
 * 潮汐壳层（WebView 宿主）
 *
 * 把 `assets/tide/` 里那套纯 HTML/CSS/JS 界面装进 App，音频由内核原生的
 * track-player 播放，界面只负责显示与控制 —— 两边通过下面这条桥通信：
 *
 *   界面 → 原生：window.ReactNativeWebView.postMessage({id, cmd, args})
 *   原生 → 界面：injectJavaScript 调 window.TideNative.reply / .event
 *
 * 关于返回键：界面是单页应用、自己维护子页面栈，安卓返回键得先问界面能不能退。
 * 界面每次导航变化都会上报 canBack，这里据此决定「注入一次 TideGoBack」还是
 * 「交还给系统」（= 退出应用）。不这么做的话，在设置子页按返回会直接退出 App。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, BackHandler, Platform } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { createTideBridge } from './bridge'
import { getTideBootBackground } from './bootBg'
import { useStatusbarHeight } from '@/store/common/hook'

const ASSET_URI = 'file:///android_asset/tide/index.html'

/** 打开 WebView 调试（chrome://inspect）。排查界面问题时临时改 true 再打包。 */
const DEBUG_WEBVIEW = false

/**
 * 在页面脚本之前注入：控制台与未捕获异常转发到原生日志
 *
 * 没有这个，WebView 里的报错在 logcat 里完全看不见，排查只能靠猜。
 * 用法：adb logcat | findstr TideWeb
 */
const CONSOLE_BRIDGE = `
(function () {
  function send(level, args) {
    try {
      var parts = Array.prototype.map.call(args, function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        cmd: '__log', args: { level: level, msg: parts.join(' ') }
      }));
    } catch (e) {}
  }
  var log = console.log, err = console.error, warn = console.warn;
  console.log = function () { send('log', arguments); log.apply(console, arguments); };
  console.error = function () { send('error', arguments); err.apply(console, arguments); };
  console.warn = function () { send('warn', arguments); warn.apply(console, arguments); };
  window.onerror = function (m, s, l, c) { send('error', [m + ' @' + l + ':' + c]); };
  window.addEventListener('unhandledrejection', function (e) {
    send('error', ['unhandled rejection: ' + (e.reason && e.reason.message || e.reason)]);
  });
})();
true;
`

interface TideShellProps {
  /**
   * 界面请求打开原生页面（设置 / 最近播放 / 本地音乐 / 下载管理 …）
   *
   * 这些页面内核里都已经有现成实现，没必要在 Web 界面里重做一遍。
   */
  onOpenNativePage?: (page: string) => void
}

export const TideShell = ({ onOpenNativePage }: TideShellProps) => {
  const topInset = useStatusbarHeight()
  const webRef = useRef<WebView>(null)
  const bridge = useMemo(() => createTideBridge(), [])
  /** WebView 画第一帧之前露出来的就是这层底色，所以它必须等于界面当前主题的底色 */
  const bootBg = useMemo(() => getTideBootBackground(), [])
  /** 界面 init 之前不推事件，否则注入会打在还没准备好的页面上 */
  const readyRef = useRef(false)
  /** 界面是否还有子页面可退（决定返回键行为） */
  const canBackRef = useRef(false)
  /** 记录导航开始时间，用来量「WebView 从开始加载到 onLoadEnd」花了多久 */
  const loadT0Ref = useRef(0)

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(js)
  }, [])

  /** 内核事件 → 界面 */
  useEffect(() => {
    const emit = (event: string, payload: any) => {
      if (!readyRef.current) return
      inject(
        `window.TideNative && window.TideNative.event(${JSON.stringify(event)}, ${JSON.stringify(payload)}); true;`,
      )
    }
    return bridge.subscribe(emit)
  }, [bridge, inject])

  /** 返回键：先问界面，界面退不动才交给系统 */
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canBackRef.current) return false
      inject('window.TideGoBack && window.TideGoBack(); true;')
      return true
    })
    return () => { sub.remove() }
  }, [inject])

  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any
    try {
      msg = JSON.parse(e.nativeEvent.data)
    } catch (err) {
      console.warn('[TideWeb] 收到无法解析的消息', e.nativeEvent.data)
      return
    }

    const { id, cmd, args } = msg ?? {}

    /* 界面的控制台输出 */
    if (cmd === '__log') {
      const level = args?.level ?? 'log'
      const line = `[TideWeb] ${args?.msg ?? ''}`
      if (level === 'error') console.warn(line)
      else console.log(line)
      return
    }

    /* 界面导航状态：只记不发 */
    if (cmd === 'navState') {
      canBackRef.current = !!args?.canBack
      return
    }

    /* 界面要求打开原生页面 */
    if (cmd === 'openNativePage') {
      const page = String(args?.page ?? '')
      if (page) onOpenNativePage?.(page)
      return
    }

    /*
     * 页面能发消息就说明它活着，事件通道立刻打开。
     *
     * 不能等 init 回执成功再开：回执是异步的，界面侧还有 20 秒超时；
     * 冷启动时 RN 的 JS 线程很忙，实测出现过一次 init 超时 ——
     * 那时如果还没开通道，之后所有事件（播放态 / 进度 / 歌词 / 榜单封面）
     * 都会被静默丢掉，界面看着能点、但永远不刷新，很难查。
     */
    if (cmd === 'init') readyRef.current = true

    /* 普通命令 */
    bridge.handle(cmd, args)
      .then(result => {
        if (!id) return
        inject(`window.TideNative && window.TideNative.reply(${JSON.stringify(id)}, true, ${JSON.stringify(result ?? {})}); true;`)
      })
      .catch((err: Error) => {
        console.warn(`[TideWeb] 命令 ${cmd} 失败: ${err?.message ?? err}`)
        if (!id) return
        inject(`window.TideNative && window.TideNative.reply(${JSON.stringify(id)}, false, ${JSON.stringify({ message: err?.message ?? String(err) })}); true;`)
      })
  }, [bridge, inject, onOpenNativePage])

  /** 把状态栏高度交给界面，让内容避开刘海/状态栏 */
  const injectInsets = useCallback((ref: WebView | null) => {
    ref?.injectJavaScript(
      `document.documentElement.style.setProperty('--safe-top', '${topInset}px'); true;`,
    )
  }, [topInset])

  /*
   * 高度后来才有值时补注入一次。
   * HomeScreen 现在已经提前到内核初始化之前挂载（见 src/app.ts），首次 render 时
   * `useStatusbarHeight` 可能还是 0；页面加载完（onLoadEnd）那次注入通常已经拿到真值，
   * 但内核慢的时候会晚于注入，界面就会顶到状态栏底下 —— 这里兜住。
   */
  useEffect(() => { injectInsets(webRef.current) }, [injectInsets])

  return (
    <View style={{ flex: 1, backgroundColor: bootBg }}>
      <WebView
        ref={webRef}
        source={{ uri: ASSET_URI }}
        originWhitelist={['*']}
        // 本地 assets 页面 + 外链封面图：这几个开关缺一个都会白屏或图片不显示
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        javaScriptEnabled
        domStorageEnabled
        // 主题/皮肤存在 localStorage，必须开；开了之后六套皮肤能跨启动记住
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows={false}
        // 界面资源的缓存：**关掉**。实测开着（LOAD_DEFAULT）不会让冷启动更快
        // —— HomeScreen 到页面脚本之间反而从 ~700ms 涨到 ~860ms，因为 file://
        // 每次都要走缓存校验，而 200KB 脚本的编译只占页面自身 100ms 里的一小段。
        // 关掉还有个好处：升级 APK 后界面一定是新的，不会出现「旧的界面被缓存住」。
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        // 界面自己就是全屏滚动，不要 WebView 的橡皮筋回弹
        overScrollMode="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScriptBeforeContentLoaded={CONSOLE_BRIDGE}
        onLoadStart={() => {
          loadT0Ref.current = Date.now()
          console.log('[TideWeb] loadStart')
        }}
        onLoadEnd={() => {
          console.log(`[TideWeb] loadEnd +${Date.now() - loadT0Ref.current}ms`)
          injectInsets(webRef.current)
        }}
        onMessage={handleMessage}
        onError={e => {
          console.warn('[TideWeb] 加载出错', JSON.stringify(e.nativeEvent))
        }}
        onHttpError={e => {
          console.warn('[TideWeb] HTTP 错误', JSON.stringify(e.nativeEvent))
        }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        containerStyle={{ flex: 1, backgroundColor: 'transparent' }}
        // 关闭长按选中，避免音乐界面里误触出文本选择菜单
        textInteractionEnabled={false}
        {...(DEBUG_WEBVIEW ? { webviewDebuggingEnabled: true } : {})}
      />
    </View>
  )
}
