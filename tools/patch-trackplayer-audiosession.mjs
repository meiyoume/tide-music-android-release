/**
 * 给 react-native-track-player 打一个小补丁：**把播放器的 audio session id 暴露出来**。
 *
 * 为什么必须打补丁：安卓的 `android.media.audiofx.Equalizer / BassBoost / Virtualizer` 都要
 * 挂在一个 **audio session** 上。session 0 = 全局输出混音（会把微信、视频的声音也一起改掉），
 * 所以必须拿到**播放器自己的** session id。而 RNTP 没暴露 `Player.getAudioSessionId()`，
 * 它的 `ExoPlayback` 里那个 `player` 字段是 `protected`，外部包读不到。
 *
 * 做法（2 处改动，都很小）：
 *   1. 在**库模块里**新增 `AudioSessionHolder`（库模块不能反向引用 App 的类，
 *      所以持有者放库里、由 App 读取）；
 *   2. `ExoPlayback` 加一个 `getAudioSessionId()`，并在播放状态变化时调一下把它发布出去。
 *
 * 幂等：已经打过就跳过。`--revert` 可还原。
 * ⚠️ 这是改 node_modules，`npm i` / 重装依赖后会失效，需要重跑本脚本。
 *
 *   node tools/patch-trackplayer-audiosession.mjs
 *   node tools/patch-trackplayer-audiosession.mjs --revert
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB = path.join(root, 'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service')
const HOLDER = path.join(LIB, 'AudioSessionHolder.java')
const EXO = path.join(LIB, 'player/ExoPlayback.java')
const MARK = 'harmony-port:audio-session'
const revert = process.argv.includes('--revert')

if (!fs.existsSync(EXO)) {
  console.error('找不到 ExoPlayback.java：' + EXO + '\n（node_modules 没装好？）')
  process.exit(2)
}

const HOLDER_SRC = `package com.guichaguri.trackplayer.service;

/**
 * ${MARK}
 *
 * 移植版新增：把播放器的 audio session id 发布出来，供宿主 App 的「音效」模块
 * （cn.toside.music.mobile.audiofx.AudioEffectModule）挂 Equalizer / BassBoost / Virtualizer。
 *
 * 为什么放在库里：安卓库模块不能反向引用 App 的类，所以由库持有、App 读取。
 * 0 表示播放器还没建出音频会话（Media3 里 AUDIO_SESSION_ID_UNSET 就是 0），
 * 此时**不要**用它建效果器 —— session 0 会被当成「全局输出混音」。
 *
 * 会话**变化**时回调一次 onChanged：音效模块靠它「等播放器把音频会话建出来再挂上去」，
 * 免得 JS 侧去猜时机。
 */
public class AudioSessionHolder {
    private static volatile int sessionId = 0;
    private static volatile Runnable onChanged;

    public static void set(int id) {
        if (id == sessionId) return;
        sessionId = id;
        Runnable r = onChanged;
        if (r != null && id > 0) r.run();
    }

    public static int get() {
        return sessionId;
    }

    public static void setOnChanged(Runnable r) {
        onChanged = r;
    }
}
`

const IMPORT_LINE = 'import com.guichaguri.trackplayer.service.AudioSessionHolder;'
const EXOPLAYER_IMPORT = 'import androidx.media3.exoplayer.ExoPlayer;'
const METHOD = `
    /**
     * ${MARK}
     * 取当前播放器的 audio session id，并发布给 AudioSessionHolder。
     * 播放器还没建出音频会话时返回 0（不要拿 0 去建效果器，那是全局混音）。
     *
     * 注意：getAudioSessionId() 只在 ExoPlayer 上，Media3 的 Player 接口**没有**这个方法，
     * 所以这里要 instanceof + 强转（本库目前唯一的子类 LocalPlayback 就是 ExoPlayback<ExoPlayer>）。
     */
    public int getAudioSessionId() {
        if (!(player instanceof ExoPlayer)) return 0;
        int id = ((ExoPlayer) player).getAudioSessionId();
        AudioSessionHolder.set(id);
        return id;
    }
`
const PATCHED_STATE = `    @Override
    public void onPlaybackStateChanged(int state) {
        getAudioSessionId();
        handlePlaybackStateChange();
    }`
const ORIGINAL_STATE = `    @Override
    public void onPlaybackStateChanged(int state) {
        handlePlaybackStateChange();
    }`

if (revert) {
  let src = fs.readFileSync(EXO, 'utf8')
  src = src.replace(PATCHED_STATE, ORIGINAL_STATE)
  // 按标记整块删掉注入的方法（不能按 METHOD 原文匹配 —— 改过补丁内容后就匹配不上了）
  src = src.replace(/\n {4}\/\*\*\n {5}\* harmony-port:audio-session[\s\S]*?\n {4}\}\n/, '\n')
  src = src.replace(IMPORT_LINE + '\n', '')
  src = src.replace(EXOPLAYER_IMPORT + '\n', '')
  fs.writeFileSync(EXO, src, 'utf8')
  if (fs.existsSync(HOLDER)) fs.rmSync(HOLDER)
  const stillThere = fs.readFileSync(EXO, 'utf8').includes(MARK)
  console.log(stillThere ? '⚠️ 还原后仍能搜到标记，请手动检查 ExoPlayback.java' : '已还原（ExoPlayback.java 恢复原样，AudioSessionHolder.java 已删）')
  process.exit(stillThere ? 1 : 0)
}

let src = fs.readFileSync(EXO, 'utf8')
if (src.includes(MARK)) {
  console.log('已经打过补丁，跳过。')
  process.exit(0)
}

// 1) 加 import（放在最后一个 import 之后）
const lastImport = src.lastIndexOf('\nimport ')
const importEnd = src.indexOf('\n', lastImport + 1)
let extraImports = IMPORT_LINE + '\n'
if (!src.includes(EXOPLAYER_IMPORT)) extraImports += EXOPLAYER_IMPORT + '\n'
src = src.slice(0, importEnd + 1) + extraImports + src.slice(importEnd + 1)

// 2) 加 getAudioSessionId()（插在 initialize() 之后）
const anchor = `    public void initialize() {
        player.addListener(this);
    }
`
if (!src.includes(anchor)) {
  console.error('找不到 initialize() 锚点，补丁中止（库版本变了？）')
  process.exit(3)
}
src = src.replace(anchor, anchor + METHOD)

// 3) 播放状态变化时发布一次（这时音频会话已经建出来了）
if (!src.includes(ORIGINAL_STATE)) {
  console.error('找不到 onPlaybackStateChanged 锚点，补丁中止（库版本变了？）')
  process.exit(3)
}
src = src.replace(ORIGINAL_STATE, PATCHED_STATE)

fs.writeFileSync(EXO, src, 'utf8')
fs.writeFileSync(HOLDER, HOLDER_SRC, 'utf8')
console.log('补丁已应用：')
console.log('  + ' + path.relative(root, HOLDER))
console.log('  ~ ' + path.relative(root, EXO) + '（+import、+getAudioSessionId()、onPlaybackStateChanged 里发布一次）')
console.log('⚠️ npm i 之后要重跑本脚本。')
