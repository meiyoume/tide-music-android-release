/* ═══════════════════════════════════════════════════════════
   潮汐音乐 · 界面逻辑
   数据全部来自 window.Tide（见 api.js）：
     · 独立预览时是内置演示数据
     · 装进洛雪安卓版后是内核桥接
   本文件只负责渲染与交互，不认识任何具体数据源。
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ───────────────────────── 小工具 ───────────────────────── */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

function fmt(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/* "3:55" → 235 */
function parseInterval(str) {
  const p = String(str || '').split(':');
  if (p.length < 2) return 0;
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1700);
}

const icon = (name, cls) =>
  '<svg class="icon ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';

function haptic() {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
}

/* 偏好持久化（file:// 下 localStorage 可能不可用，一律静默降级） */
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('tide.' + k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem('tide.' + k, JSON.stringify(v)); } catch (e) {} },
};

/* 调试日志：在 App 里转发到原生日志，方便用 adb logcat 看 */
function log() {
  try { console.log.apply(console, arguments); } catch (e) {}
}

/* 启动耗时埋点。WebView 里的时间原生侧看不见，只能自己报出来：
     adb logcat | findstr "t+"
   相对的是本文件开始执行的那一刻（不是 am start），所以比 am start 的读数小。 */
const T0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
function mark(name) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  log('t+' + Math.round(now - T0) + 'ms ' + name);
}
try {
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  /* 页面从「发起导航」到「HTML 读完 / DOM 就绪」花了多久 —— 这段在 app.js 跑起来之前，
     只有 navigation timing 能看到。跟 am start 对不上的部分（内核初始化）在它前面。 */
  if (nav) log('nav responseEnd=' + Math.round(nav.responseEnd) + ' domInteractive=' + Math.round(nav.domInteractive) + ' domContentLoaded=' + Math.round(nav.domContentLoadedEventStart));
} catch (e) {}
/* 界面淡入。index.html 的内联脚本先给 <html> 打上 is-boot（.app 透明），
   等首帧画出来再摘掉 —— 这样 WebView 的第一帧是「纯底色」，和 RN 那层同色，
   屏幕上看不出切换，随后内容才从底色里淡出来。
   （兜底那一条在 index.html 的内联脚本里，比这里更早、也不会被这里的错误牵连。） */
function revealApp() {
  document.documentElement.classList.remove('is-boot');
}
/* 首帧：连着两次 rAF 之后回调，基本就落在第一次真正呈现之后 */
requestAnimationFrame(function () {
  requestAnimationFrame(function () { mark('first paint'); revealApp(); });
});
mark('app.js start');

/* ───────────────────────── 音效 ───────────────────────── */

/* 发声本体在 sfx.js（Web Audio 现场合成，不带音频文件）。
   这里只做两件事：把设置喂给它，以及决定「哪个动作响哪一声」。
   所有发声都走 sfx() 这一个出口，关掉音效时它直接返回，不用到处判断。 */
const SFX_DEFAULTS = { on: true, pack: 'crystal', volume: 0.65 };

function sfx(event) {
  const S = window.Sfx;
  if (S && S.enabled) S.play(event);
}

/* 设置面板、摘要行、持久化一次做完，改任意一项都走这里 */
function applySfx() {
  try {
    applySfxInner();
  } catch (e) {
    log('applySfx failed:', (e && e.message) || String(e));
  }
}

/* 界面音效这套控件在两个入口（设置页 + 播放页弹层）里画的是同一份状态，
   而且节点都是 index.html 里写死的静态节点 —— 状态没变就没必要重画。
   一次调用是 5 趟全文档 querySelectorAll 加几十次属性/文本写入，而它会被
   「切页签」「打开更多弹层」这类跟音效无关的操作顺带叫到。 */
let sfxSig = null;

function applySfxInner() {
  const s = state.sfx;
  const sig = s.on + '\u0001' + s.pack + '\u0001' + s.volume;
  if (sig === sfxSig) return;
  sfxSig = sig;
  const S = window.Sfx;
  if (S) {
    S.setPack(s.pack);
    S.setVolume(s.volume);
    S.setEnabled(s.on);
  }
  store.set('sfx', s);
  /* 音效设置有两个入口（设置页 + 播放页弹层），控件按 data-sfx-* 找，
     不认 id —— 两边画的是同一份状态，加一个入口不用改这里。 */
  $$('[data-sfx-switch]').forEach(sw => {
    sw.classList.toggle('is-on', s.on);
    sw.setAttribute('aria-checked', String(s.on));
  });
  $$('[data-sfx-pack]').forEach(b => {
    const on = b.dataset.sfxPack === s.pack;
    /* 圆点是行里的子元素，类要加在它身上 —— 加在按钮上屏幕上什么都不会变。
       按钮自己也带一份：弹层那边选中行的底色画在按钮上。 */
    b.classList.toggle('is-on', on);
    const dot = b.querySelector('.radio');
    if (dot) dot.classList.toggle('is-on', on);
  });
  const pct = Math.round(s.volume * 100);
  $$('[data-sfx-range]').forEach(r => { r.value = String(pct); });
  $$('[data-sfx-val]').forEach(n => { n.textContent = pct + '%'; });
  const name = (S && S.packs && S.packs[s.pack]) || s.pack;
  const text = s.on ? name + ' · ' + pct + '%' : '已关闭';
  $$('[data-sfx-sum]').forEach(n => { n.textContent = text; });
}

/* ───────────────────────── 播放音效 ───────────────────────── */

/* 注意别和上面那套搞混：
     · **界面音效**（上面）= 点一下响一声的提示音，声音在 WebView 里合成，跟歌没关系；
     · **播放音效**（这里）= 真正改歌的声音的 DSP：均衡器预设 / 低音增强 / 环绕声 / 响度增强 / 环境混响。
   两者名字里都有「音效」，所以界面上一个叫「播放音效」一个叫「界面音效」。

   状态**不在这里存**：它落在洛雪的设置里，由原生 AudioEffectModule 挂到播放器的音频会话上。
   打开面板时 `Tide.soundEffect()` 拉一次，改任何一项走 `Tide.soundEffectSet()`，
   返回的就是最新状态，照着重画即可 —— 界面只是个显示器，刷新永远从内核来。

   预设分三组（设备预设 / VLC 经典 / AutoEq 耳机校正），但它们共用一套下标，
   所以点哪个直接把 index 交给内核，不需要界面拼 id。 */

const PF_REVERB_LABELS = { 0: '关闭', 1: '小房间', 2: '中房间', 3: '大房间', 5: '大厅', 6: '金属板' };
const PF_KNOBS = [
  { key: 'bassBoost', label: '低音增强' },
  { key: 'virtualizer', label: '环绕声' },
  { key: 'loudness', label: '响度增强' },
];
const PF_EMPTY = {
  loaded: false, available: false, reason: '',
  enabled: true, preset: -1, bassBoost: 0, virtualizer: 0, loudness: 0, reverb: 0,
  reverbOptions: [0, 1, 2, 3, 5, 6],
  supports: {}, groups: [],
};

/* 当前在看哪一组预设的页签 */
let pfGroup = 'device';

/* 面板里那三份列表（分组页签 / 预设 / 混响）的「上次画成什么样」。
   拖滑块、切开关都会重画整个面板，但这三份列表一个字都没变 ——
   每次都重写一遍 innerHTML（预设最多 20 个 chip，两个入口各一份）纯属白干。 */
const pfShapes = new WeakMap();

function pf() { return state.playfx || PF_EMPTY; }

/* 面板结构只生成一次（两个入口共用同一份模板），之后 applyPlayFx 只改内容。
   一律用 data-* 挂事件、不写 id：同一个面板在弹层和设置页各有一份，写 id 会撞。 */
function pfTemplate() {
  const knobs = PF_KNOBS.map(k => `
        <div class="pf-knob" data-pf-knob="${k.key}">
          <div class="pf-knob__top"><span>${k.label}</span><span class="pf-knob__val" data-pf-val="${k.key}">关闭</span></div>
          <input class="slider" type="range" min="0" max="100" step="5" value="0"
                 data-pf-range="${k.key}" aria-label="${k.label}">
        </div>`).join('');
  return `
      <div class="s-row s-row--static">
        <span class="s-row__main">
          <span class="s-row__title">启用音效</span>
          <span class="s-row__desc" data-pf-state>未启用效果</span>
        </span>
        <button class="switch" role="switch" aria-checked="false" data-pf-switch aria-label="启用音效"></button>
      </div>
      <p class="s-note" data-pf-reason hidden></p>
      <div class="pf-group">
        <div class="s-group__label">均衡器预设</div>
        <div class="segs segs--scroll" data-pf-groups hidden></div>
        <div class="chips pf-presets" data-pf-presets></div>
        <p class="s-note" data-pf-credit hidden></p>
      </div>
      <div class="pf-group">
        <div class="s-group__label">增强</div>${knobs}
        <div class="pf-knob" data-pf-knob="reverb">
          <div class="pf-knob__top"><span>环境混响</span><span class="pf-knob__val" data-pf-val="reverb">关闭</span></div>
          <div class="chips" data-pf-reverbs></div>
        </div>
      </div>`;
}

/* 选中的预设叫什么（跨组找，因为当前看的页签不一定是它所在的那组） */
function pfPresetName(p) {
  if (p.preset < 0) return '';
  for (let i = 0; i < (p.groups || []).length; i++) {
    const g = p.groups[i];
    for (let j = 0; j < (g.presets || []).length; j++) {
      if (g.presets[j].index === p.preset) return g.presets[j].name;
    }
  }
  return '';
}

/* 一句话摘要，给设置页那一行和「更多」弹层用 */
function pfSummary(p) {
  if (!p.enabled) return '已关闭';
  const bits = [];
  const name = pfPresetName(p);
  if (name) bits.push(name);
  if (p.bassBoost > 0) bits.push('低音 ' + Math.round(p.bassBoost / 10) + '%');
  if (p.virtualizer > 0) bits.push('环绕 ' + Math.round(p.virtualizer / 10) + '%');
  if (p.loudness > 0) bits.push('响度 ' + Math.round(p.loudness / 10) + '%');
  if (p.reverb > 0) bits.push(PF_REVERB_LABELS[p.reverb] || '混响');
  return bits.length ? bits.join(' · ') : '未启用效果';
}

function applyPlayFx() {
  const p = pf();
  const groups = p.groups || [];
  /* 换设备 / 内核还没回过数据时，页签可能指着一个不存在的组 */
  if (!groups.some(g => g.id === pfGroup)) pfGroup = groups.length ? groups[0].id : '';

  $$('[data-playfx]').forEach(box => {
    if (!box.dataset.pfBuilt) {
      box.innerHTML = pfTemplate();
      box.dataset.pfBuilt = '1';
    }
    const sw = $('[data-pf-switch]', box);
    sw.classList.toggle('is-on', !!p.enabled);
    sw.setAttribute('aria-checked', String(!!p.enabled));
    $('[data-pf-state]', box).textContent = pfSummary(p);

    /* 设备没有效果库 / 还没开始播放时，原生会给一句原因，直接显示出来 */
    const note = $('[data-pf-reason]', box);
    const msg = !p.loaded ? '' : (!p.available ? (p.reason || '开始播放后自动生效') : '');
    note.textContent = msg;
    note.hidden = !msg;

    const tabs = $('[data-pf-groups]', box);
    let shapes = pfShapes.get(box);
    if (!shapes) pfShapes.set(box, shapes = {});
    const tabsSig = pfGroup + '\u0001' + groups.map(g => g.id + '=' + g.name).join('\u0002');
    if (shapes.tabs !== tabsSig) {
      shapes.tabs = tabsSig;
      tabs.innerHTML = groups.map(g =>
        '<button class="seg' + (g.id === pfGroup ? ' is-on' : '') + '" data-pf-group="' + g.id + '">' + esc(g.name) + '</button>'
      ).join('');
    }
    tabs.hidden = groups.length < 2;

    const cur = groups.filter(g => g.id === pfGroup)[0];
    const presetList = [{ index: -1, name: '关闭' }].concat(cur ? cur.presets : []);
    const presetSig = p.preset + '\u0001' + presetList.map(it => it.index + '=' + it.name).join('\u0002');
    const pbox = $('[data-pf-presets]', box);
    if (shapes.presets !== presetSig) {
      shapes.presets = presetSig;
      pbox.innerHTML = presetList
        .map(it => '<button class="chip' + (it.index === p.preset ? ' is-on' : '')
          + '" data-pf-preset="' + it.index + '">' + esc(it.name) + '</button>').join('');
    }

    const credit = $('[data-pf-credit]', box);
    credit.textContent = cur ? cur.credit : '';
    credit.hidden = !cur || !cur.credit;

    PF_KNOBS.forEach(k => {
      const v = Number(p[k.key] || 0);
      const row = $('[data-pf-knob="' + k.key + '"]', box);
      row.hidden = p.supports && p.supports[k.key] === false;
      $('[data-pf-range="' + k.key + '"]', box).value = String(Math.round(v / 10));
      $('[data-pf-val="' + k.key + '"]', box).textContent = v > 0 ? Math.round(v / 10) + '%' : '关闭';
    });

    const rbox = $('[data-pf-reverbs]', box);
    const rrow = $('[data-pf-knob="reverb"]', box);
    rrow.hidden = p.supports && p.supports.reverb === false;
    const reverbSig = (p.reverbOptions || []).join(',') + '\u0001' + p.reverb;
    if (shapes.reverbs !== reverbSig) {
      shapes.reverbs = reverbSig;
      rbox.innerHTML = (p.reverbOptions || []).map(v =>
        '<button class="chip' + (Number(v) === Number(p.reverb) ? ' is-on' : '')
        + '" data-pf-reverb="' + v + '">' + (PF_REVERB_LABELS[v] || v) + '</button>').join('');
    }
    $('[data-pf-val="reverb"]', box).textContent = PF_REVERB_LABELS[p.reverb] || '关闭';
  });

  $$('[data-playfx-sum]').forEach(n => { n.textContent = pfSummary(p); });
}

/* 从内核拉一次最新状态 */
function loadPlayFx() {
  applyPlayFx();
  return Tide.soundEffect().then(r => {
    if (r) state.playfx = r;
    applyPlayFx();
    return r;
  }).catch(err => {
    log('soundEffect failed:', (err && err.message) || String(err));
    return null;
  });
}

/* 改设置：内核改完会把最新状态回给我们，直接照着重画（不本地猜） */
function setPlayFx(patch) {
  return Tide.soundEffectSet(patch).then(r => {
    if (r) state.playfx = r;
    applyPlayFx();
    return r;
  }).catch(err => {
    log('soundEffectSet failed:', (err && err.message) || String(err));
    sfx('error');
    toast('音效设置没生效');
    return null;
  });
}

/* ───────────────────────── 常量 ───────────────────────── */

const FONT_LABELS = ['小','较小','标准','较大','大'];
const FONT_SCALES = [0.9, 0.95, 1, 1.08, 1.16];

const SKINS = {
  ink:      { name:'墨黑', accent:'#3ECFB2' },
  midnight: { name:'午夜', accent:'#7C6BFF' },
  abyss:    { name:'深海', accent:'#4EA8FF' },
  dune:     { name:'暖砂', accent:'#FFB454' },
  sakura:   { name:'樱雾', accent:'#FF6BCB' },
  cyber:    { name:'赛博', accent:'#4ADE80' },
};

const ACCENT_NAMES = {
  '#3ECFB2':'薄荷', '#7C6BFF':'星紫', '#4EA8FF':'晴空',
  '#FFB454':'琥珀', '#FF6BCB':'蔷薇', '#4ADE80':'青柠',
};

const MODE_NAMES = { dark:'深色', light:'浅色', system:'跟随系统' };
const PLAY_MODES = ['顺序播放', '随机播放', '单曲循环'];

/* 平台短名与内核桥、原生页保持一致；搜索多一个「全部」 */
const SOURCE_ALL = { id: 'all', name: '全部' };
const ONLINE_SOURCES = [
  SOURCE_ALL,
  { id: 'kw', name: '酷我' },
  { id: 'kg', name: '酷狗' },
  { id: 'tx', name: 'QQ' },
  { id: 'wy', name: '网易云' },
  { id: 'mg', name: '咪咕' },
];
const PLATFORM_SOURCES = ONLINE_SOURCES.slice(1);

/* ───────────────────────── 状态 ───────────────────────── */

const state = {
  tab: 'home',
  theme: 'dark',
  skin: 'ink',
  accent: '#3ECFB2',
  sfx: { on: true, pack: 'crystal', volume: 0.65 },

  current: null,        // 当前播放歌曲
  isPlay: false,
  position: 0,
  duration: 0,
  mode: 2,
  liked: false,
  hasTrack: false,
  miniActive: false,

  lists: {},            // token -> songs，用于渲染与取索引
  coverKey: 'a',
  heroKey: null,
  charts: [],           // 榜单列表（封面是异步补的，要能回写）
  playlistTitle: '',    // 当前打开的歌单名，分享时用

  /* 搜索页拿到的历史与热搜词，搜索联想要用它们做本地候选（不用再问一次内核） */
  searchHistory: [],
  searchHot: [],

  /* 三个平台选择器：搜索源 / 榜单平台 / 歌单平台。
     初始值先用固定的平台表，启动后由内核设置覆盖（原生页改过也能同步）。 */
  searchSource: 'all',
  searchSources: ONLINE_SOURCES.slice(),
  chartSource: 'kw',
  chartSources: PLATFORM_SOURCES.slice(),
  squareSource: 'kw',
  squareSources: PLATFORM_SOURCES.slice(),
};

