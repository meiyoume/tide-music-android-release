package cn.toside.music.mobile.audiofx;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.PresetReverb;
import android.media.audiofx.Virtualizer;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.guichaguri.trackplayer.service.AudioSessionHolder;

/**
 * 音效（均衡器 / 低音增强 / 环绕声 / 响度增强 / 环境混响）。
 *
 * 全部用安卓系统自带的效果器（android.media.audiofx）。均衡器有两条路子：
 *   1. `preset` 走**系统那套公认预设**（标准 / 古典 / 舞曲 / 原声 / 民谣 / 重金属 / 嘻哈 / 爵士 / 流行 / 摇滚）；
 *   2. `bands` 走**自定义曲线** —— JS 侧把开源预设（VLC 的 18 套经典曲线、AutoEq 的耳机校正曲线）
 *      按对数频率插值到这台设备的频点上，再逐段下发。传了 `bands` 就不用系统预设。
 *
 * ⚠️ 关键点：效果器必须挂在**播放器自己的 audio session** 上。
 * session 传 0 会被系统当成「全局输出混音」，那样会把微信语音、视频的声音一起改掉。
 * 播放器的 session id 由打了补丁的 RNTP 发布（见 tools/patch-trackplayer-audiosession.mjs），
 * 拿不到（<= 0，说明音频会话还没建出来）时**宁可不生效**，也不挂到全局混音上。
 * （唯一例外是 describe() 里为了读预设名 / 频段布局临时建一个只读的，见 readPresets 的注释。）
 *
 * 因为「用户设音效」与「播放器建出音频会话」的先后顺序不固定，这里**记住设置**，
 * 靠 AudioSessionHolder 的会话变化回调自动重挂 —— JS 侧不用猜时机。
 *
 * 所有 AudioEffect 构造都可能抛（设备没这个效果库、被别的应用占满、参数不支持），
 * 一律捕获后如实返回，不崩。
 */
public class AudioEffectModule extends ReactContextBaseJavaModule {
    private static final String TAG = "LxAudioEffect";

    private final ReactApplicationContext reactContext;
    private final Handler main = new Handler(Looper.getMainLooper());

    private Equalizer equalizer;
    private BassBoost bassBoost;
    private Virtualizer virtualizer;
    private LoudnessEnhancer loudness;
    private PresetReverb reverb;
    /** 当前效果器挂在哪个 session 上（-1 = 没挂） */
    private int boundSession = -1;

    // 记住最近一次的设置（只存基本类型：ReadableMap 在方法返回后会被 RN 回收，不能留着）
    private boolean hasPending = false;
    private boolean pendingEnabled = false;
    private int pendingPreset = -1;
    /** 自定义均衡曲线的逐段增益（毫贝，对应设备频段下标）；空数组 = 用系统预设 */
    private int[] pendingBands = new int[0];
    private int pendingBassBoost = 0;
    private int pendingVirtualizer = 0;
    private int pendingLoudness = 0;
    private int pendingReverb = 0;

    /** 响度增强的上限（毫贝）。+12dB 已经很猛了，再高只是把底噪一起抬起来 */
    private static final int MAX_LOUDNESS_MB = 1200;

    /**
     * 环境混响的最大档位。AOSP 的 PresetReverb 一共 7 档：
     * 0=关 / 小房间 / 中房间 / 大房间 / 中厅 / 大厅 / 金属板。
     * 它**没有** getNumberOfPresets()（Equalizer 才有），所以这里写常量。
     */
    private static final int REVERB_PRESET_MAX = 6;

