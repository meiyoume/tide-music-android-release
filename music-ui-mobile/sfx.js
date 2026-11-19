/* ═══════════════════════════════════════════════════════════
   潮汐音乐 · 界面音效

   全部用 Web Audio 现场合成，不带任何音频文件：
     · 安装包一点没变大（几 KB 代码 vs 几百 KB 采样）
     · 不依赖解码器、不占磁盘、不会被音源/版权问题牵连
     · 换个音色包只是换三支「发声函数」，不用重新打包素材

   这一层只负责发声，不认识「哪个按钮该响什么」——
   事件到声音的映射写在 app.js 里，见 sfx()。

   信号链：
     每支voice ──► bus ──┬─► dry ─────────────┐
                        └─► send ─► 混响 ──► master ─► 软削波 ─► 低通 ─► 输出
   混响是现场生成的一段衰减噪声，让点击声不至于「干」得刺耳；
   末端那级软削波保证无论叠多少个音都不会爆音。
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ───────────────────── 工具 ───────────────────── */

/* 指数衰减包络：起音快、尾巴长，听感上比线性自然得多 */
function env(param, t0, peak, attack, decay) {
  const a = Math.max(0.0008, attack || 0.003);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  param.exponentialRampToValueAtTime(0.0001, t0 + a + Math.max(0.02, decay));
  param.setValueAtTime(0, t0 + a + decay + 0.01);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ───────────────────── 音色包 ─────────────────────
   每套只实现三支：「tone 主体音」「click 点击」「sweep 划过」，
   十一个事件都用这三支组合出来，加音色包不用改事件表。
   ─────────────────────────────────────────────────── */

function makeKit(ctx, bus, noiseBuffer) {
  function osc(type, f, t0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  }

  /* 一段带通噪声：木头、气声那类「打击感」都靠它 */
  function noiseHit(dest, t0, f, q, peak, decay, lowpass) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = lowpass ? 'lowpass' : 'bandpass';
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    env(g.gain, t0, peak, 0.001, decay);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(t0);
    src.stop(t0 + decay + 0.05);
  }

  function panned(node, pan) {
    if (!pan || !ctx.createStereoPanner) return node;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    node.connect(p);
    return p;
  }

  /* ── 清透：正弦钟声，尾巴干净，泛音克制 ── */
  const crystal = {
    tone(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);

      const a = osc('sine', o.f, t0);
      const ga = ctx.createGain();
      env(ga.gain, t0, o.g, o.a || 0.004, o.d);
      a.connect(ga); ga.connect(out);

      /* 一个八度加五度的泛音，给钟声一点「亮」但不发尖 */
      const b = osc('sine', o.f * 2.01, t0);
      const gb = ctx.createGain();
      env(gb.gain, t0, o.g * 0.16, o.a || 0.004, o.d * 0.6);
      b.connect(gb); gb.connect(out);

      a.start(t0); a.stop(t0 + o.d + 0.08);
      b.start(t0); b.stop(t0 + o.d + 0.08);
    },
    click(dest, o) {
      const t0 = o.t0;
      const out = ctx.createGain();
      out.gain.value = o.g;
      out.connect(dest);
      noiseHit(out, t0, o.f * 1.7, 1.1, 0.9, Math.min(o.d, 0.02));
      const s = osc('sine', o.f, t0);
      const gs = ctx.createGain();
      env(gs.gain, t0, 0.7, 0.001, 0.012);
      s.connect(gs); gs.connect(out);
      s.start(t0); s.stop(t0 + 0.04);
    },
    sweep(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      const s = osc('sine', o.f, t0);
      s.frequency.setValueAtTime(o.f * 0.78, t0);
      s.frequency.exponentialRampToValueAtTime(o.f * 1.42, t0 + o.d);
      const g = ctx.createGain();
      /* 正弦划过本身很轻，这里补一点增益，好跟其它事件响度对齐 */
      env(g.gain, t0, o.g * 1.9, 0.014, o.d);
      s.connect(g); g.connect(out);
      s.start(t0); s.stop(t0 + o.d + 0.08);
    },
  };

  /* ── 木质：木琴／木鱼，槌头那一下是带通噪声 ── */
  const mallet = (dest, t0, f, amp, decay) => {
    noiseHit(dest, t0, f * 3.2, 1.4, amp * 0.5, 0.014, true);
  };
  const wood = {
    tone(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      mallet(out, t0, o.f, o.g, o.d);
      const s = osc('sine', o.f, t0);
      const g = ctx.createGain();
      env(g.gain, t0, o.g, 0.002, o.d);
      s.connect(g); g.connect(out);
      /* 木体的一点三倍泛音，短促但有体积 */
      const s3 = osc('sine', o.f * 3.01, t0);
      const g3 = ctx.createGain();
      env(g3.gain, t0, o.g * 0.1, 0.002, o.d * 0.35);
      s3.connect(g3); g3.connect(out);
      s.start(t0); s.stop(t0 + o.d + 0.1);
      s3.start(t0); s3.stop(t0 + o.d + 0.1);
    },
    click(dest, o) {
      const out = ctx.createGain();
      out.gain.value = o.g;
      out.connect(dest);
      noiseHit(out, o.t0, o.f, 0.9, 0.85, Math.min(o.d, 0.03), true);
    },
    sweep(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.Q.value = 0.9;                 // 带通一窄，噪声的能量就几乎不剩了
      flt.frequency.setValueAtTime(o.f * 0.7, t0);
      flt.frequency.exponentialRampToValueAtTime(o.f * 2.6, t0 + o.d);
      const g = ctx.createGain();
      env(g.gain, t0, o.g * 5, 0.012, o.d);
      src.connect(flt); flt.connect(g); g.connect(out);
      src.start(t0); src.stop(t0 + o.d + 0.08);
    },
  };

  /* ── 电子：方波 blip，滤波器跟着包络走 ── */
  function blip(dest, t0, f, g0, d, type, envMul) {
    const s = osc(type, f, t0);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 6;
    flt.frequency.setValueAtTime(Math.min(12000, f * 7), t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(200, f * (envMul || 1.6)), t0 + d);
    const g = ctx.createGain();
    env(g.gain, t0, g0, 0.002, d);
    s.connect(flt); flt.connect(g); g.connect(dest);
    s.start(t0); s.stop(t0 + d + 0.05);
    return s;
  }
  const synth = {
    tone(dest, o) {
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      blip(out, o.t0, o.f, o.g, o.d, 'square', 1.5);
      /* 轻微失谐的第二支，让方波不那么「单薄」 */
      const s2 = osc('sawtooth', o.f * 1.005, o.t0);
      const g2 = ctx.createGain();
      env(g2.gain, o.t0, o.g * 0.22, 0.004, o.d * 0.7);
      s2.connect(g2); g2.connect(out);
      s2.start(o.t0); s2.stop(o.t0 + o.d + 0.05);
    },
    click(dest, o) {
      const out = ctx.createGain();
      out.gain.value = o.g;
      out.connect(dest);
      const s = blip(out, o.t0, o.f, 0.9, Math.min(o.d, 0.03), 'square', 0.6);
      s.frequency.exponentialRampToValueAtTime(o.f * 0.6, o.t0 + 0.03);
    },
    sweep(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      const s = osc('sawtooth', o.f * 0.6, t0);
      s.frequency.exponentialRampToValueAtTime(o.f * 1.9, t0 + o.d);
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = 8;
      flt.frequency.setValueAtTime(o.f * 1.2, t0);
      flt.frequency.exponentialRampToValueAtTime(o.f * 5, t0 + o.d);
      const g = ctx.createGain();
      env(g.gain, t0, o.g, 0.008, o.d);
      s.connect(flt); flt.connect(g); g.connect(out);
      s.start(t0); s.stop(t0 + o.d + 0.06);
    },
  };

  /* ── 柔和：三角波，起音慢一点，音量收着 ── */
  const soft = {
    tone(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      const s = osc('triangle', o.f, t0);
      const g = ctx.createGain();
      env(g.gain, t0, o.g, o.a || 0.012, o.d);
      s.connect(g); g.connect(out);
      /* 底下垫一支低八度正弦，听感更「厚」 */
      const sub = osc('sine', o.f * 0.5, t0);
      const gs = ctx.createGain();
      env(gs.gain, t0, o.g * 0.3, o.a || 0.012, o.d);
      sub.connect(gs); gs.connect(out);
      s.start(t0); s.stop(t0 + o.d + 0.1);
      sub.start(t0); sub.stop(t0 + o.d + 0.1);
    },
    click(dest, o) {
      const out = ctx.createGain();
      out.gain.value = o.g;
      out.connect(dest);
      const s = osc('sine', o.f, o.t0);
      const g = ctx.createGain();
      env(g.gain, o.t0, 0.75, 0.003, Math.min(o.d, 0.03));
      s.connect(g); g.connect(out);
      s.start(o.t0); s.stop(o.t0 + 0.06);
    },
    sweep(dest, o) {
      const t0 = o.t0;
      const out = panned(ctx.createGain(), o.pan);
      out.connect(dest);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(o.f * 1.6, t0);
      flt.frequency.exponentialRampToValueAtTime(o.f * 3.4, t0 + o.d);
      const g = ctx.createGain();
      env(g.gain, t0, o.g * 3.2, 0.03, o.d);
      src.connect(flt); flt.connect(g); g.connect(out);
      src.start(t0); src.stop(t0 + o.d + 0.08);
    },
  };

  return { crystal, wood, synth, soft };
}