const subStack = [];
let currentPlaylistId = null;

/* ───────────────────────── 封面 ───────────────────────── */

/* 封面色渐变。getComputedStyle 会强制一次同步样式刷新，而换歌时正好要连着
   写两处封面（播放页背景 + 歌单头图），所以按色键缓存一份。
   --c-* 同时受 data-skin 和 data-theme 影响，两者一变就得清（见 clearCoverCache）。 */
const gradientCache = {};
function coverGradient(key) {
  const hit = gradientCache[key];
  if (hit) return hit;
  const cs = getComputedStyle(document.documentElement);
  const a = cs.getPropertyValue('--c-' + key + '-1').trim() || '#FF9A6B';
  const b = cs.getPropertyValue('--c-' + key + '-2').trim() || '#FF4E7A';
  return (gradientCache[key] = 'linear-gradient(140deg,' + a + ',' + b + ')');
}

function clearCoverCache() {
  for (const k in gradientCache) delete gradientCache[k];
}

function applyCoverVars(el, key) {
  if (el) el.style.backgroundImage = coverGradient(key);
}

/* 播放页背景：优先用真封面（模糊后整页都是这首歌的颜色），
   没图或图挂了就退回这套皮肤的渐变。两层一起写，图挂了会自动露出渐变。 */
function setPlayerBg() {
  const el = $('#playerBg');
  if (!el) return;
  const song = state.current;
  const key = state.coverKey || (song && song.cover) || 'a';
  const fallback = coverGradient(key);
  el.style.backgroundImage = (song && song.pic)
    ? 'url("' + String(song.pic).replace(/"/g, '%22') + '"), ' + fallback
    : fallback;
}

/* 有图用图（加载失败自动退回渐变），没图直接用渐变 */
function coverHtml(song, cls) {
  const key = (song && song.cover) || 'a';
  let html = '<span class="' + cls + ' cover cover--' + key + '">';
  if (song && song.pic) {
    html = '<span class="' + cls + ' cover cover--' + key + ' cover--img">' +
      '<img class="cover__img" src="' + esc(song.pic) + '" alt="" loading="lazy" ' +
      'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">';
  }
  return html + '</span>';
}

function refreshCovers() {
  setPlayerBg();
  if (state.heroKey) applyCoverVars($('#plHeroBg'), state.heroKey);
}

/* ───────────────────────── 歌曲行 ───────────────────────── */

/* token 用于回传给内核定位列表；idx 是行在列表里的下标 */
function songRow(song, idx, token) {
  const cur = state.hasTrack && state.current && state.current.key === song.key;
  return (
    '<div class="song' + (cur ? ' is-current' : '') + '" data-token="' + esc(token || '') +
      '" data-idx="' + idx + '" role="button" tabindex="0">' +
      '<span class="song__idx">' + (idx + 1) + '</span>' +
      '<span class="song__wave"><i></i><i></i><i></i></span>' +
      coverHtml(song, 'song__cover') +
      '<span class="song__main">' +
        '<span class="song__title">' + esc(song.name) + '</span>' +
        '<span class="song__meta">' + esc(song.singer) + (song.album ? ' · ' + esc(song.album) : '') + '</span>' +
      '</span>' +
    '</div>'
  );
}

/* 已渲染的列表：容器 → { token, rows, marked }。
   「哪一行正在播放」得跟着每个播放事件重算，早先的写法是每次全文档
   querySelectorAll('[data-token]') 再逐个读 dataset —— 搜索结果那种
   一百多行的列表下，这一步比渲染本身还贵。现在只遍历这几个容器，
   而且只在「标红的那一行真的变了」时才碰 DOM。 */
const renderedLists = new Map();
let markKey;          // 上次标红用的歌 key；undefined = 需要重算

function noteList(box, token) {
  const prev = renderedLists.get(box);
  /* 同一个容器换了列表：旧 token 的歌曲数据没人用了，顺手扔掉，
     否则一个长会话里 state.lists 会一直涨 */
  if (prev && prev.token !== token) delete state.lists[prev.token];
  renderedLists.set(box, { token: token, rows: null, marked: -1 });
  markKey = undefined;
}

function renderList(el, songs, token, emptyNote) {
  if (!el) return;
  if (token) {
    state.lists[token] = songs || [];
    noteList(el, token);
  } else {
    renderedLists.delete(el);
    markKey = undefined;
  }
  if (!songs || !songs.length) {
    el.innerHTML = '<p class="s-note">' + esc(emptyNote || '这里还没有歌曲。') + '</p>';
    return;
  }
  el.innerHTML = songs.map((s, i) => songRow(s, i, token)).join('');
  markCurrent();
}

function markCurrent() {
  const key = state.hasTrack && state.current ? state.current.key : null;
  if (key === markKey) return;
  markKey = key;
  renderedLists.forEach((entry, box) => {
    if (!box.isConnected) { renderedLists.delete(box); return; }
    const songs = state.lists[entry.token];
    if (!songs) return;
    const prev = entry.marked == null ? -1 : entry.marked;
    /* 先按数据算下标，再决定要不要碰 DOM：数组比较比 DOM 读取便宜一个量级 */
    let idx = -1;
    if (key) {
      for (let i = 0; i < songs.length; i++) {
        if (songs[i].key === key) { idx = i; break; }
      }
    }
    if (idx === prev) return;
    const rows = entry.rows || (entry.rows = $$('[data-token]', box));
    if (prev > -1 && rows[prev]) rows[prev].classList.remove('is-current');
    if (idx > -1 && rows[idx]) rows[idx].classList.add('is-current');
    entry.marked = idx;
  });
}

function playlistCard(p) {
  const key = p.cover || 'c';
  const badge = '<span class="pcard__plays">' + icon('play') + esc(p.meta || '') + '</span>';
  const cover = p.img
    ? '<span class="pcard__cover cover cover--' + key + ' cover--img">' +
        '<img class="cover__img" src="' + esc(p.img) + '" alt="" loading="lazy" ' +
        'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">' + badge + '</span>'
    : '<span class="pcard__cover cover cover--' + key + '">' + badge + '</span>';
  return (
    '<button class="pcard" data-playlist="' + esc(p.id) + '">' +
      cover +
      '<span class="pcard__name">' + esc(p.name) + '</span>' +
    '</button>'
  );
}

function playlistItem(p) {
  const key = p.cover || 'c';
  const cover = p.img
    ? '<span class="plist__cover cover cover--' + key + ' cover--img">' +
        '<img class="cover__img" src="' + esc(p.img) + '" alt="" loading="lazy" ' +
        'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">' +
      '</span>'
    : '<span class="plist__cover cover cover--' + key + '"></span>';
  return (
    '<button class="plist__item" data-playlist="' + esc(p.id) + '">' +
      cover +
      '<span class="plist__main">' +
        '<span class="plist__name">' + esc(p.name) + '</span>' +
        '<span class="plist__meta">' + esc(p.meta || '') + '</span>' +
      '</span>' +
      icon('right', 'icon--sm icon--dim') +
    '</button>'
  );
}

/* ───────────────────────── 各页渲染 ───────────────────────── */

/* 「为你精选」在等网络时的占位卡：只占位置、不显示内容。
   不等它的话，卡片到了会把下面的「猜你喜欢」整体推下去，看着就是跳一下。 */
function playlistGhost(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<span class="pcard pcard--ghost" aria-hidden="true">' +
      '<span class="pcard__cover cover"></span>' +
      '<span class="pcard__name">&nbsp;</span>' +
    '</span>';
  }
  return out;
}

/* 「猜你喜欢」在等补足时的占位条：只占位置、不显示内容，理由同 playlistGhost */
function songGhost(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<div class="song song--ghost" aria-hidden="true">' +
      '<span class="song__idx">' + (i + 1) + '</span>' +
      '<span class="song__cover cover"></span>' +
      '<span class="song__main">' +
        '<span class="song__title">&nbsp;</span>' +
        '<span class="song__meta">&nbsp;</span>' +
      '</span>' +
    '</div>';
  }
  return out;
}

/* 「为你精选」的内容是内核异步推来的（本地那部分不等网络，见 bridge 的 home） */
let homePlaylistsArrived = false;
function applyHomePlaylists(list) {
  const el = $('#homePlaylists');
  if (!el) return;
  homePlaylistsArrived = true;
  el.innerHTML = (list && list.length)
    ? list.slice(0, 6).map(playlistCard).join('')
    : '<p class="s-note">歌单广场暂时取不到内容。</p>';
}

async function renderHome() {
  try {
    const d = await Tide.home();
    likesToken = d.token || null;
    /* 桥那条路回的是空数组（歌单广场由事件补），预览的 mock 直接回数据 */
    if (d.playlists && d.playlists.length) applyHomePlaylists(d.playlists);
    else if (!homePlaylistsArrived) $('#homePlaylists').innerHTML = playlistGhost(3);
    const songs = d.likes || [];
    if (songs.length) {
      homeLikesArrived = true;
      renderList($('#listLikes'), songs, d.token);
      setLikesCount(songs.length);
    } else if (!homeLikesArrived) {
      /* 一首收藏都没有时先摆占位条，别先闪一句「还没听够」再被补足的内容顶掉 */
      $('#listLikes').innerHTML = songGhost(3);
    }
  } catch (e) {
    log('renderHome failed', e);
    $('#listLikes').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* 标题上的首数。写出来有两个用处：用户一眼看到「30 首」（他要的就是这个），
   验收也能直接读这个数字 —— 光看列表是数不出行数的。 */
function setLikesCount(n) {
  const el = $('#likesCount');
  if (el) el.textContent = n || 0;
}

/* 「猜你喜欢」= 收藏的歌（排在前面）+ 从榜单补足到 30 首。
   补足要拉榜单，所以桥先回本地的收藏让首屏立刻画出来，取到池子后再推
   homeLikes 覆盖一次（同「为你精选」那条 homePlaylists）。 */
let homeLikesArrived = false;

function applyHomeLikes(songs, token) {
  homeLikesArrived = true;
  if (!songs || !songs.length) {
    setLikesCount(0);
    renderList($('#listLikes'), null, null,
      '还没听够。多放几首，这里就会按你的口味推荐。');
    return;
  }
  likesToken = token || null;
  renderList($('#listLikes'), songs, token);
  setLikesCount(songs.length);
}

/* ───────────────────── 每日推荐 ───────────────────── */

/* 内核按日期从榜单里挑 30 首：同一天进来是同 30 首，「换一批」换下一组。
   首屏不拉，进这个页面才拉。 */
let dailyShift = 0;
let dailyLoaded = false;

async function renderDaily(shift) {
  const btn = $('#dailyMore');
  if (btn) btn.disabled = true;
  try {
    const d = await Tide.daily(shift || 0);
    dailyShift = shift || 0;
    dailyLoaded = true;
    const songs = d.songs || [];
    $('#dailySub').textContent = d.sub || '每天 0 点换一批';
    $('#dailyCount').textContent = songs.length;
    const play = $('#dailyPlayAll');
    play.disabled = !songs.length;
    play.setAttribute('data-token', d.token || '');
    renderList($('#listDaily'), songs, d.token);
    const sc = $('#scr-daily .scroll');
    if (sc) sc.scrollTop = 0;
    /* 可选池不比 30 大就换不动，把按钮置灰，而不是让它点了没反应 */
    if (btn) btn.disabled = d.canShuffle === false;
  } catch (e) {
    log('renderDaily failed', e);
    $('#listDaily').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
    if (btn) btn.disabled = false;
  }
}

/* 首页那几处「播放全部 / 私人 FM」都指向收藏列表 */
let likesToken = null;
function playLikes() {
  if (!likesToken) { sfx('error'); toast('还没有收藏的歌曲'); return; }
  Tide.play(likesToken, 0).catch(err => {
    log(err);
    sfx('error');
    toast(userMsg(err, '播放失败'));
  });
}

/* 桥那边用 tideUser 标出「这句可以直接给用户看」，其余的（超时、未知命令）
   一律换成一句人话，别把 bridge timeout 甩到脸上。 */
function userMsg(err, fallback) {
  return err && err.tideUser && err.message ? err.message : fallback;
}

/* 榜单封面：内核把每个榜第一首歌的专辑图当榜单封面推过来。
   还没推到时先用渐变 + 首字水印占位，别让卡片看起来像没画完的空色块。 */
function chartCover(c, cls) {
  const key = c.cover || 'b';
  if (c.img) {
    return '<span class="' + cls + ' cover cover--' + key + ' cover--img">' +
      '<img class="cover__img" src="' + esc(c.img) + '" alt="" loading="lazy" ' +
      'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">' +
    '</span>';
  }
  return '<span class="' + cls + ' cover cover--' + key + '">' +
    '<span class="cover__mark">' + esc(String(c.name || '榜').slice(0, 1)) + '</span>' +
  '</span>';
}

function applyFeature(f) {
  $('#featureName').textContent = f.name;
  $('#featureMeta').textContent = f.meta || '';
  $('#feature').setAttribute('data-playlist', f.id);
  const cover = $('#featureCover');
  cover.className = 'feature__cover cover cover--' + (f.cover || 'g') + (f.img ? ' cover--img' : '');
  cover.innerHTML = f.img
    ? '<img class="cover__img" src="' + esc(f.img) + '" alt="" ' +
      'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">'
    : '<svg class="icon icon--xl"><use href="#i-fire"/></svg>';
  $('#featureTops').innerHTML = (f.tops || []).slice(0, 3).map((t, k) =>
    '<span><b>' + (k + 1) + '</b>' + esc(t) + '</span>').join('');
}

/* 榜单封面按需补：只问看得见的那几张。
   酷我有 43 个榜单，启动时一次性全问就是 43 个请求（实测从 +3.5s 一直占到 +7.5s），
   和首屏那条数据请求抢带宽，而用户可能根本不进榜单页 —— 所以改成滚到哪问到哪。 */
let chartCoverIo = null;
function observeChartCovers() {
  const grid = $('#chartGrid');
  if (!grid) return;
  if (chartCoverIo) chartCoverIo.disconnect();
  if (typeof IntersectionObserver !== 'function') {
    /* 老 WebView 没有 IntersectionObserver：退回一次性全要，封面至少能出来 */
    Tide.chartCovers({ ids: (state.charts || []).map(c => c.id) }).catch(() => {});
    return;
  }
  const want = new Set();
  let timer = 0;
  const flush = () => {
    timer = 0;
    if (!want.size) return;
    const ids = Array.from(want);
    want.clear();
    Tide.chartCovers({ ids: ids }).catch(() => {});
  };
  chartCoverIo = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      want.add(en.target.dataset.playlist);
      chartCoverIo.unobserve(en.target); /* 问过一次就不再问，滚动时不反复发消息 */
    });
    if (want.size && !timer) timer = setTimeout(flush, 50);
  }, { rootMargin: '240px 0px' });
  $$('#chartGrid .chartcard').forEach(el => chartCoverIo.observe(el));
}

