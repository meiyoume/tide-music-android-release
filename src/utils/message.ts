export const requestMsg = {
  fail: '请求异常😮，可以多试几次，若还是不行就换一首吧。。。',
  unachievable: '哦No😱...接口无法访问了！',
  timeout: '请求超时',
  // unachievable: '哦No😱...接口无法访问了！已帮你切换到临时接口，重试下看能不能播放吧~',
  notConnectNetwork: '无法连接到服务器',
  cancelRequest: '取消http请求',
  tooManyRequests: '服务器繁忙',
} as const

/**
 * 判断一个错误文案是不是「被服务端限流 / 拒绝服务」
 *
 * ## 为什么需要这个
 *
 * 音源脚本是**第三方写的**，它们报限流时用的文案各不相同，底座原本只认自己那句
 * `'服务器繁忙'`（`tooManyRequests`）。于是脚本抛 `'block ip'` 时：
 *
 *   - `core/music/utils.ts` 的换源逻辑**不认为这是限流** → 去别的平台连环重试
 *     （实测一次点歌失败会连发 5+ 次请求：`mg→kw→kg→wy→mg`）；
 *   - `core/player/player.ts` 也不走 `delayRetry` 的限流分支，而是继续重试。
 *
 * 结果：**越被限流越发请求，限流时间越拖越长**。用户实测反馈就是
 * 「不要用高并发了 不然我都用不了了这音源」—— 他看到的正是这个雪球。
 *
 * ## 识别范围
 *
 * 只匹配**明确的限流/封禁语义**，不做宽泛的「含 ip 就算」——
 * 避免把正常错误误判成限流而停止换源（那会让能播的歌播不出来）。
 * 大小写不敏感。
 */
const THROTTLE_PATTERNS = [
  /block\s*ip/i,        // Huibq 等脚本：被限流时抛 'block ip'
  /too many requests/i, // 标准 429 文案
  /rate\s*limit/i,      // 常见限流文案
  /服务器繁忙/,          // 底座自己的文案
  /请求过于频繁/,
  /访问频繁/,
  // 「IP」与「限制/封禁/屏蔽」的各种组合（顺序不定、中间可能有空格）
  // 注意要覆盖**连写**（`IP限制`）与**被字句**（`您的 IP 已被封禁`）
  /ip\s*(?:已被?)?\s*(?:限制|封禁|屏蔽|拉黑)/i,
  /(?:限制|封禁|屏蔽|拉黑)\s*(?:了)?\s*ip/i,
]

export const isThrottleError = (message?: string | null): boolean => {
  if (!message) return false
  return THROTTLE_PATTERNS.some(rxp => rxp.test(message))
}
