/**
 * 启动日志：累积成一份字符串，初始化失败时弹给用户看。
 *
 * 顺带承担「冷启动耗时埋点」：每次 bootLog 都记一下距 JS 开始执行的毫秒数。
 * 默认**不打到控制台**（正常启动不需要这些噪音），排查启动速度时把
 * BOOT_LOG_TIMING 改成 true 重新打包，`adb logcat | findstr "\[Boot\]"`
 * 就能看到每一步各花了多久。
 */
const logs: string[] = []
const startedAt = Date.now()

/** 排查冷启动速度时改 true：把每一步的耗时打进 logcat（ReactNativeJS） */
const BOOT_LOG_TIMING = false

export const bootLog = (...msgs: any[]) => {
  const line = msgs.map(m => typeof m == 'string' ? m : JSON.stringify(m)).join(' ')
  logs.push(line)
  if (BOOT_LOG_TIMING) {
    // eslint-disable-next-line no-console
    console.log(`[Boot] ${String(Date.now() - startedAt).padStart(4, ' ')}ms  ${line}`)
  }
}

export const getBootLog = () => {
  return logs.join('\n')
}