async function renderCharts() {
  /* 标记要在发请求**之前**立起来：点一下没反应用户往往会再点一下，
     而这里原来是等 await 回来才置位，那两下就会各发一条一模一样的请求。
     真失败时在 catch 里清掉，下次进来还能重试。 */
  tabLoaded.charts = true;
  try {
    const list = await Tide.charts(state.chartSource);
    if (!list.length) throw new Error('没有取到榜单');
    state.charts = list;
    applyFeature(list[0]);
    const sub = $('#chartSub');
    if (sub) {
      const name = platformName(state.chartSources, state.chartSource);
      sub.textContent = '每天 06:00 更新 · 共 ' + list.length + ' 个榜单' + (name ? ' · ' + name : '');
    }
    $('#chartGrid').innerHTML = list.map(c =>
      '<button class="chartcard" data-playlist="' + esc(c.id) + '">' +
        chartCover(c, 'chartcard__cover') +
        '<span class="chartcard__name">' + esc(c.name) + '</span>' +
        '<span class="chartcard__meta">' + esc(c.meta || '') + '</span>' +
      '</button>').join('');
    observeChartCovers();
  } catch (e) {
    log('renderCharts failed', e);
    tabLoaded.charts = false;          /* 失败就别把它当「加载过了」，下次进来重试 */
    const sub = $('#chartSub');
    if (sub) sub.textContent = '榜单加载失败，稍后再试试';
    $('#chartGrid').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* 内核补齐一个榜单的封面就推一条，这里贴上去 */
function applyChartCover(p) {
  if (!p || !p.id) return;
  const list = state.charts || [];
  const c = list.filter(x => x.id === p.id)[0];
  if (!c) return;
  c.img = p.img || '';
  c.tops = p.tops || [];
  const card = $('.chartcard[data-playlist="' + p.id + '"]');
  if (card) {
    const old = card.querySelector('.chartcard__cover');
    if (old) old.outerHTML = chartCover(c, 'chartcard__cover');
  }
  if (list[0] && list[0].id === p.id) applyFeature(list[0]);
}

/* ───────────────────── 歌单广场（首页「为你精选 · 全部」） ───────────────────── */

/* 一次一页；「换一批」就是翻下一页。第一次进这个子页面才拉数据，不占启动时间。 */
let squarePage = 0;
async function loadSquare(page) {
  const btn = $('#squareMore');
  if (btn) btn.disabled = true;
  try {
    const list = await Tide.square(page, state.squareSource);
    if (!list.length) { toast('没有更多歌单了'); return; }
    squarePage = page;
    $('#squareList').innerHTML = list.map(playlistItem).join('');
    const sc = $('#scr-square .scroll');
    if (sc) sc.scrollTop = 0;
  } catch (e) {
    log('loadSquare failed', e);
    $('#squareList').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* 「我的」页现在只放设置与统计 —— 歌单都搬去「收藏 · 歌单」了（v1.9.17） */
async function renderLibrary() {
  /* 同 renderCharts：标记先立，免得连点两下页签发两条请求 */
  tabLoaded.library = true;
  try {
    const d = await Tide.library();
    /* 上面那排统计原来是写死的假数字（428 / 12 / 86 / 关注 37），现在填内核里的真值 */
    const s = d.stats || {};
    const vals = $$('.stats__item b');
    if (vals[0]) vals[0].textContent = s.love || 0;
    if (vals[1]) vals[1].textContent = s.lists || 0;
    if (vals[2]) vals[2].textContent = s.downloads || 0;
    applyFavLists(d);
  } catch (e) {
    log('renderLibrary failed', e);
    tabLoaded.library = false;         /* 失败就别把它当「加载过了」，下次进来重试 */
  }
}

/* 歌单（自建 + 收藏）填进「收藏 · 歌单」页签。renderLibrary 与 renderFavLists 共用一份，
   以前是各写一遍 innerHTML，改一处忘一处。 */
function applyFavLists(d) {
  const my = d.my || [], fav = d.fav || [];
  $('#myPlaylists').innerHTML = my.map(playlistItem).join('') ||
    '<p class="s-note">还没有自建歌单。点右上角「新建」建一个。</p>';
  $('#favPlaylists').innerHTML = fav.map(playlistItem).join('') ||
    '<p class="s-note">在歌单详情页点「收藏」，整张歌单就会出现在这里。</p>';
  const mc = $('#myListCount'), fc = $('#favListCount');
  if (mc) mc.textContent = my.length;
  if (fc) fc.textContent = fav.length;
  const sub = $('#favSub');
  if (sub && favTab === 'list') sub.textContent = my.length + ' 个自建 · ' + fav.length + ' 个收藏';
}

/* 收藏页「歌单」页签：每次切过来都重取（刚收藏完 / 刚建完就能看到） */
async function renderFavLists() {
  try {
    applyFavLists(await Tide.library());
  } catch (e) {
    log('renderFavLists failed', e);
    $('#myPlaylists').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* ── 收藏页的两个页签（歌曲 / 歌单） ──
   自建歌单与收藏来的歌单都算「我的歌单」，跟歌曲收藏是一类东西，放一起才找得到；
   「我的」页留给设置。 */
let favTab = 'song';

function setFavTab(tab) {
  favTab = tab === 'list' ? 'list' : 'song';
  const songs = favTab === 'song';
  $('#favSongPane').hidden = !songs;
  $('#favListPane').hidden = songs;
  $$('[data-fav-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.favTab === favTab));
  $('#favTitle').textContent = songs ? '我喜欢的音乐' : '我的歌单';
  /* 两个页签各自去取自己要的数据；「歌曲」那份每次进来都重取，
     红心改过之后不会看到旧列表 */
  return songs ? renderFavorites() : renderFavLists();
}

/* 「收藏 · 歌曲」页签 = 我喜欢的音乐 */
async function renderFavorites() {
  const box = $('#listFav');
  try {
    const d = await Tide.playlistDetail('love');
    const songs = d.songs || [];
    const n = songs.length;
    $('#favCount').textContent = n;
    $('#favSub').textContent = n ? n + ' 首 · 来自你的收藏' : '还没有收藏的歌曲';
    const play = $('#favPlayAll');
    play.disabled = !n;
    play.setAttribute('data-token', d.token || '');
    box.innerHTML = '';
    if (!n) {
      box.innerHTML = '<p class="s-note">在播放页点一下红心，歌就会出现在这里。</p>';
      return;
    }
    renderList(box, songs, d.token);
    markCurrent();
  } catch (e) {
    log('renderFavorites failed', e);
    box.innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* ───────────────────────── 音源 ───────────────────────── */

/* 音源列表（「我的」那一行的摘要与「音源」页共用同一份数据）。
   数据来自桥的 apiSources：内核官方清单（api-source-info）是空数组，
   内置音源与用户导入的脚本都在 user.list 里，所以接起来就是全量。
   切换走 setApiSource，内核切完会广播 apiSourceUpdated → 桥转成 apiSources
   事件推过来，所以「在原生页里换的」也会让这两处自己更新。 */
let srcState = null;

function sourceList(d) {
  return (d && d.builtin ? d.builtin : []).concat(d && d.user ? d.user : []);
}

function sourceName(d, id) {
  const hit = sourceList(d).filter(a => a.id === id)[0];
  return hit ? hit.name : '';
}

function applySources(d) {
  if (!d) return;
  srcState = d;
  const all = sourceList(d);
  const cur = sourceName(d, d.active);
  const sum = $('#sourceSummary');
  if (sum) {
    sum.textContent = all.length
      ? (cur || '未选择音源') + ' · 共 ' + all.length + ' 个可选'
      : '还没有可用音源，点进去添加一个';
  }
  /* 这一页开着的时候顺手重画一遍（切换后就是靠这里更新的） */
  const page = $('#scr-source');
  if (page && page.classList.contains('is-active')) renderSourcePage(d);
  const add = $('#scr-source-add');
  if (add && add.classList.contains('is-active')) renderSourceAdd(d);
}

function renderSourcePage(d) {
  d = d || srcState;
  if (!d) return;
  const all = sourceList(d);
  const cur = sourceName(d, d.active);
  $('#srcNowName').textContent = cur || '未选择音源';
  $('#srcNowDesc').textContent = all.length
    ? '共 ' + all.length + ' 个可选，点一下就能切'
    : '还没有可用音源';
  $('#srcCount').textContent = all.length;
  $('#srcList').innerHTML = all.map(a => {
    const on = a.id === d.active;
    /* 脚本头里的 @version 有的带 v（`v0.74.0`）有的不带（`260809`），
       直接补一个 v 会拼成「vv0.74.0」—— 设备上截图看见的。 */
    const ver = a.version ? (/^v/i.test(a.version) ? a.version : 'v' + a.version) : '';
    const desc = [ver, a.desc || '', a.disabled ? '已停用' : '']
      .filter(Boolean).join(' · ');
    return '<button class="s-row s-row--pick' + (on ? ' is-on' : '') +
        '" data-pick-src="' + esc(a.id) + '">' +
      '<span class="s-ico i-a"><svg class="icon"><use href="#i-radio"/></svg></span>' +
      '<span class="s-row__main">' +
        '<span class="s-row__title">' + esc(a.name) + '</span>' +
        '<span class="s-row__desc">' + esc(desc || '音源脚本') + '</span>' +
      '</span>' +
      (on ? '<svg class="icon icon--sm src-check"><use href="#i-check"/></svg>' : '') +
    '</button>';
  }).join('') ||
    '<p class="s-note">还没有可用音源。点下面的「添加音源」导入一个脚本。</p>';
}

async function renderSource() {
  try {
    renderSourcePage(await Tide.apiSources());
  } catch (e) {
    log('renderSource failed', e);
    $('#srcList').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* 点一个音源就切过去。内核切完会广播，事件回来时这一页会自己重画，
   所以这里不用手动画一次「选中态」。 */
async function pickSource(id) {
  if (!id || (srcState && id === srcState.active)) return;
  try {
    const r = await Tide.setApiSource(id);
    if (r && r.ok === false) { sfx('error'); toast(r.msg || '切换失败'); return; }
    toast('已切换到「' + (sourceName(srcState, id) || '音源') + '」');
    await renderSource();
  } catch (e) {
    log('setApiSource failed', e);
    sfx('error');
    toast(userMsg(e, '切换失败'));
  }
}

async function loadSources() {
  try {
    applySources(await Tide.apiSources());
  } catch (e) {
    log('apiSources failed', e);
    const sum = $('#sourceSummary');
    if (sum) sum.textContent = '点进去选择或添加音源';
  }
}

/* ───────────────── 添加音源（v1.9.20） ─────────────────

   这一页原来就是内核那个「自定义源管理（实验性）」弹层：绿色头栏 + 居中小标题 +
   一排「允许显示更新弹窗」复选框 + 一大段免责声明，跟界面完全不一个审美
   （用户：「音源点进去三级菜单还是很割裂」）。现在自己画三块。

   真干活的是桥里那三条命令，它们直接复用内核自己的导入/删除逻辑
   （importUserApi / removeUserApi / selectFile），所以脚本校验、重复导入检测、
   更新提醒这些都不用重写，报错文案也直接用内核给的。 */
let srcPendingDel = null;

function setSrcHint(text, kind) {
  const el = $('#srcUrlHint');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-bad', kind === 'bad');
  el.classList.toggle('is-ok', kind === 'ok');
}

function srcVerDesc(a, active) {
  const ver = a.version ? (/^v/i.test(a.version) ? a.version : 'v' + a.version) : '';
  return [ver, a.desc || '', active ? '正在使用' : ''].filter(Boolean).join(' · ');
}

function renderSourceAdd(d) {
  d = d || srcState;
  if (!d) return;
  const box = $('#srcAddList');
  if (!box) return;
  const list = d.user || [];
  const cnt = $('#srcAddCount');
  if (cnt) cnt.textContent = list.length;
  box.innerHTML = list.map(a => {
    const del = a.id === srcPendingDel;
    return '<div class="s-row s-row--static">' +
      '<span class="s-ico i-g"><svg class="icon"><use href="#i-doc"/></svg></span>' +
      '<span class="s-row__main">' +
        '<span class="s-row__title">' + esc(a.name) + '</span>' +
        '<span class="s-row__desc">' + esc(srcVerDesc(a, a.id === d.active) || '音源脚本') + '</span>' +
      '</span>' +
      (del
        ? '<span class="s-row__confirm">' +
            '<button class="s-cbtn" data-del-cancel>取消</button>' +
            '<button class="s-cbtn s-cbtn--danger" data-del-go="' + esc(a.id) + '">删除</button>' +
          '</span>'
        : '<button class="s-row__del" data-del-ask="' + esc(a.id) + '" aria-label="删除">' +
            '<svg class="icon"><use href="#i-trash"/></svg></button>') +
    '</div>';
  }).join('') ||
    '<p class="s-note addsrc__hint">还没装过音源脚本，上面两种方式都能装。</p>';
}

/* 粘贴时常见三种写法：完整地址、少了协议的域名、前后带空格。
   内核只认 http(s):// 开头，所以这里替用户补一下，别让他对着报错发呆。 */
function normalizeSrcUrl(raw) {
  const u = String(raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}(?:[:/]|$)/i.test(u)) return 'https://' + u;
  return u;
}

async function importSourceUrl() {
  const input = $('#srcUrl');
  const go = $('#srcUrlGo');
  const url = normalizeSrcUrl(input && input.value);
  if (!url) {
    sfx('error');
    setSrcHint('先填一个地址再点导入。', 'bad');
    if (input) input.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    sfx('error');
    setSrcHint('地址要以 http:// 或 https:// 开头。', 'bad');
    return;
  }
  if (go) go.disabled = true;
  setSrcHint('正在下载脚本…');
  try {
    const r = await Tide.importApiSourceUrl(url);
    if (r && r.ok === false) { sfx('error'); setSrcHint(r.msg || '导入失败', 'bad'); return; }
    if (r && r.sources) applySources(r.sources);
    if (input) input.value = '';
    haptic();
    sfx('success');
    toast('音源已导入');
    setSrcHint('导入成功。回上一页点一下就能切过去。', 'ok');
  } catch (e) {
    log('importApiSourceUrl failed', e);
    sfx('error');
    setSrcHint(userMsg(e, '导入失败'), 'bad');
  } finally {
    if (go) go.disabled = false;
  }
}

async function importSourceFile() {
  setSrcHint('正在打开文件选择器…');
  try {
    const r = await Tide.importApiSourceFile();
    /* 用户在系统选择器里按了返回：这不是错误，别弹红字 */
    if (r && r.cancelled) { setSrcHint('没有选择文件。'); return; }
    if (r && r.ok === false) { sfx('error'); setSrcHint(r.msg || '导入失败', 'bad'); return; }
    if (r && r.sources) applySources(r.sources);
    haptic();
    sfx('success');
    toast('音源已导入');
    setSrcHint('导入成功。回上一页点一下就能切过去。', 'ok');
  } catch (e) {
    log('importApiSourceFile failed', e);
    sfx('error');
    setSrcHint(userMsg(e, '导入失败'), 'bad');
  }
}

async function removeSource(id) {
  const name = sourceName(srcState, id) || '这个音源';
  srcPendingDel = null;
  renderSourceAdd(srcState);
  try {
    const r = await Tide.removeApiSource(id);
    if (r && r.ok === false) { sfx('error'); toast(r.msg || '删除失败'); return; }
    if (r && r.sources) applySources(r.sources);
    sfx('success');
    toast('已删除「' + name + '」');
  } catch (e) {
    log('removeApiSource failed', e);
    sfx('error');
    toast(userMsg(e, '删除失败'));
  }
}

async function renderSearchStatic() {
  try {
    const [hot, hist] = await Promise.all([Tide.hot(), Tide.history()]);
    /* 存下来给搜索联想的本地候选用（见 localTips），省一次桥调用 */
    state.searchHistory = (hist || []).slice();
    state.searchHot = (hot || []).map(h => h.w).filter(Boolean);
    $('#historyChips').innerHTML = (hist || []).map(w =>
      '<button class="chip" data-search="' + esc(w) + '">' + esc(w) + '</button>').join('');
    $('#hotList').innerHTML = (hot || []).map((h, k) =>
      '<button class="hot" data-search="' + esc(h.w) + '">' +
        '<span class="hot__rank' + (k < 3 ? ' top' : '') + '">' + (k + 1) + '</span>' +
        '<span class="hot__main">' +
          '<span class="hot__word">' + esc(h.w) + '</span>' +
          '<span class="hot__desc">' + esc(h.d) + '</span>' +
        '</span>' +
        (h.b ? '<span class="hot__badge">' + esc(h.b) + '</span>' : '') +
      '</button>').join('');
  } catch (e) {
    log('renderSearchStatic failed', e);
  }
}

/* ───────────────────────── 歌单 / 榜单详情 ───────────────────────── */

/* 排序：默认 / 歌名 / 歌手。排序在原生侧做（界面按下标点歌，
   两边顺序不一致会点 A 放 B），所以这里只负责换模式 + 重新取一次。 */
const SORT_MODES = ['', 'name', 'singer'];
const SORT_LABEL = { '': '默认', name: '歌名', singer: '歌手' };
let playlistSort = '';

function setSortLabel() {
  const el = $('#plSortLabel');
  if (el) el.textContent = '排序：' + SORT_LABEL[playlistSort];
}

async function openPlaylist(id) {
  /* 换了歌单就回到默认顺序，不然上个歌单的排序会莫名跟过来 */
  if (id !== currentPlaylistId) {
    playlistSort = '';
    setSortLabel();
  }
  currentPlaylistId = id;
  pushSub('scr-playlist');
  $('#plTitle').textContent = '加载中…';
  $('#plAuthor').textContent = '';
  $('#plDesc').textContent = '';
  $('#listPlaylist').innerHTML = '';
  try {
    const d = await Tide.playlistDetail(id, playlistSort);
    state.playlistTitle = d.title;
    $('#plTitle').textContent = d.title;
    $('#plAuthor').textContent = (d.author || '') + ' · ' + (d.songs.length) + ' 首';
    $('#plDesc').textContent = d.desc || '';
    $('#plCount').textContent = d.songs.length;
    state.heroKey = d.cover || 'c';
    applyCoverVars($('#plHeroBg'), state.heroKey);
    // 有真实封面就用真图铺头部背景与封面；没有则退回皮肤渐变
    if (d.img) $('#plHeroBg').style.backgroundImage = 'url("' + d.img + '")';
    const heroCover = $('#plHeroCover');
    if (d.img) {
      heroCover.className = 'pl-hero__cover cover cover--' + state.heroKey + ' cover--img';
      heroCover.innerHTML = '<img class="cover__img" src="' + esc(d.img) + '" alt="" ' +
        'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">';
    } else {
      heroCover.className = 'pl-hero__cover cover cover--' + state.heroKey;
      heroCover.innerHTML = '';
    }
    renderList($('#listPlaylist'), d.songs, d.token);
    $('#playAllBtn').setAttribute('data-token', d.token || '');
    $('#plDownload').setAttribute('data-token', d.token || '');
  } catch (e) {
    log('openPlaylist failed', e);
    $('#plTitle').textContent = '加载失败';
    $('#listPlaylist').innerHTML = '<p class="s-note">' + esc(e.message || e) + '</p>';
  }
}

/* ───────────────────────── 导航 ───────────────────────── */

/* 页签：搜索不是页签了（改成首页搜索框进入的子页面），位置给了「收藏」 */
const TAB_IDS = ['scr-home', 'scr-charts', 'scr-fav', 'scr-library'];
const isTabScreen = id => TAB_IDS.indexOf(id) > -1;

/* 榜单/我的这两页的数据不在启动路径上：启动时先画首页，它们等浏览器空闲了
   再拉（见 boot）。万一用户手快先点了页签，这里补一次。 */
const tabLoaded = {};

function currentScreen() { return $('.screen.is-active'); }

/* ───────────────────────── 转场 ───────────────────────── */

/* 全站一套转场：时长与 CSS 的 --t5（.3s）对齐，缓动统一 --ease。
   动画结束后摘类，摘得比动画晚一点（+40ms），免得在最后一帧之前抢跑。
   以前页签切换是直接换 display、退子页是「旧的一下子消失」，用户说的
   「有些跳转比较生硬」就是这两处 —— 现在每个方向都有对应的动画。 */
const MOTION_MS = 300;
const MOTION_TAIL = MOTION_MS + 40;

/* 播一次入场动画。先摘类再强制重排，同一个元素连着用也能重放 */
function playEnter(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), MOTION_TAIL);
}

/* 让一个屏幕播完出场动画再真正藏起来（页签淡出 / 子页滑出） */
function leaveScreen(el) {
  if (!el) return;
  const wasActive = el.classList.contains('is-active');
  el.classList.remove('is-active', 'is-behind');
  if (!wasActive) return;
  const cls = el.classList.contains('screen--sub') ? 'is-pop' : 'is-leave';
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), MOTION_TAIL);
}

/* 被新页压在下面那一层：不藏起来，往左退一点并压暗 ——
   藏掉的话新页滑入时左边会露出一块纯底色，看着就是「跳」。
   注意要把 is-active 摘掉：留着的话同一时刻有两个「当前页」，
   currentScreen() 会返回文档里靠前的那个，返回键就失效了。
   显示靠的是 .screen.is-behind 的 display:flex。 */
function leaveBehind(el) {
  if (!el) return;
  el.classList.remove('is-active', 'is-behind');
  void el.offsetWidth;
  el.classList.add('is-behind');
  setTimeout(() => el.classList.remove('is-behind'), MOTION_TAIL);
}

function goTab(name) {
  closeSubs();
  const next = document.getElementById('scr-' + name);
  /* 同层切换：旧的留在原地淡出、新的淡入。只做「新的淡入」的话中间会露底色 */
  $$('.screen.is-active').forEach(s => { if (s !== next) leaveScreen(s); });
  if (next) {
    const already = next.classList.contains('is-active');
    next.classList.remove('is-behind', 'is-leave', 'is-pop');
    next.classList.add('is-active');
    /* 重复点当前页签不重播动画（会看着像闪一下） */
    if (!already) playEnter(next, 'is-enter');
  }
  state.tab = name;
  $$('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.tabGo === name));
  /* 收藏列表会被播放页的红心改到，每次进这个页签都重取一次，省得看到过期数据 */
  if (name === 'fav') void setFavTab(favTab);
  else if (name === 'charts' && !tabLoaded.charts) void renderCharts();
  else if (name === 'library') {
    if (!tabLoaded.library) void renderLibrary();
    /* 音源摘要每次进来都刷一遍：用户可能刚在原生音源页里换过 */
    void loadSources();
  }
  syncMini();
}

function pushSub(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isTabScreen(id)) { goTab(id.replace('scr-', '')); return; }

  const cur = currentScreen();
  if (cur) {
    if (cur.classList.contains('screen--sub')) subStack.push(cur.id);
    leaveBehind(cur);
  }
  el.classList.remove('is-returning', 'is-behind', 'is-leave', 'is-pop');
  void el.offsetWidth;
  el.classList.add('is-active');
  const sc = $('.scroll', el);
  if (sc) sc.scrollTop = 0;
  // 歌单广场是翻页数据，第一次进来才拉，不占启动时间
  if (id === 'scr-square') {
    void loadSquareSources().then(() => { if (!squarePage) void loadSquare(1); });
  }
  // 播放音效要问内核（设备能力 / 频段布局 / 预设），进来才拉
  if (id === 'scr-set-playfx') void loadPlayFx();
  // 每日推荐同理：进来才拉（同一天内容是固定的）
  if (id === 'scr-daily' && !dailyLoaded) void renderDaily(0);
  // 热搜与历史也一样：搜索页打开时才取，启动时不取
  if (id === 'scr-search') { void loadSearchSources(); void renderSearchStatic(); }
  // 上次退出时输入框可能还留着词，联想列表要跟着回来
  // （不然历史/热搜被藏起来了、候选却不显示，页面就空了）
  if (id === 'scr-search') {
    const v = ($('#searchInput').value || '').trim();
    if (v) { showTipsOnly(); showSearchTips(v); } else hideSearchTips();
  }
  // 搜索页进来就聚焦输入框（各家音乐 App 都这样）；等翻页动画起头再聚焦，不然会被打断
  if (id === 'scr-search') {
    setTimeout(() => { try { $('#searchInput').focus(); } catch (e) {} }, 280);
  }
  // 新建歌单同理：进来光标就在名字输入框里，省一次点击（也省得用户以为要手动点一下）
  if (id === 'scr-newlist') {
    setTimeout(() => { try { $('#newListName').focus(); } catch (e) {} }, 280);
  }
  // 音源页 / 添加音源页：进来先用手上那份数据画一屏（切过的话立即可见），再取一次最新的
  refreshSub(id);
  syncMini();
}

/* 子页「进来」和「退回来」都要按手上的数据重画一次。
   退回来那次尤其重要：在下一层里改过东西（比如删掉一个音源），事件回来时
   这一层不是 active，applySources 不会重画它 —— 不补就一直是旧列表。 */
function refreshSub(id) {
  if (id === 'scr-source') {
    renderSourcePage(srcState);
    void renderSource();
  } else if (id === 'scr-source-add') {
    srcPendingDel = null;
    /* 上一次进来时留下的红字/绿字不要带到这一次：用户可能刚在别处装好了音源，
       再进来还看到「下载失败」会以为是新发生的。 */
    setSrcHint('填音源脚本的直链（.js），点「导入」会下载并安装。');
    renderSourceAdd(srcState);
    void renderSource();
  }
}

function popSub() {
  const cur = currentScreen();
  if (!cur || !cur.classList.contains('screen--sub')) return;
  leaveScreen(cur);   /* 子页往右滑出去，而不是一下子消失 */

  const prevId = subStack.pop();
  const prev = prevId ? document.getElementById(prevId) : document.getElementById('scr-' + state.tab);
  if (!prev) return;

  /* 上一层可能还在「退到后面」的状态里（返回点得比动画快），先摘干净再让它回来 */
  prev.classList.remove('is-behind', 'is-enter', 'is-leave', 'is-pop', 'is-returning');
  void prev.offsetWidth;
  prev.classList.add('is-active');
  /* 一律从左侧回位（进去时它退到左边），页签层与子页同一套 */
  playEnter(prev, 'is-returning');
  refreshSub(prevId);
  syncMini();
}

function closeSubs() {
  while (subStack.length) {
    const el = document.getElementById(subStack.pop());
    if (el) leaveScreen(el);
  }
  $$('.screen--sub.is-active').forEach(s => leaveScreen(s));
}

/* ───────────────────────── 返回键 ───────────────────────── */

/* 界面是单页应用，安卓返回键得先问界面能不能退：把「还有没有上一层」告诉原生。
   值没变就不发了 —— 这个方法原来会被每个播放事件叫到（syncMini 里），
   于是一首歌播下来要给原生白发几百条 navState。 */
let navCanBack = null;

function notifyNav() {
  const cur = currentScreen();
  const canBack = !!(cur && cur.classList.contains('screen--sub')) ||
    $('#player').classList.contains('is-open') ||
    !!currentSheet;
  if (canBack === navCanBack) return;
  navCanBack = canBack;
  try { Tide.navState(canBack); } catch (e) {}
}

/* 原生返回键按下时调这里，返回 false 表示界面已处理 */
window.TideGoBack = function () {
  if (currentSheet) { sfx('nav'); closeSheet(); return true; }
  if ($('#player').classList.contains('is-open')) { sfx('nav'); closePlayer(); return true; }
  const cur = currentScreen();
  if (cur && cur.classList.contains('screen--sub')) { sfx('nav'); popSub(); return true; }
  return false;
};

/* ───────────────────────── 播放 ───────────────────────── */

/* 内核推来的当前歌曲。

   播放事件里绝大多数只是「播放/暂停」或进度变了，歌没变。早先这里不分
   青红皂白把封面 innerHTML 重写一遍，等于每次按暂停都新建一个 <img>：
   图片要重新解码、重新绘制，偶尔还能看见一下闪。现在分三层：
     · 每次都要更新的（图标/红心/模式/进度）—— 便宜，直接做
     · 换歌才更新的（文字/时长/歌词/标红）
     · 换歌或换封面图才重建的（两处封面 + 播放页背景）
   用一个 key+图片地址 的签名来判断，封面后到（先有歌再有图）也能补上。 */
let coverSig = null;

function applyPlayer(p) {
  if (!p || !p.song) return;
  const song = p.song;
  const prevKey = state.hasTrack && state.current ? state.current.key : null;
  const songChanged = prevKey !== song.key;
  const sig = song.key + '\u0001' + (song.pic || '');
  const coverChanged = sig !== coverSig;

  state.current = song;
  state.hasTrack = true;
  state.miniActive = true;
  state.isPlay = !!p.isPlay;
  state.mode = p.mode != null ? p.mode : state.mode;
  state.liked = !!p.liked;
  if (p.duration) state.duration = p.duration;
  if (p.position != null) state.position = p.position;

  if (songChanged) {
    /* 换歌了：上一首的 seek 乐观位置作废，别把新歌的进度画成旧目标 */
    seekHold = 0;
    $('#pTitle').textContent = song.name;
    $('#pArtist').textContent = song.singer + (song.album ? ' · ' + song.album : '');
    $('#miniTitle').textContent = song.name;
    $('#miniArtist').textContent = song.singer;
    if (!song.interval) song.interval = fmt(state.duration);
    $('#pDur').textContent = song.interval || fmt(state.duration);
    markCurrent();
    loadLyrics();
  }

  if (coverChanged) {
    coverSig = sig;
    state.coverKey = song.cover || 'a';
    const artCls = 'player__art cover cover--' + state.coverKey + (song.pic ? ' cover--img' : '') + ' is-beat';
    $('#pArt').className = artCls;
    $('#pArt').innerHTML = song.pic
      ? '<img class="cover__img" src="' + esc(song.pic) + '" alt="" ' +
        'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">'
      : '';
    setPlayerBg();

    const mc = 'mini__cover cover cover--' + state.coverKey + (song.pic ? ' cover--img' : '');
    $('#miniCover').className = mc;
    $('#miniCover').innerHTML = song.pic
      ? '<img class="cover__img" src="' + esc(song.pic) + '" alt="" ' +
        'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">'
      : '';
  }

  setPlayIcon(state.isPlay);
  updateLike();
  updateModeUI();
  updateProgressUI();
  syncMini();
}

function applyProgress(p) {
  if (!p) return;
  state.position = p.position || 0;
  if (p.duration) state.duration = p.duration;
  const durEl = $('#pDur');
  if (durEl && state.duration) durEl.textContent = fmt(state.duration);
  updateProgressUI();
  syncLyric();
}

/* 进度是每秒推 4 次的，位置没变（或算出来的百分比没变）就别写 DOM 了。
   而且**只写看得见的那一条**：播放页开着时它整屏盖住迷你条，收起时反过来。
   两条都写的话，总有一条是在给看不见的元素做重排 —— 收起态的 .player 是
   visibility:hidden，一样参与布局（实测这一条占主线程的 10%，见 styles.css
   里 .bar__fill 那段注释）。写的是 transform 不是 width，重排一帧都不会有。 */
let progressSig = null;

/* 拖进度条时的两个状态位。
   seeking：手指按在条上。内核每秒还会推 4 次进度，不把它挡住的话，
   条子每 250ms 会被「拽回」正在播放的位置一次 —— 用户感觉就是「拖不动 / 一卡一卡」。
   seekHold/seekHoldUntil：松手后乐观显示目标位置，等内核跟上来；这期间若有
   「旧位置」的事件在路上（延迟约一帧），不让它把条子拽回去。 */
let seeking = false;
let seekHold = 0;
let seekHoldUntil = 0;

/* 现在哪条进度条是看得见的：'player' / 'mini' / null（都看不见） */
function progressTarget() {
  if ($('#player').classList.contains('is-open')) return 'player';
  const mini = $('#mini');
  if (mini.hidden || mini.classList.contains('is-stowed')) return null;
  return 'mini';
}

function updateProgressUI() {
  /* 手指在条上：位置由 paint() 接管（见下面「进度条拖拽」） */
  if (seeking) return;
  /* 刚松手 seek 完：内核可能还有一两个「旧位置」事件在路上，
     别让它们把刚画好的条子拽回去（表现就是松手后又弹一下） */
  if (seekHold) {
    /* 单位是**秒**。这里原来写的是 `> 1500` —— 等于 25 分钟，永远不成立，
       于是松手后第一个「旧位置」进度事件就把条子拽回播放位置，等 seek 生效
       再跳过去，真机看到的就是「崩回去又崩回来」（2026-11-20 用户报的问题）。
       现在：位置进到目标 ±1.2 秒才算内核真的跟上了；没跟上就一直画目标位置，
       最多等 6 秒（seek 失败时兜底，不让条子永远停在假位置）。 */
    if (Math.abs(state.position - seekHold) <= 1.2) {
      seekHold = 0;
    } else if (performance.now() < seekHoldUntil) {
      state.position = seekHold;
    } else {
      seekHold = 0;
    }
  }
  const d = state.duration || 1;
  const pct = Math.min(100, (state.position / d) * 100);
  const cur = fmt(state.position);
  const where = progressTarget();
  /* 把「画哪一条」也算进签名里：播放页开关、迷你条收起/展开之后，
     下一次进度事件会自动重画那条新露出来的，不用在每个入口手动补一次 */
  const sig = pct.toFixed(2) + '\u0001' + cur + '\u0001' + (where || '-');
  if (sig === progressSig) return;
  progressSig = sig;
  if (where === 'player') {
    $('#pFill').style.transform = 'scaleX(' + (pct / 100) + ')';
    $('#pKnob').style.left = pct + '%';
    $('#pCur').textContent = cur;
  } else if (where === 'mini') {
    $('#miniFill').style.transform = 'scaleX(' + (pct / 100) + ')';
  }
}

function setPlayIcon(playing) {
  $('#pPlayIcon').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('#miniIconUse').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('#pArt').classList.toggle('is-beat', playing);
}

function updateLike() {
  $('#pLike').classList.toggle('is-on', state.liked);
  $('#pLikeIcon').setAttribute('href', state.liked ? '#i-heart-fill' : '#i-heart');
}

function updateModeUI() {
  const shuffle = state.mode === 1;
  $('#pShuffle').classList.toggle('is-on', shuffle);
  $('#pRepeat').classList.toggle('is-on', state.mode !== 0);
  $('#pRepeatIcon').setAttribute('href', state.mode === 2 ? '#i-repeat1' : '#i-repeat');
}

function syncMini() {
  const el = $('#mini');
  if (!state.miniActive) {
    el.hidden = true;
    el.classList.remove('is-stowed');
    updateProgressUI();
    notifyNav();
    return;
  }
  el.hidden = false;
  const cur = currentScreen();
  const id = cur ? cur.id : '';
  /* 设置类子页把迷你条收起来（这些页面上没有播放条的位置）。
     「我的」不算 —— 设置已经并进去了，它是个正常页签。 */
  const sys = id.indexOf('scr-set-') === 0;
  el.classList.toggle('is-stowed', sys);
  /* 收起/展开会换掉「哪条进度条看得见」，补一次重画 */
  updateProgressUI();
  notifyNav();
}

/* ───────────────────────── 歌词 ───────────────────────── */

let lyricLines = [];
let lyricFor = null;
/* 歌词行渲染完就不变了，节点缓存下来；切换高亮只碰「上一行」和「这一行」，
   不必每秒 4 次地把几十行全 toggle 一遍 */
let lyricNodes = [];
let lyricActive = -1;

async function loadLyrics() {
  if (!state.current) return;
  const key = state.current.key;
  if (lyricFor === key) return;
  lyricFor = key;
  lyricLines = [];
  lyricNodes = [];
  lyricActive = -1;
  $('#lyrics').innerHTML = '<div class="lyric">正在加载歌词…</div>';
  try {
    const lines = await Tide.lyrics();
    if (lyricFor !== key) return;
    lyricLines = lines || [];
    /* 没有歌词时别停在「空白歌词页」：用户点封面进去只看到一屏黑。
       把封面放回来，并提示一声。 */
    if (!lyricLines.length && $('#lyrics').classList.contains('is-on')) {
      toggleLyrics(false);
      toast('这首歌暂无歌词');
    }
    $('#lyrics').innerHTML = lyricLines.length
      ? lyricLines.map((l, i) =>
          '<div class="lyric" data-line="' + i + '">' + esc(l.x) +
            (l.tr ? '<span class="lyric__tr">' + esc(l.tr) + '</span>' : '') +
          '</div>').join('')
      : '<div class="lyric">这首歌没有歌词</div>';
    lyricNodes = $$('.lyric', $('#lyrics'));
    $('#lyrics').dataset.active = '';
    syncLyric();
  } catch (e) {
    log('loadLyrics failed', e);
    $('#lyrics').innerHTML = '<div class="lyric">歌词加载失败</div>';
    lyricNodes = [];
  }
}

function syncLyric() {
  const box = $('#lyrics');
  if (!box.classList.contains('is-on') || !lyricLines.length) return;
  let active = 0;
  for (let i = 0; i < lyricLines.length; i++) {
    if (state.position >= lyricLines[i].t) active = i; else break;
  }
  if (active === lyricActive) return;
  const prevEl = lyricNodes[lyricActive];
  if (prevEl) prevEl.classList.remove('is-on');
  const el = lyricNodes[active];
  if (el) el.classList.add('is-on');
  lyricActive = active;
  box.dataset.active = active;
  if (el) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
}

function toggleLyrics(force) {
  const box = $('#lyrics');
  const on = force != null ? force : !box.classList.contains('is-on');
  box.classList.toggle('is-on', on);
  $('#pArt').classList.toggle('is-hidden', on);
  $('#playerStage').classList.toggle('is-lyrics', on);
  $('#playerHint').textContent = on ? '轻点歌词返回封面' : '轻点封面查看歌词';
  if (on) {
    /* 关着的时候位置一直在走，重新打开要按当前位置重算一遍 */
    lyricNodes.forEach(n => n.classList.remove('is-on'));
    lyricActive = -1;
    box.dataset.active = '';
    syncLyric();
  }
}

/* ───────────────────────── 播放页 ───────────────────────── */

function openPlayer() {
  const p = $('#player');
  p.classList.add('is-open');
  p.setAttribute('aria-hidden', 'false');
  $('#pArt').classList.remove('is-hidden');
  /* 刚换了一条进度条（迷你 → 播放页），立刻把它画上，别等下一次进度事件 */
  updateProgressUI();
  notifyNav();
}

function closePlayer() {
  const p = $('#player');
  p.classList.remove('is-open');
  p.setAttribute('aria-hidden', 'true');
  toggleLyrics(false);
  closeSheet();
  updateProgressUI();
  notifyNav();
}

/* ───────────────────────── 队列抽屉 ───────────────────────── */

async function renderQueue() {
  const box = $('#listQueue');
  try {
    const songs = await Tide.queue();
    $('#queueCount').textContent = songs.length;
    if (!songs.length) {
      box.innerHTML = '<p class="s-note">播放队列是空的。</p>';
      renderedLists.delete(box);
      markKey = undefined;
      return;
    }
    box.innerHTML = songs.map((s, i) => songRow(s, i, '')).join('');
    // 队列的点击走 queuePlay，需要单独标记
    $$('.song', box).forEach((el, i) => {
      el.dataset.token = '__queue__';
      el.dataset.idx = i;
    });
    state.lists['__queue__'] = songs;
    noteList(box, '__queue__');
    markCurrent();
  } catch (e) {
    log('renderQueue failed', e);
    box.innerHTML = '<p class="s-note">队列读取失败</p>';
  }
}

/* ───────────────────────── 我的下载 ─────────────────────────
   v1.9.25 起下载真的落盘（音乐/TideMusic/），这里列出文件、支持删除。
   原来的入口点开的是原生 stub 页（整页一个字），用户点进来啥都没有。 */

function dlSize(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

async function renderDlList() {
  const box = $('#listDl');
  try {
    const files = await Tide.downloads();
    $('#dlCount').textContent = files.length;
    if (!files.length) {
      box.innerHTML = '<p class="s-note">还没有下载的歌曲。播放页底部的下载按钮就能下。</p>';
      return;
    }
    box.innerHTML = files.map((f, i) => {
      const nm = f.name.replace(/\.[a-z0-9]+$/i, '');
      return '<div class="song dl-row" data-dl-i="' + i + '">' +
        '<span class="song__idx"><svg class="icon icon--xs"><use href="#i-download"/></svg></span>' +
        '<span class="song__main"><span class="song__title">' + esc(nm) + '</span>' +
        '<span class="song__meta">' + esc(dlSize(f.size)) + '</span></span>' +
        '<button class="iconbtn iconbtn--sm dl-row__del" aria-label="删除 ' + esc(f.name) + '">' +
        '<svg class="icon icon--xs"><use href="#i-trash"/></svg></button>' +
        '</div>';
    }).join('');
  } catch (e) {
    log('renderDlList failed', e);
    box.innerHTML = '<p class="s-note">读取失败，稍后再试</p>';
  }
}

/* 删除按钮走事件委托（列表每次重画） */
$('#listDl').addEventListener('click', async e => {
  const del = e.target.closest('.dl-row__del');
  if (!del) return;
  const row = del.closest('[data-dl-i]');
  const i = Number(row && row.dataset.dlI);
  if (!Number.isFinite(i)) return;
  const files = await Tide.downloads().catch(() => []);
  const f = files[i];
  if (!f) return;
  haptic(); sfx('tap');
  try {
    const r = await Tide.downloadDelete(f.name);
    if (r && r.ok === false) { toast(r.msg || '删除失败'); return; }
    sfx('success');
    toast('已删除：' + f.name);
    renderDlList();
  } catch (err) {
    log('downloadDelete failed', err);
    toast(userMsg(err, '删除失败'));
  }
});

/* 弹层同一时刻只开一个（队列 / 音效），所以谁开着记在这里，
   返回键和 navState 都问它 —— 原来写死问 #queueSheet，多一个弹层就会漏。 */
let currentSheet = null;

function openSheet(id) {
  const s = $('#' + (id || 'queueSheet'));
  if (!s || s === currentSheet) return;
  /* 弹层之间互相切换（更多 → 音效）时不走动画，直接把上一个摘掉 */
  if (currentSheet) {
    currentSheet.classList.remove('is-open');
    currentSheet.setAttribute('aria-hidden', 'true');
  }
  currentSheet = s;
  s.classList.add('is-open');
  s.setAttribute('aria-hidden', 'false');
  const m = $('#sheetMask');
  m.hidden = false;
  void m.offsetWidth;
  m.classList.add('is-on');
  notifyNav();
}

function closeSheet() {
  const s = currentSheet;
  if (!s || !s.classList.contains('is-open')) return;
  currentSheet = null;
  s.classList.remove('is-open');
  s.setAttribute('aria-hidden', 'true');
  const m = $('#sheetMask');
  m.classList.remove('is-on');
  setTimeout(() => { if (!m.classList.contains('is-on')) m.hidden = true; }, 320);
  notifyNav();
}

/* 音效弹层的两个页签。默认开在「播放音效」—— 用户点播放页那个音效按钮，
   想的多半是改声音，而不是调提示音。 */
function showSfxTab(which) {
  const pane = which === 'ui' ? 'ui' : 'play';
  $$('[data-sfx-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.sfxTab === pane));
  $$('[data-sfx-pane]').forEach(p => { p.hidden = p.dataset.sfxPane !== pane; });
  if (pane === 'play') void loadPlayFx();
  else applySfx();
}

/* ───────────────────── 平台选择器（搜索 / 榜单 / 歌单） ───────────────────── */

function platformName(list, id) {
  const hit = (list || []).filter(s => s.id === id)[0];
  return hit ? hit.name : '';
}

/* 画一排 chip。label 同时写进容器的 aria-label，设备验收脚本能直接读到当前选的是谁。 */
function paintSourceChips(chipsId, barId, list, active, attr, label) {
  const box = $('#' + chipsId);
  if (!box) return;
  const items = list || [];
  box.innerHTML = items.map(s =>
    '<button class="chip' + (s.id === active ? ' is-on' : '') + '" data-' + attr + '="' + esc(s.id) + '"' +
      ' aria-pressed="' + (s.id === active ? 'true' : 'false') + '">' + esc(s.name) + '</button>'
  ).join('');
  const bar = $('#' + barId);
  if (bar) {
    const now = platformName(items, active) || active;
    bar.setAttribute('aria-label', label + '：' + now);
    /* 标签写出当前选择：chip 行横滑后当前项可能不在视野里，至少标题能看见 */
    const labelEl = bar.querySelector('.searchsrc__label');
    if (labelEl) labelEl.textContent = label + ' · ' + now;
  }
}

function pickSourceId(list, wanted, fallback) {
  const ids = (list || []).map(s => s.id);
  if (ids.indexOf(wanted) > -1) return wanted;
  if (ids.indexOf(fallback) > -1) return fallback;
  return ids[0] || fallback;
}

async function loadSearchSources() {
  try {
    const r = await Tide.searchSources();
    if (r && Array.isArray(r.sources) && r.sources.length) {
      state.searchSources = r.sources;
      state.searchSource = pickSourceId(r.sources, r.active, state.searchSource);
    }
  } catch (e) {
    log('searchSources failed', e);
  }
  paintSourceChips('searchSrcChips', 'searchSrcBar', state.searchSources, state.searchSource, 'search-src', '搜索源');
}

async function setSearchSource(id) {
  if (!state.searchSources.some(s => s.id === id) || state.searchSource === id) return;
  state.searchSource = id;
  store.set('searchSrc', id);
  paintSourceChips('searchSrcChips', 'searchSrcBar', state.searchSources, id, 'search-src', '搜索源');
  /* ⚠️ 这里**不要**把焦点还给输入框。v1.9.23 为了让验收脚本点完 chip 直接打字，
     加过一次 input.focus()，结果真机上「搜完再点平台」每次都会弹出输入法 ——
     用户明确说很难受。切源只是换结果来源，不是要继续输入；要打字的用户自己点输入框。 */
  try { await Tide.setSearchSource(id); } catch (e) { log('setSearchSource failed', e); }
  if (searchQuery) {
    runSearch(searchQuery);
  } else {
    const input = $('#searchInput');
    if (input && input.value.trim() && !$('#searchTipList').hidden) showSearchTips(input.value);
  }
}

async function loadChartSources() {
  let changed = false;
  try {
    const r = await Tide.chartSources();
    if (r && Array.isArray(r.sources) && r.sources.length) {
      state.chartSources = r.sources;
      const next = pickSourceId(r.sources, r.active, state.chartSource);
      if (next !== state.chartSource) { state.chartSource = next; changed = true; }
    }
  } catch (e) {
    log('chartSources failed', e);
  }
  paintSourceChips('chartSrcChips', 'chartSrcBar', state.chartSources, state.chartSource, 'chart-src', '榜单平台');
  if (changed) {
    tabLoaded.charts = false;
    if (state.tab === 'charts') void renderCharts();
  }
}

async function setChartSource(id) {
  if (!state.chartSources.some(s => s.id === id) || state.chartSource === id) return;
  state.chartSource = id;
  store.set('chartSrc', id);
  paintSourceChips('chartSrcChips', 'chartSrcBar', state.chartSources, id, 'chart-src', '榜单平台');
  try { await Tide.setChartSource(id); } catch (e) { log('setChartSource failed', e); }
  tabLoaded.charts = false;
  state.charts = [];
  if (state.tab === 'charts') void renderCharts();
}

async function loadSquareSources() {
  let changed = false;
  try {
    const r = await Tide.squareSources();
    if (r && Array.isArray(r.sources) && r.sources.length) {
      state.squareSources = r.sources;
      const next = pickSourceId(r.sources, r.active, state.squareSource);
      if (next !== state.squareSource) { state.squareSource = next; changed = true; }
    }
  } catch (e) {
    log('squareSources failed', e);
  }
  paintSourceChips('squareSrcChips', 'squareSrcBar', state.squareSources, state.squareSource, 'square-src', '歌单平台');
  if (changed) {
    /* 只重置页码；真正的第一页由 pushSub 的 .then 拉（这里再拉会和它撞成两条请求） */
    squarePage = 0;
  }
}

async function setSquareSource(id) {
  if (!state.squareSources.some(s => s.id === id) || state.squareSource === id) return;
  state.squareSource = id;
  store.set('squareSrc', id);
  paintSourceChips('squareSrcChips', 'squareSrcBar', state.squareSources, id, 'square-src', '歌单平台');
  try { await Tide.setSquareSource(id); } catch (e) { log('setSquareSource failed', e); }
  squarePage = 0;
  if ($('#scr-square').classList.contains('is-active')) void loadSquare(1);
}

/* ───────────────────────── 搜索 ───────────────────────── */

let searchSeq = 0;

/* 搜索页的两个页签（歌曲 / 歌单）。歌单走内核跨平台聚合，是**另一条请求**，
   所以只有在真的需要时才发 —— 大部分人搜的是歌，不该为它多等一次。
   两个页签各记一份结果和标题，来回切时不用重算。 */
let searchTab = 'song';
let searchQuery = '';        // 这一次搜的词（用来判断回包过不过期）
let searchSongFor = '';      // 已经取过歌曲的那个词
let searchListFor = '';      // 已经取过歌单的那个词
let searchSongTitle = '';
let searchListTitle = '';
let searchPage = 1;
let searchListPage = 1;
let searchHasMore = false;
let searchListHasMore = false;
let searchSongEmpty = false;
let searchListEmpty = false;
let searchMoreBusy = false;

function setSearchTab(tab) {
  searchTab = tab === 'list' ? 'list' : 'song';
  const lists = searchTab === 'list';
  $$('[data-search-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.searchTab === searchTab));
  $('#listResults').hidden = lists;
  $('#listResultLists').hidden = !lists;
  if (searchQuery) {
    $('#resultTitle').textContent = (lists ? searchListTitle : searchSongTitle) || '搜索结果';
  }
  /* 切到还没取过的那一侧 → 现在去取。
     原来只补歌单：在「歌单」页签下搜新词，再切回「歌曲」是空白。 */
  if (lists && searchQuery && searchListFor !== searchQuery) void loadSearchLists(searchQuery, 1);
  if (!lists && searchQuery && searchSongFor !== searchQuery) void loadSearchSongs(searchQuery, 1);
  updateSearchFoot();
}

function updateSearchFoot() {
  const foot = $('#searchFoot');
  if (!foot) return;
  if (!searchQuery) { foot.hidden = true; return; }
  const lists = searchTab === 'list';
  const loaded = lists ? searchListFor === searchQuery : searchSongFor === searchQuery;
  const empty = lists ? searchListEmpty : searchSongEmpty;
  if (!loaded || empty) { foot.hidden = true; return; }
  foot.hidden = false;
  const more = lists ? searchListHasMore : searchHasMore;
  if (more) foot.innerHTML = '<button class="foot__more" id="searchMore">加载更多</button>';
  else foot.textContent = '— 已经到底啦 —';
}

/* 歌曲结果。第一页替换，后面几页由内核回「累积后的完整列表」，
   所以这里可以整段重画；滚动位置保留，用户不会被弹回顶部。 */
async function loadSearchSongs(q, page) {
  const first = page === 1;
  const seq = ++searchSeq;
  if (first) {
    searchPage = 1;
    searchHasMore = false;
    searchSongEmpty = false;
    searchSongFor = '';
    $('#resultTitle').textContent = '搜索中…';
  }
  try {
    const r = await Tide.search(q, { source: state.searchSource, page });
    if (seq !== searchSeq || q !== searchQuery) return;
    searchSongFor = q;
    searchPage = r.page || page;
    searchHasMore = !!r.hasMore;
    searchSongEmpty = !r.songs.length;
    searchSongTitle = r.total
      ? '找到 ' + r.total + ' 首'
      : (r.songs.length ? '找到 ' + r.songs.length + ' 首' : '没有找到相关歌曲');
    if (searchTab === 'song') $('#resultTitle').textContent = searchSongTitle;
    const sc = $('#scr-search .scroll');
    const top = sc ? sc.scrollTop : 0;
    if (!r.songs.length) {
      $('#listResults').innerHTML = '<p class="s-note">换个关键词试试。</p>';
      renderedLists.delete($('#listResults'));
    } else {
      renderList($('#listResults'), r.songs, r.token);
      if (sc && !first) sc.scrollTop = top;
    }
    updateSearchFoot();
  } catch (e) {
    if (seq !== searchSeq || q !== searchQuery) return;
    log('search failed', e);
    searchSongFor = q;
    searchHasMore = false;
    searchSongEmpty = true;
    searchSongTitle = '搜索失败';
    if (searchTab === 'song') $('#resultTitle').textContent = searchSongTitle;
    $('#listResults').innerHTML = '<p class="s-note">' + esc(e.message || e) + '</p>';
    renderedLists.delete($('#listResults'));
    updateSearchFoot();
  }
}

/* 歌单结果。形状与「歌单广场」一致，所以卡片直接复用 playlistItem，
   点进去也是同一个歌单详情页（收藏、播放、排序都在那儿）。 */
async function loadSearchLists(q, page) {
  const box = $('#listResultLists');
  if (!box) return;
  const first = page === 1;
  if (first) {
    searchListFor = '';
    searchListPage = 1;
    searchListHasMore = false;
    searchListEmpty = false;
    box.innerHTML = '<p class="s-note">正在找歌单…</p>';
    $('#resultTitle').textContent = '搜索中…';
  }
  try {
    const r = await Tide.searchPlaylists(q, { source: state.searchSource, page });
    if (q !== searchQuery) return;
    searchListFor = q;
    searchListPage = r.page || page;
    searchListHasMore = !!r.hasMore;
    const list = r.playlists || [];
    searchListEmpty = !list.length;
    searchListTitle = list.length
      ? '找到 ' + (r.total || list.length) + ' 张歌单'
      : '没有找到相关歌单';
    if (searchTab === 'list') $('#resultTitle').textContent = searchListTitle;
    box.innerHTML = list.length
      ? list.map(playlistItem).join('')
      : '<p class="s-note">换个关键词试试。</p>';
    updateSearchFoot();
  } catch (e) {
    if (q !== searchQuery) return;
    log('searchPlaylists failed', e);
    searchListFor = '';
    searchListHasMore = false;
    searchListEmpty = true;
    searchListTitle = '歌单搜索失败';
    if (searchTab === 'list') $('#resultTitle').textContent = searchListTitle;
    box.innerHTML = '<p class="s-note">' + esc(e.message || e) + '</p>';
    updateSearchFoot();
  }
}

async function loadMoreSearch() {
  if (searchMoreBusy || !searchQuery) return;
  const lists = searchTab === 'list';
  if (lists ? !searchListHasMore : !searchHasMore) return;
  searchMoreBusy = true;
  const foot = $('#searchFoot');
  if (foot) foot.textContent = '正在加载…';
  try {
    if (lists) await loadSearchLists(searchQuery, searchListPage + 1);
    else await loadSearchSongs(searchQuery, searchPage + 1);
  } finally {
    searchMoreBusy = false;
  }
}

async function runSearch(q) {
  q = (q || '').trim();
  const input = $('#searchInput');
  if (input.value !== q) input.value = q;
  $('#searchClear').hidden = !q;
  /* 真开始搜了，联想列表就该让位给结果 */
  hideSearchTips();

  if (!q) {
    searchQuery = '';
    searchSongFor = '';
    searchListFor = '';
    searchSongEmpty = false;
    searchListEmpty = false;
    searchHasMore = false;
    searchListHasMore = false;
    /* 还没搜就没结果，底部那句「已经到底啦」不该挂在这里 */
    $('#searchFoot').hidden = true;
    $('#searchHistorySec').hidden = false;
    $('#searchHotSec').hidden = false;
    $('#searchResultsSec').hidden = true;
    renderSearchStatic();
    return;
  }

  searchQuery = q;
  searchSongFor = '';
  searchListFor = '';
  searchSongTitle = '';
  searchListTitle = '';
  searchPage = 1;
  searchListPage = 1;
  searchHasMore = false;
  searchListHasMore = false;
  searchSongEmpty = false;
  searchListEmpty = false;
  $('#searchFoot').hidden = true;
  $('#searchHistorySec').hidden = true;
  $('#searchHotSec').hidden = true;
  $('#searchResultsSec').hidden = false;
  /* 换词了，两个页签都清空，免得看到上一个词的残留 */
  $('#listResults').innerHTML = '';
  $('#listResultLists').innerHTML = '';

  /* 停在「歌单」页签时只取歌单；歌曲等切回去时再取（setSearchTab 里会补） */
  if (searchTab === 'list') {
    $('#resultTitle').textContent = '搜索中…';
    void loadSearchLists(q, 1);
    return;
  }

  $('#resultTitle').textContent = '搜索中…';
  void loadSearchSongs(q, 1);
}

async function commitSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  try { await Tide.addHistory(q); } catch (e) {}
  runSearch(q);
}

/* ───────────────────────── 搜索联想 ───────────────────────── */

/* 边打字边给的补全词，两个来源合起来：
     · **在线** —— 内核各平台自己的 tipSearch（酷我那个打的是 tips.kuwo.cn）。
       只有酷我在 SDK 里真挂了 tipSearch，别家返回空，所以不能只靠它。
     · **本地** —— 搜索历史 + 热搜里含当前输入的那些。0 延迟、离线也有，而且
       自己搜过的词命中率往往比在线补全还高。

   在线那条 debounce 之后才发，并用序号丢掉过期回包 —— 打字快的时候先发的可能后到，
   不丢的话会把新词的结果盖回去。本地候选则立刻画一版，不让用户对着空列表等网络。 */

let tipSeq = 0;
let tipTimer = null;
let tipWords = [];       // 当前这一屏的候选词（提交后不再显示）

/* 本地候选：历史在前（自己搜过的更相关），热搜在后 */
function localTips(q) {
  const lower = q.toLowerCase();
  const hit = [];
  const seen = new Set();
  const push = w => {
    const s = String(w == null ? '' : w).trim();
    if (!s || seen.has(s) || s.toLowerCase().indexOf(lower) === -1) return;
    seen.add(s);
    hit.push(s);
  };
  state.searchHistory.forEach(push);
  state.searchHot.forEach(push);
  return hit;
}

/* 把用户已经打出来的那段标出来；不是子串就原样返回，别乱标 */
function markTip(word, q) {
  const i = word.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(word);
  return esc(word.slice(0, i)) + '<b>' + esc(word.slice(i, i + q.length)) + '</b>' +
    esc(word.slice(i + q.length));
}

function renderTips(q, online) {
  const box = $('#searchTipList');
  if (!box) return;
  const words = [];
  const seen = new Set();
  (online || []).concat(localTips(q)).forEach(w => {
    const s = String(w == null ? '' : w).trim();
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    words.push(s);
  });
  tipWords = words;
  /* 第一行永远是「搜索原文」：联想词都不合适时，用户打的字本身也得能直接搜 */
  const rows = ['<button class="tip tip--go" data-tip-go="1">' + icon('search') +
    '<span class="tip__text">搜索「' + esc(q) + '」</span></button>'];
  words.forEach(w => {
    rows.push('<button class="tip" data-tip="' + esc(w) + '">' + icon('search') +
      '<span class="tip__text">' + markTip(w, q) + '</span></button>');
  });
  box.innerHTML = rows.join('');
  box.hidden = false;
}

function hideSearchTips() {
  const box = $('#searchTipList');
  if (!box || box.hidden) return;
  box.hidden = true;
  box.innerHTML = '';
  tipWords = [];
}

/* 打字时调：立刻画本地候选，再补在线候选 */
function showSearchTips(q) {
  q = String(q || '').trim();
  clearTimeout(tipTimer);
  if (!q) { hideSearchTips(); return; }
  renderTips(q, []);
  const seq = ++tipSeq;
  tipTimer = setTimeout(() => {
    Tide.tips(q, state.searchSource).then(list => {
      /* 回包过期（又打字了）或输入框已经变了，就丢掉 */
      if (seq !== tipSeq) return;
      if (($('#searchInput').value || '').trim() !== q) return;
      renderTips(q, list);
    }).catch(err => log('tips failed:', (err && err.message) || String(err)));
  }, 250);
}

/* 联想词上屏之后，历史 / 热搜 / 结果都要收起来，只留候选。
   「已经到底啦」那行也一起收 —— 现在列表里一条歌都没有，它还挂着很奇怪。 */
function showTipsOnly() {
  $('#searchHistorySec').hidden = true;
  $('#searchHotSec').hidden = true;
  $('#searchResultsSec').hidden = true;
  $('#searchFoot').hidden = true;
}

/* ───────────────────────── 主题与外观 ───────────────────────── */

/* 把当前主题的底色同步出去，三处都要用：
   1. 写进 <html> 的行内样式 —— 这是 WebView 的首帧底色；而且 html 一旦有了背景，
      body 的背景就不再往画布上传，页面滚到头时露出来的也是它。
   2. 存进 localStorage，下次启动由 <head> 里那段引导脚本在样式表之前用上。
   3. 告诉原生，让启动窗口与 RN 根视图用同一个色 —— 否则浅色主题的用户
      会先看到一段深色再翻过去（反过来也一样）。 */
/* --bg 只由「解析后的深浅色 + 皮肤」决定（12 种组合各自写死了一个值），拿这两个当签名。
   注意用的是 dataset.theme（dark/light）而不是 state.theme：「跟随系统」时模式一直是
   system，系统一换深浅色，--bg 就变了，拿模式当签名会把这次变化吞掉。
   启动时 applyTheme 和 applySkin 各调一次，签名一样就整个跳过 —— 否则那一次白做
   两回 getComputedStyle（每次都是一次同步样式刷新）、白写一遍 localStorage、
   白发一条桥消息。 */
let bootBgSig = null;

function syncBootBg() {
  const sig = document.documentElement.dataset.theme + '\u0001' + state.skin;
  if (sig === bootBgSig) return;
  bootBgSig = sig;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  let hex = '';
  let m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) hex = '#' + m[1].toUpperCase();
  else if ((m = raw.match(/^#([0-9a-f]{3})$/i))) {
    hex = '#' + m[1].split('').map(c => c + c).join('').toUpperCase();
  } else {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      hex = '#' + rgb.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  }
  if (!hex) return;
  document.documentElement.style.background = hex;
  store.set('bootBg', hex);
  /* 模式一起给原生：「跟随系统」时它不能信存下来的颜色（系统可能已经变了） */
  if (Tide.setBootBg) Tide.setBootBg(hex, state.theme);
}

function applyTheme(mode) {
  state.theme = mode;
  store.set('theme', mode);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
  $$('[data-theme-set]').forEach(b => b.classList.toggle('is-on', b.dataset.themeSet === mode));
  /* 换主题也会换掉 --c-* 这套封面色：缓存要清，已经画上去的封面要重画。
     以前只在换皮肤时重画，深浅色一切换，播放页背景和歌单头图会停在旧色上
     （封面缓存让这个陈旧更明显，所以顺手一起修了）。 */
  clearCoverCache();
  refreshCovers();
  syncNativeTheme();
  syncBootBg();
  updateThemeSummary();
}

/* 原生子页面（评论 / 最近播放 / 本地音乐 / 洛雪原生设置 / 音源…）不吃界面这套 CSS，
   它们用的是内核主题 + 鸿蒙 token。所以这里把「深浅 + 算好的那几个颜色」推过去：

     · 只推深浅：深色界面里点「评论」会蹦出一张纯白页；
     · 不推颜色：原生设置页会是一套固定的绿，而界面可能是薄荷/星紫/琥珀……
       用户反馈「洛雪原生设置也没美化，ui 和软件 ui 对齐审美一致，不然很割裂」
       指的就是这个。

   推的是**最终色值**（计算样式），不是皮肤名 —— 界面换皮肤 / 改主题色 / 切深浅，
   推过去的就是新的一组，原生那边不用知道「墨黑」「深海」是什么。
   深浅直接看 data-theme（applyTheme 已经写好），这样换皮肤 / 换主题色时
   不用再把 dark 传一圈。整组色值按签名去重，启动那三次调用只会真发一次。 */
let nativeThemeSig = null;

function syncNativeTheme() {
  if (typeof Tide === 'undefined' || !Tide.theme) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback || '';
  const p = {
    dark: dark,
    accent: state.accent || v('--accent', '#3ECFB2'),
    bg: v('--bg', dark ? '#0A0B0F' : '#F4F5F8'),
    /* 卡片要实底：--card 在深色下是 4.5% 白，铺到原生页面等于没有卡片 */
    card: v('--card-solid', v('--card')),
    text: v('--text', dark ? '#F1F3F8' : '#12141C'),
    textSub: v('--text-2'),
    textWeak: v('--text-3'),
    divider: v('--hairline'),
  };
  const sig = JSON.stringify(p);
  if (sig === nativeThemeSig) return;
  nativeThemeSig = sig;
  Tide.theme(p).catch(() => {});
}

function applyAccent(hex) {
  state.accent = hex;
  store.set('accent', hex);
  document.documentElement.style.setProperty('--accent', hex);
  $$('.swatch').forEach(s => s.classList.toggle('is-on', s.dataset.accent === hex));
  updateThemeSummary();
}

function applySkin(name, keepAccent) {
  if (!SKINS[name]) name = 'ink';
  state.skin = name;
  store.set('skin', name);
  document.documentElement.dataset.skin = name;
  $$('.skin').forEach(b => b.classList.toggle('is-on', b.dataset.skinSet === name));
  if (!keepAccent) applyAccent(SKINS[name].accent);
  clearCoverCache();
  refreshCovers();
  /* keepAccent 时 applyAccent 不会被调到，所以这里也推一次（同色会被签名挡掉） */
  syncNativeTheme();
  syncBootBg();
  updateThemeSummary();
}

function updateThemeSummary() {
  const el = $('#themeSummary');
  if (!el) return;
  const skin = SKINS[state.skin] || SKINS.ink;
  el.textContent = MODE_NAMES[state.theme] + ' · ' + skin.name + ' · ' +
    (ACCENT_NAMES[state.accent] || '自定义');
}

/* ───────────────── 设置页里真接上状态的开关（主题页「播放页」分组） ───────────────── */

const UI_SWITCH_KEYS = ['playerBlur', 'lyricTr', 'uiMotion', 'desktopLyric'];

function uiSwitchOn(key) {
  /* 缺省值：虚化/翻译/动效默认开（跟界面现状一致），桌面歌词默认关 */
  return store.get('ui:' + key, key === 'desktopLyric' ? 0 : 1) === 1;
}

function applyUiSwitchDom(key, on) {
  if (key === 'playerBlur') {
    const bg = $('#playerBg');
    if (bg) bg.classList.toggle('is-noblur', !on);
  } else if (key === 'lyricTr') {
    document.documentElement.classList.toggle('no-tr', !on);
  } else if (key === 'uiMotion') {
    document.documentElement.classList.toggle('no-motion', !on);
  }
}

function applyUiSwitch(key, on) {
  if (UI_SWITCH_KEYS.indexOf(key) === -1) return;
  store.set('ui:' + key, on ? 1 : 0);
  applyUiSwitchDom(key, on);
  if (key === 'desktopLyric') {
    /* 桌面歌词是原生的悬浮窗：权限没给时原生会去开系统设置，界面只管把开关按回原位 */
    void Tide.setDesktopLyric(on).then(r => {
      if (r && r.ok === false) {
        toast(r.msg || '打开失败');
        store.set('ui:desktopLyric', 0);
        const sw = $('[data-ui-switch="desktopLyric"]');
        if (sw) { sw.classList.remove('is-on'); sw.setAttribute('aria-checked', 'false'); }
      } else {
        toast(on ? '桌面歌词已开启' : '桌面歌词已关闭');
      }
    }).catch(err => {
      log('setDesktopLyric failed', err);
      toast('桌面歌词设置失败');
    });
  }
}

/* 启动时把存过的开关状态画回去（不碰桥；桌面歌词原生态在开关时才下发） */
function applyUiPrefs() {
  UI_SWITCH_KEYS.forEach(key => {
    const on = uiSwitchOn(key);
    const sw = $('[data-ui-switch="' + key + '"]');
    if (sw) { sw.classList.toggle('is-on', on); sw.setAttribute('aria-checked', String(on)); }
    applyUiSwitchDom(key, on);
  });
}

/* ───────────────────────── 事件绑定 ───────────────────────── */

function bind() {
  /* 音频上下文必须在用户手势里解锁，安卓 WebView 尤其严格。
     放在 pointerdown 而不是 click：指针按下就先解开，紧跟其后的 click
     才来得及出声（否则第一次点击是哑的）。 */
  const unlockSfx = () => { try { if (window.Sfx) Sfx.unlock(); } catch (e) {} };
  document.addEventListener('pointerdown', unlockSfx, { once: true, capture: true });
  document.addEventListener('touchstart', unlockSfx, { once: true, capture: true });

  document.addEventListener('click', function (e) {
    const t = e.target;

    const song = t.closest('[data-token]');
    if (song && song.dataset.token !== undefined && song.dataset.idx !== undefined) {
      haptic();
      sfx('play');
      const token = song.dataset.token;
      const idx = Number(song.dataset.idx);
      if (token === '__queue__') Tide.queuePlay(idx).catch(err => log(err));
      else Tide.play(token, idx).catch(err => { log(err); sfx('error'); toast(userMsg(err, '播放失败')); });
      return;
    }

    const pl = t.closest('[data-playlist]');
    if (pl) {
      /* 榜单页首卡/网格在数据回来前是空的 data-playlist=""，点了别去查空 id */
      if (!pl.dataset.playlist) { sfx('tap'); toast('还没加载完，稍等一下'); return; }
      haptic(); sfx('nav'); openPlaylist(pl.dataset.playlist); return;
    }

    /* 主题页的真开关：整行都可点（移动端只有 28px 的开关太小，容易点空）。
       行点击转发给开关按钮；开关自己发的那次 click 带着开关本体当 target，
       在这里要放行，不然就递归了。 */
    const uiRow = t.closest('[data-ui-row]');
    if (uiRow && !t.closest('.switch')) {
      const sw = $('[data-ui-switch="' + uiRow.dataset.uiRow + '"]');
      if (sw) sw.click();
      return;
    }

    /* 音源页：点一个源就切过去 */
    const srcPick = t.closest('[data-pick-src]');
    if (srcPick) { haptic(); sfx('tab'); void pickSource(srcPick.dataset.pickSrc); return; }

    /* 添加音源页：删除做成两段式（先问一句再删），免得手滑把正在用的源删了 */
    const delAsk = t.closest('[data-del-ask]');
    if (delAsk) { sfx('tap'); srcPendingDel = delAsk.dataset.delAsk; renderSourceAdd(srcState); return; }
    const delCancel = t.closest('[data-del-cancel]');
    if (delCancel) { sfx('nav'); srcPendingDel = null; renderSourceAdd(srcState); return; }
    const delGo = t.closest('[data-del-go]');
    if (delGo) { haptic(); void removeSource(delGo.dataset.delGo); return; }

    if (t.closest('#srcFilePick')) { haptic(); sfx('nav'); void importSourceFile(); return; }
    if (t.closest('#srcUrlGo')) { sfx('tap'); void importSourceUrl(); return; }

    const pushBtn = t.closest('[data-push]');
    if (pushBtn) { haptic(); sfx('nav'); pushSub(pushBtn.dataset.push); return; }

    const popBtn = t.closest('[data-pop]');
    if (popBtn) { sfx('nav'); popSub(); return; }

    const tabBtn = t.closest('[data-tab-go]');
    if (tabBtn) { haptic(); sfx('tab'); goTab(tabBtn.dataset.tabGo); return; }

    /* 收藏页的「歌曲 / 歌单」页签 */
    const favTabBtn = t.closest('[data-fav-tab]');
    if (favTabBtn) { sfx('tab'); void setFavTab(favTabBtn.dataset.favTab); return; }

    /* 搜索页的「歌曲 / 歌单」页签 */    const searchTabBtn = t.closest('[data-search-tab]');
    if (searchTabBtn) { sfx('tab'); setSearchTab(searchTabBtn.dataset.searchTab); return; }

    /* 三个平台选择器 */
    const searchSrc = t.closest('[data-search-src]');
    if (searchSrc) { haptic(); sfx('tab'); void setSearchSource(searchSrc.dataset.searchSrc); return; }
    const chartSrc = t.closest('[data-chart-src]');
    if (chartSrc) { haptic(); sfx('tab'); void setChartSource(chartSrc.dataset.chartSrc); return; }
    const squareSrc = t.closest('[data-square-src]');
    if (squareSrc) { haptic(); sfx('tab'); void setSquareSource(squareSrc.dataset.squareSrc); return; }

    /* 搜索结果底部的「加载更多」 */
    if (t.closest('#searchMore')) { sfx('tap'); void loadMoreSearch(); return; }

    const searchBtn = t.closest('[data-search]');
    if (searchBtn) { sfx('tap'); commitSearch(searchBtn.dataset.search); return; }

    /* 联想词：点一行就用它搜。第一行是「搜索原文」，用的是输入框里现在的内容 */
    const tipGo = t.closest('[data-tip-go]');
    if (tipGo) {
      sfx('tap');
      const q = ($('#searchInput').value || '').trim();
      $('#searchInput').blur();
      commitSearch(q);
      return;
    }
    const tipBtn = t.closest('[data-tip]');
    if (tipBtn) {
      sfx('tap');
      $('#searchInput').value = tipBtn.dataset.tip;
      $('#searchClear').hidden = false;
      $('#searchInput').blur();
      commitSearch(tipBtn.dataset.tip);
      return;
    }

    const likesBtn = t.closest('[data-play-likes]');
    if (likesBtn) { haptic(); sfx('play'); playLikes(); return; }

    const nativeBtn = t.closest('[data-native-settings]');
    if (nativeBtn) { haptic(); sfx('nav'); Tide.openNativeSettings(); return; }

    /* 内核里已有现成实现的页面（最近播放 / 本地音乐 / 新建歌单…）。
       「我的下载」不进原生：原生那页是个 stub，潮汐自己画（renderDlList）。 */
    const nativePage = t.closest('[data-native-page]');
    if (nativePage && nativePage.dataset.nativePage !== 'downloads') {
      haptic(); sfx('nav'); Tide.openNativePage(nativePage.dataset.nativePage); return;
    }
    if (nativePage) { haptic(); sfx('nav'); renderDlList(); openSheet('dlSheet'); return; }

    const toastBtn = t.closest('[data-toast]');
    if (toastBtn) { sfx('tap'); toast(toastBtn.dataset.toast); return; }

    /* 音效设置：试听按钮；音色包整行可点，选完就用新音色响一声 */
    const tryBtn = t.closest('[data-sfx-try]');
    if (tryBtn) { sfx(tryBtn.dataset.sfxTry); return; }

    const packBtn = t.closest('[data-sfx-pack]');
    if (packBtn) {
      state.sfx.pack = packBtn.dataset.sfxPack;
      applySfx();
      sfx('tab');
      return;
    }

    /* 播放音效：这几个控件是 renderPlayFx 生成的，所以走事件委托。
       点一下只负责把新值交给内核，界面等内核回话再重画（不本地猜）。 */
    const pfTab = t.closest('[data-pf-group]');
    if (pfTab) { sfx('tab'); pfGroup = pfTab.dataset.pfGroup; applyPlayFx(); return; }

    const pfPreset = t.closest('[data-pf-preset]');
    if (pfPreset) { sfx('tap'); void setPlayFx({ preset: Number(pfPreset.dataset.pfPreset) }); return; }

    const pfReverb = t.closest('[data-pf-reverb]');
    if (pfReverb) { sfx('tap'); void setPlayFx({ reverb: Number(pfReverb.dataset.pfReverb) }); return; }

    /* 音效弹层里「播放音效 / 界面音效」两个页签 */
    const sfxTab = t.closest('[data-sfx-tab]');
    if (sfxTab) { sfx('tab'); showSfxTab(sfxTab.dataset.sfxTab); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const song = e.target.closest && e.target.closest('[data-token]');
    if (song) {
      e.preventDefault();
      Tide.play(song.dataset.token, Number(song.dataset.idx)).catch(err => log(err));
    }
  });

  /* 播放页 */
  $('#miniTap').addEventListener('click', () => { haptic(); sfx('nav'); openPlayer(); });
  $('#miniPlay').addEventListener('click', e => { e.stopPropagation(); sfx(state.isPlay ? 'pause' : 'play'); Tide.toggle().catch(log); });
  $('#miniNext').addEventListener('click', e => { e.stopPropagation(); sfx('skip'); Tide.next().catch(log); });
  $('#playerClose').addEventListener('click', () => { sfx('nav'); closePlayer(); });
  $('#playerStage').addEventListener('click', e => {
    if (e.target.closest('#lyrics')) { sfx('tap'); toggleLyrics(false); return; }
    sfx('tap'); toggleLyrics();
  });
  /* 提示做成了胶囊，看起来就像能点；点它也要真的能切，别让人对着按钮发呆 */
  $('#playerHint').addEventListener('click', () => { sfx('tap'); toggleLyrics(); });
  $('#pPlay').addEventListener('click', () => { haptic(); sfx(state.isPlay ? 'pause' : 'play'); Tide.toggle().catch(log); });
  $('#pNext').addEventListener('click', () => { sfx('skip'); Tide.next().catch(log); });
  $('#pPrev').addEventListener('click', () => { sfx('skip'); Tide.prev().catch(log); });
  $('#pLike').addEventListener('click', () => {
    haptic();
    state.liked = !state.liked;
    updateLike();
    sfx(state.liked ? 'like' : 'unlike');
    Tide.like(state.liked).catch(log);
    toast(state.liked ? '已加入我喜欢的音乐' : '已取消收藏');
  });
  $('#pShuffle').addEventListener('click', () => {
    const m = state.mode === 1 ? 0 : 1;
    state.mode = m; updateModeUI();
    sfx('tap');
    Tide.setMode(m).catch(log);
    toast(PLAY_MODES[m]);
  });
  $('#pRepeat').addEventListener('click', () => {
    const m = (state.mode + 1) % 3;
    state.mode = m; updateModeUI();
    sfx('tap');
    Tide.setMode(m).catch(log);
    toast(PLAY_MODES[m]);
  });
  $('#pQueue').addEventListener('click', () => { haptic(); sfx('nav'); renderQueue(); openSheet('queueSheet'); });
  /* 音效：播放页里随手就能换，不用退回设置页 */
  $('#pSfx').addEventListener('click', () => {
    haptic();
    sfx('nav');
    applySfx();
    showSfxTab('play');
    openSheet('sfxSheet');
  });
  /* 播放页右上角「更多」：原来只弹一句「更多操作」，现在是个真入口 */
  $('#pMore').addEventListener('click', () => {
    haptic();
    sfx('nav');
    const s = state.current;
    $('#moreSong').textContent = s ? s.name + ' · ' + (s.singer || '') : '—';
    applySfx();
    applyPlayFx();
    openSheet('moreSheet');
  });
  $$('[data-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      const what = btn.dataset.more;
      sfx('nav');
      if (what === 'sfx') { showSfxTab('play'); openSheet('sfxSheet'); return; }
      if (what === 'uisfx') { showSfxTab('ui'); openSheet('sfxSheet'); return; }
      if (what === 'queue') { renderQueue(); openSheet('queueSheet'); return; }
      /* 这两个要离开播放页，先把弹层收干净 */
      closeSheet();
      if (what === 'comment') { Tide.openNativePage('comment'); return; }
      Tide.share('song', {})
        .then(msg => { sfx('success'); if (msg) toast(msg); })
        .catch(err => { log(err); sfx('error'); toast('分享失败'); });
    });
  });
  /* 下载当前在播的歌（播放页底部，v1.9.25 起是真下载：落盘到 音乐/TideMusic/） */
  $('#pDownload').addEventListener('click', async () => {
    haptic(); sfx('tap');
    try {
      const r = await Tide.downloadSong({ current: true });
      if (r && r.ok === false) { sfx('error'); toast(r.msg || '这首歌下载不了'); return; }
      toast('开始下载当前歌曲');
    } catch (e) {
      log('downloadSong failed', e);
      sfx('error');
      toast(userMsg(e, '下载失败，稍后再试'));
    }
  });
  /* 整张歌单入队下载（逐首串行，事件里播报进度） */
  $('#plDownload').addEventListener('click', async () => {
    haptic(); sfx('tap');
    const tk = $('#plDownload').dataset.token;
    if (!tk) { sfx('error'); toast('歌单还没加载完，等封面出来再点'); return; }
    try {
      const r = await Tide.downloadList({ token: tk });
      if (r && r.ok === false) { sfx('error'); toast(r.msg || '这个歌单下载不了'); return; }
      sfx('success');
      toast('已加入下载（' + (r.count || 0) + ' 首，逐首进行）');
    } catch (e) {
      log('downloadList failed', e);
      sfx('error');
      toast(userMsg(e, '下载失败，稍后再试'));
    }
  });
  $('#playAllBtn').addEventListener('click', () => {
    const tk = $('#playAllBtn').dataset.token;
    if (!tk) { sfx('error'); toast('歌单还没加载完'); return; }
    sfx('play');
    Tide.play(tk, 0).catch(err => { log(err); sfx('error'); toast(userMsg(err, '播放失败')); });
  });
  $('#sheetMask').addEventListener('click', closeSheet);
  /* 清空队列（v1.9.25 起是真清空）：待播全清，正在播的这首保留（内核会
     重新 setTempList 只留它，播放不中断）。kept=0 才显示空态。 */
  $('#queueClear').addEventListener('click', async () => {
    haptic(); sfx('tap');
    try {
      const r = await Tide.queueClear();
      const kept = (r && r.kept) || 0;
      $('#queueCount').textContent = String(kept);
      if (kept) {
        await renderQueue();
        toast('待播已清空，正在播的这首保留');
      } else {
        $('#listQueue').innerHTML = '<p class="s-note">播放队列是空的。</p>';
        renderedLists.delete($('#listQueue'));
        markKey = undefined;
        toast('队列已清空');
      }
    } catch (e) {
      log('queueClear failed', e);
      toast(userMsg(e, '清空失败，稍后再试'));
    }
  });

  /* 歌单详情：收藏到「我收藏的歌单」 */
  $('#plCollect').addEventListener('click', () => {
    if (!currentPlaylistId) return;
    haptic();
    sfx('tap');
    Tide.collectList(currentPlaylistId, state.playlistTitle || '')
      .then(msg => { sfx('success'); if (msg) toast(msg); })
      .catch(err => { log(err); sfx('error'); toast('收藏失败'); });
  });
  /* 歌单详情：排序（默认 → 歌名 → 歌手 循环）。
     数据侧排完再重画，所以点歌的下标仍然对得上。 */
  $('#plSort').addEventListener('click', () => {
    playlistSort = SORT_MODES[(SORT_MODES.indexOf(playlistSort) + 1) % SORT_MODES.length];
    setSortLabel();
    haptic();
    sfx('tab');
    if (currentPlaylistId) void openPlaylist(currentPlaylistId);
  });
  /* 歌单详情：分享这张歌单 */
  $('#plShare').addEventListener('click', () => {
    haptic();
    sfx('tap');
    Tide.share('list', { id: currentPlaylistId, title: state.playlistTitle })
      .then(msg => { sfx('success'); if (msg) toast(msg); })
      .catch(err => { log(err); sfx('error'); toast('分享失败'); });
  });
  /* 播放页：分享当前播放的歌 */
  $('#pShare').addEventListener('click', () => {
    haptic();
    sfx('tap');
    Tide.share('song', {})
      .then(msg => { sfx('success'); if (msg) toast(msg); })
      .catch(err => { log(err); sfx('error'); toast('分享失败'); });
  });
  /* 歌单广场：换一批 */
  $('#squareMore').addEventListener('click', () => { haptic(); sfx('nav'); void loadSquare(squarePage + 1); });

  /* 每日推荐：播放全部 / 换一批 */
  $('#dailyPlayAll').addEventListener('click', () => {
    const tk = $('#dailyPlayAll').dataset.token;
    if (!tk) { sfx('error'); toast('列表还没加载完'); return; }
    sfx('play');
    Tide.play(tk, 0).catch(err => { log(err); sfx('error'); toast(userMsg(err, '播放失败')); });
  });
  $('#dailyMore').addEventListener('click', () => { haptic(); sfx('nav'); void renderDaily(dailyShift + 1); });

  /* 收藏页签：播放全部 */
  $('#favPlayAll').addEventListener('click', () => {
    const tk = $('#favPlayAll').dataset.token;
    if (!tk) { sfx('error'); toast('还没有收藏的歌曲'); return; }
    haptic();
    sfx('play');
    Tide.play(tk, 0).catch(err => { log(err); sfx('error'); toast(userMsg(err, '播放失败')); });
  });

  /* 新建歌单：建完回「我的」页并重取列表，否则新建的歌单要下次启动才出现 */
  const createList = () => {
    const input = $('#newListName');
    const name = (input.value || '').trim();
    if (!name) { sfx('error'); toast('先给歌单起个名字'); input.focus(); return; }
    haptic();
    sfx('tap');
    Tide.createPlaylist(name)
      .then(msg => {
        sfx('success');
        toast(msg || '已创建');
        input.value = '';
        popSub();
        void renderLibrary().catch(log);
      })
      .catch(err => { log(err); sfx('error'); toast('创建失败'); });
  };
  $('#newListSave').addEventListener('click', createList);
  $('#newListName').addEventListener('keydown', e => { if (e.key === 'Enter') createList(); });

  /* 添加音源：地址栏回车＝点「导入」；输入时把上一次的红字清掉 */
  const srcUrl = $('#srcUrl');
  if (srcUrl) {
    srcUrl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); srcUrl.blur(); void importSourceUrl(); }
    });
    srcUrl.addEventListener('input', () => setSrcHint('填音源脚本的直链（.js），点「导入」会下载并安装。'));
  }

  /* 进度条拖拽
   *
   * 之前又卡又慢的三个原因，一起修掉：
   * 1) 拖拽期间内核还在推进度（4 次/秒），updateProgressUI 会把条子拽回播放位置 ——
   *    手指往前拖、条子自己往回跳，看着就是「延迟」。现在 seeking 期间整段跳过。
   * 2) 每次 pointermove 都 getBoundingClientRect()：读数紧跟在写样式后面，
   *    等于每次移动都强制同步重排一次。改成按下时量一次，拖拽期间用缓存。
   * 3) 移动事件可能比屏幕刷新还密，每来一个就写三个 DOM。改成攒到下一帧画一次。
   *
   * 松手时先把条子和时间画在松手的位置（还在 is-dragging，没有过渡），再去 seek，
   * 这样不用等内核下一帧进度事件 —— 原来松手后要愣 0~250ms 才动。 */
  const bar = $('#pBar');
  let dragging = false;
  let seekRatio = 0;
  let barBox = null;
  let rafId = 0;
  let dragSeq = 0;

  function ratioFrom(e) {
    if (!barBox) barBox = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - barBox.left) / (barBox.width || 1)));
  }

  function paintBar() {
    rafId = 0;
    const ratio = seekRatio;
    $('#pFill').style.transform = 'scaleX(' + ratio + ')';
    $('#pKnob').style.left = ratio * 100 + '%';
    $('#pCur').textContent = fmt(ratio * (state.duration || 0));
  }

  function schedulePaint() {
    if (rafId) return;
    rafId = requestAnimationFrame(paintBar);
  }

  bar.addEventListener('pointerdown', e => {
    if (!(state.duration > 0)) return;      // 时长还没到手，拖了也没意义
    dragSeq++;
    dragging = true;
    seeking = true;
    seekHold = 0;
    barBox = bar.getBoundingClientRect();   // 只在这里量一次
    bar.classList.add('is-dragging');
    document.documentElement.classList.add('is-seeking');
    try { bar.setPointerCapture(e.pointerId); } catch (err) {}
    seekRatio = ratioFrom(e);
    paintBar();                             // 按下立刻跟手，不等一帧
  });

  bar.addEventListener('pointermove', e => {
    if (!dragging) return;
    seekRatio = ratioFrom(e);
    schedulePaint();
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    const target = seekRatio * (state.duration || 0);
    /* 先乐观画定（还带着 is-dragging，没有过渡），再摘类、再去 seek */
    state.position = target;
    paintBar();
    /* 延后两帧再摘类：快速点一下时 pointerdown/up 可能落在同一帧，
       当场摘掉 transition 会让浏览器从旧位置补一段 .28s 过渡（看着慢半拍）。
       先保证目标位置在「无过渡」状态下真的画出来，再恢复过渡。 */
    const seq = dragSeq;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (dragging || seq !== dragSeq) return;
      bar.classList.remove('is-dragging');
      document.documentElement.classList.remove('is-seeking');
    }));
    seeking = false;
    if (target > 0) {
      seekHold = target;
      /* 串流歌 seek 要重新缓冲，常常超过 1 秒；给 6 秒兜底，内核一跟上就松开 */
      seekHoldUntil = performance.now() + 6000;
      Tide.seek(target).catch(err => {
        /* seek 直接失败了：放弃乐观位置，立刻回到内核的真实位置 */
        seekHold = 0;
        progressSig = null;
        updateProgressUI();
        log(err);
      });
    }
    progressSig = null;
    syncLyric();
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  /* 开关。原来的「单选圆点 / 分段控件 / 步进器」三个捕获处理器跟着它们
     的界面一起删掉了 —— 那些控件现在一个都不存在，留着只是让每次点击
     都多跑三趟 closest。 */
  document.addEventListener('click', e => {
    const sw = e.target.closest('.switch');
    if (!sw) return;
    e.stopPropagation();
    /* 摆设开关（通知/隐私两页还没有真状态，沉浸式状态栏常开）：压暗了也不许翻，
       翻了又没有东西可存，只会让人以为关掉了什么 */
    if (sw.closest('#scr-set-notify') || sw.closest('#scr-set-privacy') ||
        sw.hasAttribute('data-static-switch')) {
      sfx('tap');
      haptic();
      return;
    }
    const on = !sw.classList.contains('is-on');
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', String(on));
    if (sw.hasAttribute('data-sfx-switch')) {
      /* 界面音效开关：先落到设置上再响，关掉时那一声要响在关闭之前 */
      state.sfx.on = on;
      applySfx();
      if (on) sfx('play');
    } else if (sw.hasAttribute('data-pf-switch')) {
      /* 播放音效总开关。这里先发声再下发：关掉的那一下也该有反馈 */
      sfx(on ? 'play' : 'tap');
      setPlayFx({ enabled: on });
    } else if (sw.hasAttribute('data-ui-switch')) {
      sfx('tap');
      applyUiSwitch(sw.dataset.uiSwitch, on);
    } else {
      sfx('tap');
    }
    haptic();
  }, true);

  /* 皮肤 / 主题 / 主题色 */
  document.addEventListener('click', e => {
    const sk = e.target.closest('[data-skin-set]');
    if (sk) {
      applySkin(sk.dataset.skinSet);
      haptic();
      sfx('tap');
      toast('已切换到「' + (SKINS[sk.dataset.skinSet] || SKINS.ink).name + '」皮肤');
      return;
    }
    const t = e.target.closest('[data-theme-set]');
    if (t) {
      applyTheme(t.dataset.themeSet);
      haptic();
      sfx('tap');
      toast('已切换到「' + t.querySelector('.thememode__name').textContent + '」');
      return;
    }
    const s = e.target.closest('.swatch');
    if (s) { applyAccent(s.dataset.accent); haptic(); sfx('tap'); }
  });

  /* 滑块：字号（顺手补上持久化 —— 之前拖完不存，重启就回默认了） */
  const fontRange = $('#fontRange');
  fontRange.addEventListener('input', function () {
    const v = Number(this.value);
    document.documentElement.style.setProperty('--font-scale', FONT_SCALES[v]);
    $('#fontVal').textContent = FONT_LABELS[v];
  });
  fontRange.addEventListener('change', function () {
    store.set('fontScale', Number(this.value));
    sfx('tap');
  });

  /* 音效音量：拖动时只更新发声与文字，松手才写 localStorage（不然一次拖拽要写几十遍）。
     两个入口（设置页 + 播放页弹层）绑同一份逻辑，拖哪边都一样。 */
  function onSfxVolume(el) {
    const v = Number(el.value);
    state.sfx.volume = v / 100;
    if (window.Sfx) Sfx.setVolume(state.sfx.volume);
    $$('[data-sfx-val]').forEach(n => { n.textContent = v + '%'; });
    const name = (window.Sfx && Sfx.packs && Sfx.packs[state.sfx.pack]) || state.sfx.pack;
    $$('[data-sfx-sum]').forEach(n => { n.textContent = name + ' · ' + v + '%'; });
  }
  $$('[data-sfx-range]').forEach(rng => {
    rng.addEventListener('input', function () { onSfxVolume(this); });
    rng.addEventListener('change', () => { applySfx(); sfx('tap'); });
  });

  /* 播放音效的增强滑块。拖动时只改数字，松手才下发 ——
     每拖一格就过一次桥去建效果器，纯属白费（内核那边也要重新 setStrength）。 */
  document.addEventListener('input', e => {
    const rng = e.target.closest('[data-pf-range]');
    if (!rng) return;
    const v = Number(rng.value);
    const box = rng.closest('[data-playfx]');
    const val = box && $('[data-pf-val="' + rng.dataset.pfRange + '"]', box);
    if (val) val.textContent = v > 0 ? v + '%' : '关闭';
  });
  document.addEventListener('change', e => {
    const rng = e.target.closest('[data-pf-range]');
    if (!rng) return;
    sfx('tap');
    void setPlayFx({ [rng.dataset.pfRange]: Number(rng.value) * 10 });
  });

  /* 搜索框：边打字边联想。
     原来这里是「停 350ms 就直接搜」，等于每打一个词都发一次完整搜索请求；
     改成先出联想词、按回车（或点候选）才真搜 —— 少发请求，也符合各家音乐 App 的习惯。 */
  const input = $('#searchInput');
  input.addEventListener('input', function () {
    const v = this.value;
    $('#searchClear').hidden = !v.trim();
    if (!v.trim()) { hideSearchTips(); runSearch(''); return; }
    showTipsOnly();
    showSearchTips(v);
  });
  $('#searchClear').addEventListener('click', () => { sfx('tap'); input.value = ''; runSearch(''); input.focus(); });
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); sfx('tap'); commitSearch(input.value); input.blur(); });
  $('#clearHistory').addEventListener('click', () => {
    sfx('tap');
    Tide.clearHistory().then(renderSearchStatic).catch(log);
    toast('已清空搜索历史');
  });
  /* 隐私设置页里也有一行「清除搜索历史」。原来它只弹一句「已清除」，
     历史其实还在 —— 说做了就得真做。 */
  $('#privacyClearHistory').addEventListener('click', () => {
    haptic();
    sfx('tap');
    Tide.clearHistory()
      .then(() => { sfx('success'); toast('搜索历史已清空'); })
      .catch(err => { log(err); sfx('error'); toast('清空失败'); });
  });

  /* 账号与安全：只展示本机真实数据（这个版本没有账号体系） */
  async function renderAccount() {
    try {
      const d = await Tide.library();
      const s = d.stats || {};
      $('#acctLove').textContent = (s.love || 0) + ' 首';
      $('#acctLists').textContent = (s.lists || 0) + ' 个';
      $('#acctDl').textContent = (s.downloads || 0) + ' 首';
    } catch (e) {
      log('renderAccount failed', e);
    }
  }
  $$('[data-push="scr-set-account"]').forEach(el => el.addEventListener('click', () => { void renderAccount(); }));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });

  /* 外壳永不被滚动（不支持 overflow:clip 的浏览器兜底） */
  const app = $('#app');
  app.addEventListener('scroll', () => { app.scrollTop = 0; app.scrollLeft = 0; });
}

