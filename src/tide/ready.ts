/**
 * 「内核初始化完成」信号
 *
 * 为什么要单独一个模块：潮汐界面现在是在内核初始化**之前**就被推出来的
 * （见 `src/app.ts` 的 pushHomeScreen 顺序）——界面自己加载约 0.7 秒、内核
 * 初始化约 0.6 秒，串行做等于白等，并起来做首屏能早半秒多。
 *
 * 但并起来之后，页面的 `init` 命令会**早于**内核就绪到达。界面是拿 init 的返回值
 * 画首屏的（上次播放的歌、音源、收藏列表…），早到的空数据会让首页一直空着。
 * 所以桥的 `init` 先等这个 signaling，再回数据：
 *
 *   const boot = await Tide.init()   // 页面侧：等到这里返回就说明内核已就绪
 *
 * 界面自己的首帧不受影响：index.html 的 is-boot 淡入在两次 rAF 后就撤掉，
 * 那时壳层已经能看见（见 app.js 的 revealApp），只是内容等 init。
 */
let resolveReady: (() => void) | null = null

const readyPromise = new Promise<void>(resolve => { resolveReady = resolve })

/** 等内核初始化完成（只会在启动阶段被等，重复 await 立即返回） */
export const kernelReady = readyPromise

/**
 * 标记内核已就绪。
 *
 * 初始化**失败**时也要调：那种情况下界面各页自己会报「加载失败」，
 * 而 init 命令吊着不回会让页面卡在启动态，比空数据更难排查。
 */
export const markKernelReady = () => {
  if (!resolveReady) return
  resolveReady()
  resolveReady = null
}