/* ───────────────────── 事件表 ─────────────────────
   k = 音色包。tone/click/sweep 收到的是 {f 频率, d 时长, g 增益, t0 起始, at 延时}。
   音高都落在五声音阶附近（A 大调那几个音），一起响也顺耳。
   ─────────────────────────────────────────────── */

const T = (k, dest, o, at, extra) => {
  const opt = { f: o.f, d: o.d, g: o.g, t0: o.t0 + (at || 0) };
  if (extra) for (const key in extra) opt[key] = extra[key];
  k.tone(dest, opt);
};

const EVENTS = {
  /* 普通按钮：一下干脆的高频点触 */
  tap: (k, d, t0) => {
    k.click(d, { f: 1180, d: 0.05, g: 0.30, t0 });
    T(k, d, { f: 1318.5, d: 0.07, g: 0.16, t0 });
  },
  /* 切页签：两音上行，听得出「换地方了」但很短 */
  tab: (k, d, t0) => {
    k.click(d, { f: 900, d: 0.04, g: 0.24, t0 });
    T(k, d, { f: 880, d: 0.10, g: 0.28, t0 }, 0.012);
    T(k, d, { f: 1318.5, d: 0.14, g: 0.24, t0 }, 0.062);
  },
  /* 进/出子页面：一次很轻的划过 */
  nav: (k, d, t0) => {
    k.sweep(d, { f: 700, d: 0.20, g: 0.16, t0, pan: -0.18 });
  },
  /* 收藏：两个音向上跳，带一点「奖励感」 */
  like: (k, d, t0) => {
    T(k, d, { f: 1046.5, d: 0.16, g: 0.34, t0 }, 0, { pan: -0.12 });
    T(k, d, { f: 1568, d: 0.22, g: 0.28, t0 }, 0.058, { pan: 0.12 });
  },
  /* 取消收藏：同样两个音，往下走 */
  unlike: (k, d, t0) => {
    T(k, d, { f: 784, d: 0.13, g: 0.26, t0 });
    T(k, d, { f: 587.33, d: 0.18, g: 0.22, t0 }, 0.05);
  },
  play: (k, d, t0) => {
    T(k, d, { f: 659.25, d: 0.18, g: 0.30, t0 }, 0, { pan: -0.1 });
    T(k, d, { f: 987.77, d: 0.24, g: 0.26, t0 }, 0.055, { pan: 0.1 });
  },
  pause: (k, d, t0) => {
    T(k, d, { f: 987.77, d: 0.15, g: 0.26, t0 }, 0, { pan: 0.1 });
    T(k, d, { f: 659.25, d: 0.20, g: 0.24, t0 }, 0.055, { pan: -0.1 });
  },
  /* 上/下一首：比切页签更「急」一点 */
  skip: (k, d, t0) => {
    k.click(d, { f: 1500, d: 0.035, g: 0.20, t0 });
    T(k, d, { f: 1174.66, d: 0.11, g: 0.24, t0 }, 0.01);
  },
  /* 干成了：三音上行琶音（收藏歌单、建歌单、分享成功） */
  success: (k, d, t0) => {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      T(k, d, { f, d: 0.26, g: 0.26, t0 }, i * 0.055, { pan: (i - 1) * 0.14 });
    });
  },
  /* 没干成：两个低音往下沉，克制不刺耳 */
  error: (k, d, t0) => {
    T(k, d, { f: 392, d: 0.18, g: 0.22, t0 }, 0, { a: 0.006 });
    T(k, d, { f: 311.13, d: 0.26, g: 0.20, t0 }, 0.07, { a: 0.006 });
  },
};