    public AudioEffectModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
        try {
            AudioSessionHolder.setOnChanged(() -> main.post(this::reapplyPending));
        } catch (Throwable t) {
            Log.w(TAG, "注册会话变化回调失败: " + t);
        }
    }

    @Override
    public String getName() {
        return "AudioEffectModule";
    }

    private void releaseEffects() {
        if (equalizer != null) {
            try { equalizer.release(); } catch (Throwable ignored) { }
            equalizer = null;
        }
        if (bassBoost != null) {
            try { bassBoost.release(); } catch (Throwable ignored) { }
            bassBoost = null;
        }
        if (virtualizer != null) {
            try { virtualizer.release(); } catch (Throwable ignored) { }
            virtualizer = null;
        }
        if (loudness != null) {
            try { loudness.release(); } catch (Throwable ignored) { }
            loudness = null;
        }
        if (reverb != null) {
            try { reverb.release(); } catch (Throwable ignored) { }
            reverb = null;
        }
        boundSession = -1;
    }

    @Override
    public void onCatalystInstanceDestroy() {
        main.post(() -> {
            releaseEffects();
            try { AudioSessionHolder.setOnChanged(null); } catch (Throwable ignored) { }
        });
        super.onCatalystInstanceDestroy();
    }

    /** 当前播放会话 id；<= 0 表示还没建出来 */
    private int currentSessionId() {
        try {
            return AudioSessionHolder.get();
        } catch (Throwable t) {
            return 0;
        }
    }

    /**
     * 确保效果器挂在当前播放会话上。返回 null 表示成功，否则是原因。
     * 会话变了（换播放器）会自动重建。
     */
    private String ensureEffects(int sessionId) {
        if (sessionId <= 0) return "播放器还没建出音频会话（先播一首歌再设音效）";
        if (boundSession == sessionId && equalizer != null) return null;
        releaseEffects();
        try {
            equalizer = new Equalizer(0, sessionId);
        } catch (Throwable t) {
            Log.w(TAG, "Equalizer 不可用: " + t);
            equalizer = null;
        }
        try {
            bassBoost = new BassBoost(0, sessionId);
        } catch (Throwable t) {
            Log.w(TAG, "BassBoost 不可用: " + t);
            bassBoost = null;
        }
        try {
            virtualizer = new Virtualizer(0, sessionId);
        } catch (Throwable t) {
            Log.w(TAG, "Virtualizer 不可用: " + t);
            virtualizer = null;
        }
        try {
            loudness = new LoudnessEnhancer(sessionId);
        } catch (Throwable t) {
            Log.w(TAG, "LoudnessEnhancer 不可用: " + t);
            loudness = null;
        }
        try {
            reverb = new PresetReverb(0, sessionId);
        } catch (Throwable t) {
            Log.w(TAG, "PresetReverb 不可用: " + t);
            reverb = null;
        }
        boundSession = sessionId;
        if (equalizer == null && bassBoost == null && virtualizer == null
                && loudness == null && reverb == null) {
            return "这台设备没有可用的音频效果库";
        }
        return null;
    }

    private WritableMap describe(int sessionId) {
        WritableMap out = Arguments.createMap();
        out.putInt("sessionId", sessionId);
        out.putBoolean("available", equalizer != null || bassBoost != null || virtualizer != null
                || loudness != null || reverb != null);
        out.putBoolean("supportsEqualizer", equalizer != null);
        out.putBoolean("supportsBassBoost", bassBoost != null);
        out.putBoolean("supportsVirtualizer", virtualizer != null);
        out.putBoolean("supportsLoudness", loudness != null);
        out.putBoolean("supportsReverb", reverb != null);
        out.putArray("presets", readPresets());
        if (equalizer != null) {
            try {
                out.putInt("presetCount", equalizer.getNumberOfPresets());
                out.putInt("currentPreset", equalizer.getCurrentPreset());
                out.putBoolean("enabled", equalizer.getEnabled());
            } catch (Throwable t) {
                Log.w(TAG, "读均衡器信息失败: " + t);
            }
        }
        // 频段布局：JS 侧要靠它把 10 段开源曲线插值到这台设备的频点上
        try {
            int[] centers = readBandCenters();
            if (centers.length > 0) {
                // WritableMap 没有 putIntArray，只能自己拼一个 WritableArray
                WritableArray arr = Arguments.createArray();
                for (int c : centers) arr.pushInt(c);
                out.putArray("bandCenters", arr);
                short[] range = readBandRange();
                out.putInt("bandMin", range[0]);
                out.putInt("bandMax", range[1]);
            }
        } catch (Throwable t) {
            Log.w(TAG, "读频段布局失败: " + t);
        }
        return out;
    }

    /**
     * 这台设备均衡器各频段的中心频点（Hz）。
     *
     * 各机型段数不一样（常见 5 段：60 / 230 / 910 / 3600 / 14000），所以不能写死。
     * 还没开始播放时没有会话，就临时建一个挂在 session 0 上**只读一下**再释放 —— 读参数不会启用效果。
     */
    private int[] readBandCenters() {
        Equalizer source = equalizer;
        Equalizer temp = null;
        if (source == null) {
            try {
                temp = new Equalizer(0, 0);
                temp.setEnabled(false);
                source = temp;
            } catch (Throwable t) {
                return new int[0];
            }
        }
        try {
            short count = source.getNumberOfBands();
            int[] out = new int[count];
            for (short i = 0; i < count; i++) {
                // getCenterFreq 的单位是毫赫兹
                out[i] = source.getCenterFreq(i) / 1000;
            }
            return out;
        } catch (Throwable t) {
            return new int[0];
        } finally {
            if (temp != null) {
                try { temp.release(); } catch (Throwable ignored) { }
            }
        }
    }

    /** 各频段增益的可调范围（毫贝），通常 [-1500, 1500] */
    private short[] readBandRange() {
        Equalizer source = equalizer;
        Equalizer temp = null;
        if (source == null) {
            try {
                temp = new Equalizer(0, 0);
                temp.setEnabled(false);
                source = temp;
            } catch (Throwable t) {
                return new short[] { -1500, 1500 };
            }
        }
        try {
            return source.getBandLevelRange();
        } catch (Throwable t) {
            return new short[] { -1500, 1500 };
        } finally {
            if (temp != null) {
                try { temp.release(); } catch (Throwable ignored) { }
            }
        }
    }

    /**
     * 列出均衡器预设。
     *
     * 还没开始播放时（没有播放会话）也要能列出来 —— 否则用户一进设置页只看到一句
     * 「先播一首歌再设音效」，连有哪些预设都不知道，体验很差。
     * 所以这里：有会话就用会话上的均衡器读；没有就临时建一个挂在 session 0 上**只读一下名字**
     * 然后立刻释放（读名字不会启用任何效果）；再不行用 AOSP 标准那套兜底。
     */
    private WritableArray readPresets() {
        WritableArray out = Arguments.createArray();
        Equalizer source = equalizer;
        Equalizer temp = null;
        if (source == null) {
            try {
                temp = new Equalizer(0, 0);
                temp.setEnabled(false);
                source = temp;
            } catch (Throwable t) {
                Log.w(TAG, "临时读预设失败（按标准列表兜底）: " + t);
            }
        }
        try {
            if (source != null) {
                short count = source.getNumberOfPresets();
                for (short i = 0; i < count; i++) {
                    WritableMap p = Arguments.createMap();
                    p.putInt("index", i);
                    p.putString("name", source.getPresetName(i));
                    out.pushMap(p);
                }
            } else {
                for (int i = 0; i < STANDARD_PRESETS.length; i++) {
                    WritableMap p = Arguments.createMap();
                    p.putInt("index", i);
                    p.putString("name", STANDARD_PRESETS[i]);
                    out.pushMap(p);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "读预设列表失败: " + t);
        } finally {
            if (temp != null) {
                try { temp.release(); } catch (Throwable ignored) { }
            }
        }
        return out;
    }

    /** AOSP 效果库自带的那套预设（各机型基本一致），读不到设备列表时用它 */
    private static final String[] STANDARD_PRESETS = {
        "Normal", "Classical", "Dance", "Flat", "Folk",
        "Heavy Metal", "Hip Hop", "Jazz", "Pop", "Rock",
    };

    /** 查询当前状态（顺带把效果器建出来） */
    @ReactMethod
    public void getStatus(Promise promise) {
        main.post(() -> {
            try {
                int sessionId = currentSessionId();
                String err = ensureEffects(sessionId);
                WritableMap out = describe(sessionId);
                if (err != null) out.putString("reason", err);
                promise.resolve(out);
            } catch (Throwable t) {
                promise.reject("E_AUDIO_EFFECT", String.valueOf(t.getMessage()), t);
            }
        });
    }

    /**
     * 应用音效设置。
     * enabled=false 或全部效果都是关的时候，均衡器关掉；bassBoost / virtualizer / loudness
     * 用 0~1000 的强度（0 = 关），reverb 用系统预设下标（0 = 关）。
     * `bands` 给了就按自定义曲线逐段设增益，忽略 `preset`。
     */
    @ReactMethod
    public void apply(ReadableMap config, Promise promise) {
        pendingEnabled = !config.hasKey("enabled") || config.getBoolean("enabled");
        pendingPreset = config.hasKey("preset") ? config.getInt("preset") : -1;
        pendingBands = readBands(config);
        pendingBassBoost = config.hasKey("bassBoost") ? config.getInt("bassBoost") : 0;
        pendingVirtualizer = config.hasKey("virtualizer") ? config.getInt("virtualizer") : 0;
        pendingLoudness = config.hasKey("loudness") ? config.getInt("loudness") : 0;
        pendingReverb = config.hasKey("reverb") ? config.getInt("reverb") : 0;
        hasPending = true;
        main.post(() -> {
            try {
                promise.resolve(doApply());
            } catch (Throwable t) {
                promise.reject("E_AUDIO_EFFECT", String.valueOf(t.getMessage()), t);
            }
        });
    }

    /** 读自定义均衡曲线（毫贝 / 逐段）。没有或格式不对就返回空数组，回落到系统预设。 */
    private static int[] readBands(ReadableMap config) {
        if (!config.hasKey("bands")) return new int[0];
        ReadableArray arr = config.getArray("bands");
        if (arr == null || arr.size() == 0) return new int[0];
        int[] out = new int[arr.size()];
        for (int i = 0; i < out.length; i++) out[i] = (int) Math.round(arr.getDouble(i));
        return out;
    }

    /** 会话出现/变化后自动重挂（用户设音效时可能还没开始播） */
    private void reapplyPending() {
        if (!hasPending) return;
        try {
            WritableMap r = doApply();
            Log.i(TAG, "会话变化，已重挂音效: " + r.getString("reason"));
        } catch (Throwable t) {
            Log.w(TAG, "重挂音效失败: " + t);
        }
    }

    private WritableMap doApply() {
        int sessionId = currentSessionId();
        String err = ensureEffects(sessionId);
        if (err != null) {
            WritableMap out = Arguments.createMap();
            out.putBoolean("ok", false);
            out.putInt("sessionId", sessionId);
            out.putString("reason", err);
            return out;
        }

        boolean hasBands = pendingBands.length > 0;
        boolean eqOn = pendingEnabled && (pendingPreset >= 0 || hasBands) && equalizer != null;
        if (equalizer != null) {
            if (eqOn) {
                try {
                    if (hasBands) {
                        // 自定义曲线：逐段设增益。段数按设备的来（JS 侧已经插值成设备段数了，
                        // 这里再取一次 min 只是防越界）。切到预设时 usePreset 会把各段一起重置。
                        short bandCount = equalizer.getNumberOfBands();
                        short[] range = equalizer.getBandLevelRange();
                        for (int i = 0; i < pendingBands.length && i < bandCount; i++) {
                            equalizer.setBandLevel((short) i, (short) clamp(pendingBands[i], range[0], range[1]));
                        }
                    } else if (pendingPreset < equalizer.getNumberOfPresets()) {
                        equalizer.usePreset((short) pendingPreset);
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "设均衡器失败: " + t);
                }
            }
            try { equalizer.setEnabled(eqOn); } catch (Throwable t) { Log.w(TAG, "eq enable 失败: " + t); }
        }

        if (bassBoost != null) {
            int strength = pendingEnabled ? clamp(pendingBassBoost, 0, 1000) : 0;
            try {
                bassBoost.setStrength((short) strength);
                bassBoost.setEnabled(strength > 0);
            } catch (Throwable t) {
                Log.w(TAG, "bassBoost 设置失败: " + t);
            }
        }

        if (virtualizer != null) {
            int strength = pendingEnabled ? clamp(pendingVirtualizer, 0, 1000) : 0;
            try {
                virtualizer.setStrength((short) strength);
                virtualizer.setEnabled(strength > 0);
            } catch (Throwable t) {
                Log.w(TAG, "virtualizer 设置失败: " + t);
            }
        }

        if (loudness != null) {
            int gain = pendingEnabled ? clamp(pendingLoudness, 0, MAX_LOUDNESS_MB) : 0;
            try {
                loudness.setTargetGain(gain);
                loudness.setEnabled(gain > 0);
            } catch (Throwable t) {
                Log.w(TAG, "loudness 设置失败: " + t);
            }
        }

        if (reverb != null) {
            // 0 = PRESET_NONE（不混响）。PresetReverb 没有 getNumberOfPresets()，
            // 档位数写常量（AOSP 那套是 0..6），越界的值由 setPreset 抛出来、被下面吞掉。
            int preset = pendingEnabled ? clamp(pendingReverb, 0, REVERB_PRESET_MAX) : 0;
            try {
                if (preset > 0) reverb.setPreset((short) preset);
                reverb.setEnabled(preset > 0);
            } catch (Throwable t) {
                Log.w(TAG, "reverb 设置失败: " + t);
            }
        }

        WritableMap out = describe(sessionId);
        out.putBoolean("ok", true);
        return out;
    }

    /** 全部关掉并释放（比如用户把音效全关时，避免一直占着效果器） */
    @ReactMethod
    public void release(Promise promise) {
        main.post(() -> {
            try {
                if (equalizer != null) equalizer.setEnabled(false);
                if (bassBoost != null) bassBoost.setEnabled(false);
                if (virtualizer != null) virtualizer.setEnabled(false);
            } catch (Throwable ignored) { }
            releaseEffects();
            hasPending = false;
            pendingBands = new int[0];
            promise.resolve(true);
        });
    }

    private static int clamp(int v, int min, int max) {
        return v < min ? min : (v > max ? max : v);
    }
}
