/**
 * 「后台初始化」的触发闸门
 *
 * 冷启动时内核初始化被拆成两段（见 `src/core/init/index.ts`）：
 *   · 前一段（设置/主题/i18n/列表）挡在首屏前面，必须等；
 *   · 后一段（装内置音源、音源沙箱、恢复上次播放）实测 ~460ms，
 *     首页第一屏用不到，放到界面加载完、首屏数据（`home` 命令）回来之后再跑。
 *
 * 为什么不在 setRoot 之后立刻跑：模拟器上实测，和 WebView 的页面加载同时跑
 * 会互相抢 CPU —— 页面加载从 650ms 涨到 ~1s，等于把省下来的时间又吐回去。
 * 等首屏数据回来再跑，用户这时已经能看见界面了。
 *
 * 为什么不让 core 直接调界面：core 不认识 WebView。这里放一个单向的
 * 「注册 → 触发」小模块，app.ts 注册，bridge 在合适的时机触发。
 * 触发一次就清空：重复调用（比如用户切回首页又触发一次 home）不会重复初始化。
 */
let pending: (() => void) | null = null

/** 注册要在后台跑的初始化（由 app.ts 在启动时调一次） */
export const setBackgroundInit = (fn: () => void) => {
  pending = fn
}

/** 触发后台初始化（幂等：只有第一次真正执行） */
export const runBackgroundInit = () => {
  const fn = pending
  pending = null
  if (fn) {
    try {
      fn()
    } catch (err) {
      // 后台初始化失败不该影响已经出来的界面
      console.warn('[TideWeb] background init failed:', err)
    }
  }
}
