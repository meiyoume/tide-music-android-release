/**
 * 反证：**修改前**那句 `idx = (idx + 7) % n` 在 n 是 7 的倍数时确实死循环。
 *
 * 这是把旧实现原样抄一份（就那 8 行），用一个「走了多少步」的上限来证明它出不来。
 * 真正跑起来的表现就是 JS 线程 100% 卡死 —— 所以这里不能真跑，只能数步数。
 */
function oldPickSpread(list, k, seed) {
  const n = list.length
  if (n <= k) return list.slice()
  const out = []
  const seen = new Set()
  let idx = ((seed % n) + n) % n
  let steps = 0
  while (out.length < k && seen.size < n) {
    if (++steps > 1000000) return { out, seen: seen.size, steps, hung: true }
    if (!seen.has(idx)) { seen.add(idx); out.push(list[idx]) }
    idx = (idx + 7) % n
  }
  return { out, seen: seen.size, steps, hung: false }
}

for (const n of [35, 42, 49, 56, 63]) {
  const r = oldPickSpread(Array.from({ length: n }, (_, i) => i), 30, 12345)
  console.log('n=%-4d 旧实现：走出 %d 个 / 看过 %d 个位置 / %s 步  → %s',
    n, r.out.length, r.seen, r.steps, r.hung ? '死循环' : '正常返回')
}
console.log('\n对照（新实现）：n=35 取 30 首是瞬时的，见 check-pick-spread.mjs')