const PACK_NAMES = { crystal: '清透', wood: '木质', synth: '电子', soft: '柔和' };
const EVENT_NAMES = {
  tap: '点击', tab: '切页签', nav: '翻页', like: '收藏', unlike: '取消收藏',
  play: '播放', pause: '暂停', skip: '切歌', success: '成功', error: '失败',
};

/* ───────────────────── 发声 ───────────────────── */

const Sfx = {
  available: typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function',
  enabled: true,
  pack: 'crystal',
  volume: 0.65,
  packs: PACK_NAMES,
  events: EVENT_NAMES,
  stats: { played: 0, skipped: 0 },

  _ctx: null,
  _bus: null,
  _master: null,
  _voices: 0,

  /* 第一次用户手势时调一次：安卓 WebView 里 AudioContext 出生就是挂起的 */
  unlock() {
    if (!this.available) return;
    try {
      this._ensure();
      if (this._ctx.state === 'suspended') this._ctx.resume();
    } catch (e) { /* 出不了声也绝不能影响界面 */ }
  },

  _ensure() {
    if (this._ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this._ctx = ctx;

    /* 白噪声：所有「打击感」「气声」都从这一份缓冲区里取，不重复生成 */
    const len = Math.floor(ctx.sampleRate * 0.4);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    this._noise = noise;

    /* 混响：一段指数衰减的噪声当冲激响应，尾音 0.55 秒，很短但够「润」 */
    const irLen = Math.floor(ctx.sampleRate * 0.55);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        /* 前 8ms 留空当预延迟，之后按 t^2.6 衰减，听着比线性干净 */
        d[i] = (i < ctx.sampleRate * 0.008 ? 0 : 1) *
          (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;

    const bus = ctx.createGain();
    bus.gain.value = 1;

    const dry = ctx.createGain();
    dry.gain.value = 1;
    const send = ctx.createGain();
    send.gain.value = 0.22;              // 混响量：听得出来而已，多了会糊
    bus.connect(dry);
    bus.connect(send);
    send.connect(conv);

    const master = ctx.createGain();
    master.gain.value = this._masterGain();
    dry.connect(master);
    conv.connect(master);

    /* 软削波：叠十几个音也不会数字爆音，只会自然压缩 */
    const shaper = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const k = 1.35;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    /* 末尾一点点低通：削掉合成器最容易刺耳的那一截 */
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 13500;
    lp.Q.value = 0.6;

    master.connect(shaper);
    shaper.connect(lp);
    lp.connect(ctx.destination);

    this._bus = bus;
    this._master = master;
    this._kit = makeKit(ctx, bus, noise);
  },

  _masterGain() {
    /* 平方曲线：滑块前半段细调、后半段别太吵 */
    return this.enabled ? Math.pow(clamp(this.volume, 0, 1), 1.6) * 0.9 : 0;
  },

  setEnabled(on) {
    this.enabled = !!on;
    if (this._master) this._master.gain.value = this._masterGain();
  },

  setVolume(v) {
    this.volume = clamp(typeof v === 'number' ? v : 0.65, 0, 1);
    if (this._master) this._master.gain.value = this._masterGain();
  },

  setPack(name) {
    this.pack = PACK_NAMES[name] ? name : 'crystal';
  },

  /** 放一个事件。事件名不在表里、关了音效、或者发不出声，都只是安静地返回 */
  play(event) {
    if (!this.enabled || !this.available) return;
    const fn = EVENTS[event];
    if (!fn) return;
    try {
      this._ensure();
      const ctx = this._ctx;
      if (ctx.state === 'suspended') ctx.resume();
      /* 同时发声数封顶：一路狂点时别把音频线程压住 */
      if (this._voices > 14) { this.stats.skipped++; return; }
      this._voices++;
      const kit = this._kit[this.pack] || this._kit.crystal;
      fn(kit, this._bus, ctx.currentTime + 0.001);
      this.stats.played++;
      /* 最长的一个事件也就 0.4 秒，到期放行名额 */
      setTimeout(() => { this._voices--; }, 420);
    } catch (e) {
      this._voices = 0;
    }
  },

  /**
   * 离线渲染一个事件，给测试用（不影响正在播放的音频）。
   * 返回 { peak, rms, seconds } —— 拿它验证「确实出声了、没削顶」。
   */
  async render(event, opts) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rate = 44100;
    const dur = ((opts && opts.dur) || 1.2) * rate;
    const ctx = new AC(1, dur, rate);

    const len = Math.floor(rate * 0.4);
    const noise = ctx.createBuffer(1, len, rate);
    const nd = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      nd[i] = (seed / 0x3fffffff) - 1;
    }
    const irLen = Math.floor(rate * 0.55);
    const ir = ctx.createBuffer(2, irLen, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let s2 = 999 + ch;
      for (let i = 0; i < irLen; i++) {
        s2 = (s2 * 1103515245 + 12345) & 0x7fffffff;
        const t = i / irLen;
        d[i] = (i < rate * 0.008 ? 0 : 1) * ((s2 / 0x3fffffff) - 1) * Math.pow(1 - t, 2.6);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const bus = ctx.createGain();
    const dry = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = 0.22;
    const master = ctx.createGain();
    master.gain.value = Math.pow((opts && opts.volume) || 0.65, 1.6) * 0.9;
    bus.connect(dry); bus.connect(send); send.connect(conv);
    dry.connect(master); conv.connect(master);

    const shaper = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35);
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 13500;
    master.connect(shaper); shaper.connect(lp); lp.connect(ctx.destination);

    const kit = makeKit(ctx, bus, noise);
    const fn = EVENTS[event] || EVENTS.tap;
    fn(kit[(opts && opts.pack) || this.pack] || kit.crystal, bus, 0.02);

    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    let peak = 0, sum = 0, last = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sum += data[i] * data[i];
      if (v > 1e-4) last = i;
    }
    return {
      peak: Math.round(peak * 10000) / 10000,
      rms: Math.round(Math.sqrt(sum / data.length) * 10000) / 10000,
      seconds: Math.round((last / rate) * 1000) / 1000,
      buffer: buf,
    };
  },
};

window.Sfx = Sfx;
})();