/* ───────────────────────── 启动 ───────────────────────── */

async function boot() {
  mark('boot start');
  const now = new Date();
  $('#dpDay').textContent = now.getDate();
  $('#dpMon').textContent = (now.getMonth() + 1) + '月';
  const dailyDateEl = $('#dailyDate');
  if (dailyDateEl) dailyDateEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日';
  const h = now.getHours();
  $('#greet').textContent = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  $('#sbTime').textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');

  state.sfx = Object.assign({}, SFX_DEFAULTS, store.get('sfx', null) || {});
  /* 默认「跟随系统」：启动窗口的底色是系统深浅色（见 colors.xml），
     界面要是钉死深色，浅色系统的用户反而每次打开都闪一下。 */
  applyTheme(store.get('theme', 'system'));
  applySkin(store.get('skin', 'ink'), true);
  applyAccent(store.get('accent', '#3ECFB2'));
  applySfx();
  /* 播放音效：先只画空壳（不碰桥），真状态等首屏出来再问 */
  applyPlayFx();

  /* 主题页那几个真开关（虚化/翻译/动效/桌面歌词）：先把存过的状态画回去 */
  applyUiPrefs();

  /* 三个平台选择器先用本地记的选择画出来（桥还没 init，不能 await）；
     首屏出来后由内核设置覆盖，见下面的 load*Sources。 */
  state.searchSource = pickSourceId(state.searchSources, store.get('searchSrc', 'all'), 'all');
  state.chartSource = pickSourceId(state.chartSources, store.get('chartSrc', 'kw'), 'kw');
  state.squareSource = pickSourceId(state.squareSources, store.get('squareSrc', 'kw'), 'kw');
  paintSourceChips('searchSrcChips', 'searchSrcBar', state.searchSources, state.searchSource, 'search-src', '搜索源');
  paintSourceChips('chartSrcChips', 'chartSrcBar', state.chartSources, state.chartSource, 'chart-src', '榜单平台');
  paintSourceChips('squareSrcChips', 'squareSrcBar', state.squareSources, state.squareSource, 'square-src', '歌单平台');

  /* 字号存过就还原（以前只改不存，重启就回默认了） */
  const fsRaw = Number(store.get('fontScale', 2));
  const fsIdx = Number.isFinite(fsRaw) ? Math.max(0, Math.min(FONT_SCALES.length - 1, Math.round(fsRaw))) : 2;
  document.documentElement.style.setProperty('--font-scale', FONT_SCALES[fsIdx]);
  $('#fontRange').value = String(fsIdx);
  $('#fontVal').textContent = FONT_LABELS[fsIdx];

  bind();

  /* 内核事件 → 界面 */
  Tide.on('player', applyPlayer);
  Tide.on('progress', applyProgress);
  Tide.on('toast', p => { if (p && p.msg) toast(p.msg); });
  /* 下载进度播报：单首 start 也播；批量只在完成/失败时播（start 会刷屏）。
     progress 事件（每 10% 一条）不弹 toast，完成时一起说。 */
  Tide.on('download', p => {
    if (!p || !p.name) return;
    if (p.status === 'done') {
      const tail = p.single ? '' : (p.remain > 0 ? '（还剩 ' + p.remain + ' 首）' : '（全部完成）');
      toast('已下载：' + p.name + tail);
      if ($('#dlSheet').classList.contains('is-open')) renderDlList();
      return;
    }
    if (p.status === 'error') { sfx('error'); toast(p.msg || ('下载失败：' + p.name)); return; }
    if (p.status === 'start' && p.single) toast('开始下载：' + p.name);
  });
  Tide.on('queue', () => { if ($('#queueSheet').classList.contains('is-open')) renderQueue(); });
  /* 歌词是随歌曲信息异步加载的，到了就重取一次 */
  Tide.on('lyrics', () => { lyricFor = null; loadLyrics(); });
  /* 榜单封面是内核后台补齐的，补一个推一个 */
  Tide.on('chartCovers', applyChartCover);
  /* 「为你精选」的歌单广场是内核后台取的（慢，不挡首屏），取到推一次 */
  Tide.on('homePlaylists', p => applyHomePlaylists(p && p.playlists));
  /* 「猜你喜欢」不够 30 首时，内核从榜单补足后推一次 */
  Tide.on('homeLikes', p => applyHomeLikes(p && p.songs, p && p.token));
  /* 音源换了（在原生音源页里换的）内核会推一份最新的，「我的」那行摘要跟着更新 */
  Tide.on('apiSources', applySources);

  try {
    const boot0 = await Tide.init();
    mark('init ok');
    log('tide bridge ready, backend =', Tide.backend);
    /* 内核在启动时恢复了上次播放的歌（暂停态）。那串播放事件发生在
       WebView 就绪之前，界面收不到 —— init 的返回值里带一份快照，
       这里补上，冷启动后底部迷你条就能显示上次那首，点播放直接续。 */
    if (boot0 && boot0.player) applyPlayer(boot0.player);
    /* 真实版本号（以前关于页写死 3.2.0，和 APK 的 1.9.x 对不上） */
    if (boot0 && boot0.version) {
      const ver = '版本 ' + boot0.version;
      const a = $('#aboutVer'); if (a) a.textContent = ver;
      const b = $('#aboutVerDesc'); if (b) b.textContent = ver;
    }
    /* 检查更新：走原生那条链路（GitHub Release → 下载 APK → 系统安装器）。
       这里只负责触发与文案；下载进度、忽略此版本、安装都由原生弹窗接管。 */
    const checkBtn = $('#aboutCheck');
    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        const val = $('#aboutCheckVal');
        if (val) val.textContent = '检查中…';
        try {
          const r = await Tide.checkUpdate();
          if (r && r.latest) {
            if (val) val.textContent = '已是最新';
            toast('当前已是最新版本');
          } else if (r && r.newVersion) {
            if (val) val.textContent = '新版本 v' + r.newVersion;
          } else if (r && r.unknown) {
            if (val) val.textContent = '检查失败';
            toast('检查更新失败，请稍后再试');
          } else {
            if (val) val.textContent = '已是最新';
            toast('当前已是最新版本');
          }
        } catch (e) {
          if (val) val.textContent = '检查失败';
          toast('检查更新失败，请稍后再试');
        }
      });
    }
  } catch (e) {
    /* Error 对象经日志通道 JSON 化之后会变成 {}，什么都看不到，所以把 message 单独写出来 */
    log('Tide.init failed:', (e && e.message) || String(e));
    /* 这里不弹「内核连接失败」：init 只是要一次回执，超时不代表桥断了 ——
       原生侧一收到 init 就打开了事件推送，后面的命令也照常能用。
       真有问题的话，各页自己会显示「加载失败」。 */
  }

  /* 先把当前页签画出来再管别的：冷启动那几百毫秒里内核线程、网络、WebView
     都在抢，同时发五条命令只会互相拖慢，首屏反而更晚出来。
     榜单与「我的」干脆不在启动时碰：goTab 里本来就有懒加载，谁点谁拉。
     （以前是在空闲回调里预取，等于启动时白画 43 张榜单卡、顺带发 43 个封面请求，
     从 +3.5s 一直占到 +7.5s，和首屏那条数据请求抢带宽。） */
  await renderHome();
  mark('home');
  syncMini();
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 150));
  idle(() => {
    /* 播放音效：不是首屏，等空闲了再问内核（设置页那一行的摘要在等它） */
    void loadPlayFx();
    /* 平台选择器：内核设置是唯一真源，原生页改过也能同步回来 */
    void loadSearchSources();
    void loadChartSources();
    void loadSquareSources();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
