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

/* ───────────────────────── 状态 ───────────────────────── */

const state = {
  tab: 'home',
  theme: 'dark',
  skin: 'ink',
  accent: '#3ECFB2',

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
};

const subStack = [];
let currentPlaylistId = null;

/* ───────────────────────── 封面 ───────────────────────── */

function coverGradient(key) {
  const cs = getComputedStyle(document.documentElement);
  const a = cs.getPropertyValue('--c-' + key + '-1').trim() || '#FF9A6B';
  const b = cs.getPropertyValue('--c-' + key + '-2').trim() || '#FF4E7A';
  return 'linear-gradient(140deg,' + a + ',' + b + ')';
}

function applyCoverVars(el, key) {
  if (el) el.style.backgroundImage = coverGradient(key);
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
  applyCoverVars($('#playerBg'), state.coverKey);
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
      '<button class="song__more" data-song-more="' + idx + '" aria-label="更多操作">' +
        icon('more', 'icon--sm') +
      '</button>' +
    '</div>'
  );
}

function renderList(el, songs, token) {
  if (!el) return;
  if (token) state.lists[token] = songs || [];
  if (!songs || !songs.length) {
    el.innerHTML = '<p class="s-note">这里还没有歌曲。</p>';
    return;
  }
  el.innerHTML = songs.map((s, i) => songRow(s, i, token)).join('');
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

async function renderHome() {
  try {
    const d = await Tide.home();
    const heroLabel = $('#heroEyebrow');
    if (heroLabel) heroLabel.textContent = Tide.isNative ? '随便听听' : '每日推荐';
    likesToken = d.token || null;
    $('#homePlaylists').innerHTML = (d.playlists || []).slice(0, 6).map(playlistCard).join('') ||
      '<p class="s-note">歌单广场暂时取不到内容。</p>';
    renderList($('#listLikes'), d.likes, d.token);
  } catch (e) {
    log('renderHome failed', e);
    $('#listLikes').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* 首页那几处「播放全部 / 私人 FM」都指向收藏列表 */
let likesToken = null;
function playLikes() {
  if (!likesToken) { toast('还没有收藏的歌曲'); return; }
  Tide.play(likesToken, 0).catch(err => { log(err); toast('播放失败'); });
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

async function renderCharts() {
  try {
    const list = await Tide.charts();
    if (!list.length) throw new Error('没有取到榜单');
    state.charts = list;
    applyFeature(list[0]);
    $('#chartGrid').innerHTML = list.map(c =>
      '<button class="chartcard" data-playlist="' + esc(c.id) + '">' +
        chartCover(c, 'chartcard__cover') +
        '<span class="chartcard__name">' + esc(c.name) + '</span>' +
        '<span class="chartcard__meta">' + esc(c.meta || '') + '</span>' +
      '</button>').join('');
  } catch (e) {
    log('renderCharts failed', e);
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
    const list = await Tide.square(page);
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

async function renderLibrary() {
  try {
    const d = await Tide.library();
    if (d.stats) {
      const vals = $$('.stats__item b');
      if (vals[0]) vals[0].textContent = d.stats.love;
      if (vals[1]) vals[1].textContent = d.stats.lists;
      if (vals[2]) vals[2].textContent = d.stats.downloads;
      if (vals[3]) vals[3].textContent = d.stats.follows;
    }
    $('#myPlaylists').innerHTML = (d.my || []).map(playlistItem).join('') ||
      '<p class="s-note">还没有自建歌单。</p>';
    $('#favPlaylists').innerHTML = (d.fav || []).map(playlistItem).join('') ||
      '<p class="s-note">还没有收藏的歌单。</p>';
    const mc = $('#myListCount'), fc = $('#favListCount');
    if (mc) mc.textContent = (d.my || []).length;
    if (fc) fc.textContent = (d.fav || []).length;
  } catch (e) {
    log('renderLibrary failed', e);
    $('#myPlaylists').innerHTML = '<p class="s-note">加载失败：' + esc(e.message || e) + '</p>';
  }
}

/* 「收藏」页签 = 我喜欢的音乐。每次切到这个页签都重取，红心改过之后不会看到旧列表。 */
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

async function renderSearchStatic() {
  try {
    const [hot, hist] = await Promise.all([Tide.hot(), Tide.history()]);
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

async function openPlaylist(id) {
  currentPlaylistId = id;
  pushSub('scr-playlist');
  $('#plTitle').textContent = '加载中…';
  $('#plAuthor').textContent = '';
  $('#plDesc').textContent = '';
  $('#listPlaylist').innerHTML = '';
  try {
    const d = await Tide.playlistDetail(id);
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

function currentScreen() { return $('.screen.is-active'); }

function goTab(name) {
  closeSubs();
  $$('.screen.is-active').forEach(s => s.classList.remove('is-active'));
  const el = document.getElementById('scr-' + name);
  if (el) el.classList.add('is-active');
  state.tab = name;
  $$('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.tabGo === name));
  /* 收藏列表会被播放页的红心改到，每次进这个页签都重取一次，省得看到过期数据 */
  if (name === 'fav') void renderFavorites();
  syncMini();
}

function pushSub(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isTabScreen(id)) { goTab(id.replace('scr-', '')); return; }

  const cur = currentScreen();
  if (cur) {
    if (cur.classList.contains('screen--sub')) subStack.push(cur.id);
    cur.classList.remove('is-active');
  }
  el.classList.remove('is-returning');
  el.classList.add('is-active');
  const sc = $('.scroll', el);
  if (sc) sc.scrollTop = 0;
  // 歌单广场是翻页数据，第一次进来才拉，不占启动时间
  if (id === 'scr-square' && !squarePage) void loadSquare(1);
  // 搜索页进来就聚焦输入框（各家音乐 App 都这样）；等翻页动画起头再聚焦，不然会被打断
  if (id === 'scr-search') {
    setTimeout(() => { try { $('#searchInput').focus(); } catch (e) {} }, 280);
  }
  syncMini();
}

function popSub() {
  const cur = currentScreen();
  if (!cur || !cur.classList.contains('screen--sub')) return;
  cur.classList.remove('is-active');

  const prevId = subStack.pop();
  const prev = prevId ? document.getElementById(prevId) : document.getElementById('scr-' + state.tab);
  if (!prev) return;

  prev.classList.remove('is-returning');
  void prev.offsetWidth;
  prev.classList.add('is-active');
  if (prev.classList.contains('screen--sub')) {
    prev.classList.add('is-returning');
    setTimeout(() => prev.classList.remove('is-returning'), 340);
  }
  syncMini();
}

function closeSubs() {
  while (subStack.length) {
    const id = subStack.pop();
    const el = document.getElementById(id);
    if (el) el.classList.remove('is-active');
  }
  $$('.screen--sub.is-active').forEach(s => s.classList.remove('is-active'));
}

/* ───────────────────────── 返回键 ───────────────────────── */

/* 界面是单页应用，安卓返回键得先问界面能不能退：把「还有没有上一层」告诉原生 */
function notifyNav() {
  const cur = currentScreen();
  const sub = !!(cur && cur.classList.contains('screen--sub'));
  const playerOpen = $('#player').classList.contains('is-open');
  const sheetOpen = $('#queueSheet').classList.contains('is-open');
  try { Tide.navState(!!(sub || playerOpen || sheetOpen)); } catch (e) {}
}

/* 原生返回键按下时调这里，返回 false 表示界面已处理 */
window.TideGoBack = function () {
  if ($('#queueSheet').classList.contains('is-open')) { closeSheet(); return true; }
  if ($('#player').classList.contains('is-open')) { closePlayer(); return true; }
  const cur = currentScreen();
  if (cur && cur.classList.contains('screen--sub')) { popSub(); return true; }
  return false;
};

/* ───────────────────────── 播放 ───────────────────────── */

/* 内核推来的当前歌曲 */
function applyPlayer(p) {
  if (!p || !p.song) return;
  const song = p.song;
  state.current = song;
  state.hasTrack = true;
  state.miniActive = true;
  state.isPlay = !!p.isPlay;
  state.mode = p.mode != null ? p.mode : state.mode;
  state.liked = !!p.liked;
  if (p.duration) state.duration = p.duration;
  if (p.position != null) state.position = p.position;

  $('#pTitle').textContent = song.name;
  $('#pArtist').textContent = song.singer + (song.album ? ' · ' + song.album : '');
  $('#miniTitle').textContent = song.name;
  $('#miniArtist').textContent = song.singer;

  state.coverKey = song.cover || 'a';
  const artCls = 'player__art cover cover--' + state.coverKey + (song.pic ? ' cover--img' : '') + ' is-beat';
  $('#pArt').className = artCls;
  $('#pArt').innerHTML = song.pic
    ? '<img class="cover__img" src="' + esc(song.pic) + '" alt="" ' +
      'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">'
    : '';
  applyCoverVars($('#playerBg'), state.coverKey);

  const mc = 'mini__cover cover cover--' + state.coverKey + (song.pic ? ' cover--img' : '');
  $('#miniCover').className = mc;
  $('#miniCover').innerHTML = song.pic
    ? '<img class="cover__img" src="' + esc(song.pic) + '" alt="" ' +
      'onerror="this.parentNode.classList.remove(\'cover--img\');this.remove()">'
    : '';

  if (!song.interval) song.interval = fmt(state.duration).replace(':', ':');
  $('#pDur').textContent = song.interval || fmt(state.duration);

  setPlayIcon(state.isPlay);
  updateLike();
  updateModeUI();
  updateProgressUI();
  markCurrent();
  syncMini();
  loadLyrics();
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

function updateProgressUI() {
  const d = state.duration || 1;
  const pct = Math.min(100, (state.position / d) * 100);
  $('#pFill').style.width = pct + '%';
  $('#pKnob').style.left = pct + '%';
  $('#miniFill').style.width = pct + '%';
  $('#pCur').textContent = fmt(state.position);
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

function markCurrent() {
  const key = state.hasTrack && state.current ? state.current.key : null;
  $$('[data-token]').forEach(el => {
    const songs = state.lists[el.dataset.token];
    if (!songs) return;
    const s = songs[Number(el.dataset.idx)];
    el.classList.toggle('is-current', !!key && !!s && s.key === key);
  });
}

function syncMini() {
  const el = $('#mini');
  if (!state.miniActive) { el.hidden = true; el.classList.remove('is-stowed'); notifyNav(); return; }
  el.hidden = false;
  const cur = currentScreen();
  const id = cur ? cur.id : '';
  const sys = id === 'scr-settings' || id.indexOf('scr-set-') === 0;
  el.classList.toggle('is-stowed', sys);
  notifyNav();
}

/* ───────────────────────── 歌词 ───────────────────────── */

let lyricLines = [];
let lyricFor = null;

async function loadLyrics() {
  if (!state.current) return;
  const key = state.current.key;
  if (lyricFor === key) return;
  lyricFor = key;
  lyricLines = [];
  $('#lyrics').innerHTML = '<div class="lyric">正在加载歌词…</div>';
  try {
    const lines = await Tide.lyrics();
    if (lyricFor !== key) return;
    lyricLines = lines || [];
    $('#lyrics').innerHTML = lyricLines.length
      ? lyricLines.map((l, i) =>
          '<div class="lyric" data-line="' + i + '">' + esc(l.x) +
            (l.tr ? '<span class="lyric__tr">' + esc(l.tr) + '</span>' : '') +
          '</div>').join('')
      : '<div class="lyric">这首歌没有歌词</div>';
    $('#lyrics').dataset.active = '';
    syncLyric();
  } catch (e) {
    log('loadLyrics failed', e);
    $('#lyrics').innerHTML = '<div class="lyric">歌词加载失败</div>';
  }
}

function syncLyric() {
  const box = $('#lyrics');
  if (!box.classList.contains('is-on') || !lyricLines.length) return;
  let active = 0;
  for (let i = 0; i < lyricLines.length; i++) {
    if (state.position >= lyricLines[i].t) active = i; else break;
  }
  const nodes = $$('.lyric', box);
  nodes.forEach((n, i) => n.classList.toggle('is-on', i === active));
  const el = nodes[active];
  if (el && String(box.dataset.active) !== String(active)) {
    box.dataset.active = active;
    box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }
}

function toggleLyrics(force) {
  const box = $('#lyrics');
  const on = force != null ? force : !box.classList.contains('is-on');
  box.classList.toggle('is-on', on);
  $('#pArt').classList.toggle('is-hidden', on);
  $('#playerHint').textContent = on ? '轻点歌词返回封面' : '轻点封面查看歌词';
  if (on) { box.dataset.active = ''; syncLyric(); }
}

/* ───────────────────────── 播放页 ───────────────────────── */

function openPlayer() {
  const p = $('#player');
  p.classList.add('is-open');
  p.setAttribute('aria-hidden', 'false');
  $('#pArt').classList.remove('is-hidden');
  notifyNav();
}

function closePlayer() {
  const p = $('#player');
  p.classList.remove('is-open');
  p.setAttribute('aria-hidden', 'true');
  toggleLyrics(false);
  closeSheet();
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
      return;
    }
    box.innerHTML = songs.map((s, i) => songRow(s, i, '')).join('');
    // 队列的点击走 queuePlay，需要单独标记
    $$('.song', box).forEach((el, i) => {
      el.dataset.token = '__queue__';
      el.dataset.idx = i;
    });
    state.lists['__queue__'] = songs;
    markCurrent();
  } catch (e) {
    log('renderQueue failed', e);
    box.innerHTML = '<p class="s-note">队列读取失败</p>';
  }
}

function openSheet() {
  $('#queueSheet').classList.add('is-open');
  $('#queueSheet').setAttribute('aria-hidden', 'false');
  const m = $('#sheetMask');
  m.hidden = false;
  void m.offsetWidth;
  m.classList.add('is-on');
  notifyNav();
}

function closeSheet() {
  const s = $('#queueSheet');
  if (!s.classList.contains('is-open')) return;
  s.classList.remove('is-open');
  s.setAttribute('aria-hidden', 'true');
  const m = $('#sheetMask');
  m.classList.remove('is-on');
  setTimeout(() => { if (!m.classList.contains('is-on')) m.hidden = true; }, 320);
  notifyNav();
}

/* ───────────────────────── 搜索 ───────────────────────── */

let searchSeq = 0;

async function runSearch(q) {
  q = (q || '').trim();
  const input = $('#searchInput');
  if (input.value !== q) input.value = q;
  $('#searchClear').hidden = !q;

  if (!q) {
    $('#searchHistorySec').hidden = false;
    $('#searchHotSec').hidden = false;
    $('#searchResultsSec').hidden = true;
    renderSearchStatic();
    return;
  }

  $('#searchHistorySec').hidden = true;
  $('#searchHotSec').hidden = true;
  $('#searchResultsSec').hidden = false;
  $('#resultTitle').textContent = '搜索中…';
  $('#listResults').innerHTML = '';

  const seq = ++searchSeq;
  try {
    const r = await Tide.search(q);
    if (seq !== searchSeq) return;
    $('#resultTitle').textContent = r.songs.length ? '找到 ' + r.songs.length + ' 首' : '没有找到相关歌曲';
    if (!r.songs.length) {
      $('#listResults').innerHTML = '<p class="s-note">换个关键词试试。</p>';
      return;
    }
    renderList($('#listResults'), r.songs, r.token);
    markCurrent();
  } catch (e) {
    if (seq !== searchSeq) return;
    log('search failed', e);
    $('#resultTitle').textContent = '搜索失败';
    $('#listResults').innerHTML = '<p class="s-note">' + esc(e.message || e) + '</p>';
  }
}

async function commitSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  try { await Tide.addHistory(q); } catch (e) {}
  runSearch(q);
}

/* ───────────────────────── 主题与外观 ───────────────────────── */

/* 把当前主题的底色同步出去，三处都要用：
   1. 写进 <html> 的行内样式 —— 这是 WebView 的首帧底色；而且 html 一旦有了背景，
      body 的背景就不再往画布上传，页面滚到头时露出来的也是它。
   2. 存进 localStorage，下次启动由 <head> 里那段引导脚本在样式表之前用上。
   3. 告诉原生，让启动窗口与 RN 根视图用同一个色 —— 否则浅色主题的用户
      会先看到一段深色再翻过去（反过来也一样）。 */
function syncBootBg() {
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
  if (Tide.setBootBg) Tide.setBootBg(hex);
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
  syncBootBg();
  updateThemeSummary();
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
  refreshCovers();
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

/* ───────────────────────── 事件绑定 ───────────────────────── */

function bind() {
  document.addEventListener('click', function (e) {
    const t = e.target;

    const moreBtn = t.closest('[data-song-more]');
    if (moreBtn) { e.stopPropagation(); toast('歌曲操作菜单'); return; }

    const song = t.closest('[data-token]');
    if (song && song.dataset.token !== undefined && song.dataset.idx !== undefined) {
      haptic();
      const token = song.dataset.token;
      const idx = Number(song.dataset.idx);
      if (token === '__queue__') Tide.queuePlay(idx).catch(err => log(err));
      else Tide.play(token, idx).catch(err => { log(err); toast('播放失败'); });
      return;
    }

    const pl = t.closest('[data-playlist]');
    if (pl) { haptic(); openPlaylist(pl.dataset.playlist); return; }

    const pushBtn = t.closest('[data-push]');
    if (pushBtn) { haptic(); pushSub(pushBtn.dataset.push); return; }

    const popBtn = t.closest('[data-pop]');
    if (popBtn) { popSub(); return; }

    const tabBtn = t.closest('[data-tab-go]');
    if (tabBtn) { haptic(); goTab(tabBtn.dataset.tabGo); return; }

    const searchBtn = t.closest('[data-search]');
    if (searchBtn) { commitSearch(searchBtn.dataset.search); return; }

    const likesBtn = t.closest('[data-play-likes]');
    if (likesBtn) { haptic(); playLikes(); return; }

    const nativeBtn = t.closest('[data-native-settings]');
    if (nativeBtn) { haptic(); Tide.openNativeSettings(); return; }

    /* 内核里已有现成实现的页面（最近播放 / 本地音乐 / 下载管理 / 新建歌单…） */
    const nativePage = t.closest('[data-native-page]');
    if (nativePage) { haptic(); Tide.openNativePage(nativePage.dataset.nativePage); return; }

    const toastBtn = t.closest('[data-toast]');
    if (toastBtn) { toast(toastBtn.dataset.toast); return; }
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
  $('#miniTap').addEventListener('click', () => { haptic(); openPlayer(); });
  $('#miniPlay').addEventListener('click', e => { e.stopPropagation(); Tide.toggle().catch(log); });
  $('#miniNext').addEventListener('click', e => { e.stopPropagation(); Tide.next().catch(log); });
  $('#playerClose').addEventListener('click', closePlayer);
  $('#playerStage').addEventListener('click', e => {
    if (e.target.closest('#lyrics')) { toggleLyrics(false); return; }
    toggleLyrics();
  });
  $('#pPlay').addEventListener('click', () => { haptic(); Tide.toggle().catch(log); });
  $('#pNext').addEventListener('click', () => Tide.next().catch(log));
  $('#pPrev').addEventListener('click', () => Tide.prev().catch(log));
  $('#pLike').addEventListener('click', () => {
    haptic();
    state.liked = !state.liked;
    updateLike();
    Tide.like(state.liked).catch(log);
    toast(state.liked ? '已加入我喜欢的音乐' : '已取消收藏');
  });
  $('#pShuffle').addEventListener('click', () => {
    const m = state.mode === 1 ? 0 : 1;
    state.mode = m; updateModeUI();
    Tide.setMode(m).catch(log);
    toast(PLAY_MODES[m]);
  });
  $('#pRepeat').addEventListener('click', () => {
    const m = (state.mode + 1) % 3;
    state.mode = m; updateModeUI();
    Tide.setMode(m).catch(log);
    toast(PLAY_MODES[m]);
  });
  $('#pQueue').addEventListener('click', () => { haptic(); renderQueue(); openSheet(); });
  $('#playAllBtn').addEventListener('click', () => {
    const tk = $('#playAllBtn').dataset.token;
    if (!tk) { toast('歌单还没加载完'); return; }
    Tide.play(tk, 0).catch(err => { log(err); toast('播放失败'); });
  });
  $('#sheetMask').addEventListener('click', closeSheet);
  $('#queueClear').addEventListener('click', () => {
    $('#queueCount').textContent = '0';
    $('#listQueue').innerHTML = '<p class="s-note">播放队列是空的。</p>';
    toast('清空队列请在原生播放列表里操作');
  });

  /* 歌单详情：收藏到「我收藏的歌单」 */
  $('#plCollect').addEventListener('click', () => {
    if (!currentPlaylistId) return;
    haptic();
    Tide.collectList(currentPlaylistId, state.playlistTitle || '')
      .then(msg => { if (msg) toast(msg); })
      .catch(err => { log(err); toast('收藏失败'); });
  });
  /* 歌单详情：分享这张歌单 */
  $('#plShare').addEventListener('click', () => {
    haptic();
    Tide.share('list', { id: currentPlaylistId, title: state.playlistTitle })
      .then(msg => { if (msg) toast(msg); })
      .catch(err => { log(err); toast('分享失败'); });
  });
  /* 播放页：分享当前播放的歌 */
  $('#pShare').addEventListener('click', () => {
    haptic();
    Tide.share('song', {})
      .then(msg => { if (msg) toast(msg); })
      .catch(err => { log(err); toast('分享失败'); });
  });
  /* 歌单广场：换一批 */
  $('#squareMore').addEventListener('click', () => { haptic(); void loadSquare(squarePage + 1); });

  /* 收藏页签：播放全部 */
  $('#favPlayAll').addEventListener('click', () => {
    const tk = $('#favPlayAll').dataset.token;
    if (!tk) { toast('还没有收藏的歌曲'); return; }
    haptic();
    Tide.play(tk, 0).catch(err => { log(err); toast('播放失败'); });
  });

  /* 新建歌单：建完回「我的」页并重取列表，否则新建的歌单要下次启动才出现 */
  const createList = () => {
    const input = $('#newListName');
    const name = (input.value || '').trim();
    if (!name) { toast('先给歌单起个名字'); input.focus(); return; }
    haptic();
    Tide.createPlaylist(name)
      .then(msg => {
        toast(msg || '已创建');
        input.value = '';
        popSub();
        void renderLibrary().catch(log);
      })
      .catch(err => { log(err); toast('创建失败'); });
  };
  $('#newListSave').addEventListener('click', createList);
  $('#newListName').addEventListener('keydown', e => { if (e.key === 'Enter') createList(); });

  /* 进度条拖拽 */
  const bar = $('#pBar');
  let dragging = false;
  let seekRatio = 0;
  function ratioFrom(e) {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  function paint(ratio) {
    $('#pFill').style.width = ratio * 100 + '%';
    $('#pKnob').style.left = ratio * 100 + '%';
    $('#pCur').textContent = fmt(ratio * (state.duration || 0));
  }
  bar.addEventListener('pointerdown', e => {
    dragging = true;
    bar.classList.add('is-dragging');
    bar.setPointerCapture(e.pointerId);
    seekRatio = ratioFrom(e); paint(seekRatio);
  });
  bar.addEventListener('pointermove', e => { if (dragging) { seekRatio = ratioFrom(e); paint(seekRatio); } });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-dragging');
    Tide.seek(seekRatio * (state.duration || 0)).catch(log);
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  /* 开关 / 单选 / 分段 / 步进器 */
  document.addEventListener('click', e => {
    const sw = e.target.closest('.switch');
    if (sw) {
      e.stopPropagation();
      const on = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', on);
      sw.setAttribute('aria-checked', String(on));
      haptic();
    }
  }, true);

  document.addEventListener('click', e => {
    const p = e.target.closest('.pick');
    if (p) {
      e.stopPropagation();
      $$('.pick[data-radio="' + p.dataset.radio + '"]').forEach(o => {
        o.classList.remove('is-on'); o.setAttribute('aria-checked', 'false');
      });
      p.classList.add('is-on'); p.setAttribute('aria-checked', 'true');
      haptic();
      return;
    }
    const b = e.target.closest('.stepper__btn');
    if (b) {
      e.stopPropagation();
      const box = b.closest('.stepper');
      let v = Number(box.dataset.value) + Number(b.dataset.step);
      v = Math.max(Number(box.dataset.min), Math.min(Number(box.dataset.max), v));
      box.dataset.value = String(v);
      $('.stepper__val', box).textContent = v;
      haptic();
    }
  }, true);

  document.addEventListener('click', e => {
    const s = e.target.closest('.seg__item');
    if (!s) return;
    e.stopPropagation();
    const seg = s.parentElement;
    $$('.seg__item', seg).forEach(o => o.classList.remove('is-on'));
    s.classList.add('is-on');
    haptic();
  }, true);

  /* 皮肤 / 主题 / 主题色 */
  document.addEventListener('click', e => {
    const sk = e.target.closest('[data-skin-set]');
    if (sk) {
      applySkin(sk.dataset.skinSet);
      haptic();
      toast('已切换到「' + (SKINS[sk.dataset.skinSet] || SKINS.ink).name + '」皮肤');
      return;
    }
    const t = e.target.closest('[data-theme-set]');
    if (t) {
      applyTheme(t.dataset.themeSet);
      haptic();
      toast('已切换到「' + t.querySelector('.thememode__name').textContent + '」');
      return;
    }
    const s = e.target.closest('.swatch');
    if (s) { applyAccent(s.dataset.accent); haptic(); }
  });

  /* 滑块：只服务「主题与外观」里的字号，其余滑块随重复设置页一起删掉了 */
  $('#fontRange').addEventListener('input', function () {
    const v = Number(this.value);
    document.documentElement.style.setProperty('--font-scale', FONT_SCALES[v]);
    $('#fontVal').textContent = FONT_LABELS[v];
  });

  /* 搜索 */
  const input = $('#searchInput');
  let searchTimer = null;
  input.addEventListener('input', function () {
    const v = this.value;
    clearTimeout(searchTimer);
    if (!v.trim()) { runSearch(''); return; }
    searchTimer = setTimeout(() => runSearch(v), 350);
  });
  $('#searchClear').addEventListener('click', () => { input.value = ''; runSearch(''); input.focus(); });
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); commitSearch(input.value); input.blur(); });
  $('#clearHistory').addEventListener('click', () => {
    Tide.clearHistory().then(renderSearchStatic).catch(log);
    toast('已清空搜索历史');
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });

  /* 外壳永不被滚动（不支持 overflow:clip 的浏览器兜底） */
  const app = $('#app');
  app.addEventListener('scroll', () => { app.scrollTop = 0; app.scrollLeft = 0; });
}

/* ───────────────────────── 启动 ───────────────────────── */

async function boot() {
  const now = new Date();
  $('#dpDay').textContent = now.getDate();
  $('#dpMon').textContent = (now.getMonth() + 1) + '月';
  const h = now.getHours();
  $('#greet').textContent = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  $('#sbTime').textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');

  applyTheme(store.get('theme', 'dark'));
  applySkin(store.get('skin', 'ink'), true);
  applyAccent(store.get('accent', '#3ECFB2'));

  bind();

  /* 内核事件 → 界面 */
  Tide.on('player', applyPlayer);
  Tide.on('progress', applyProgress);
  Tide.on('toast', p => { if (p && p.msg) toast(p.msg); });
  Tide.on('queue', () => { if ($('#queueSheet').classList.contains('is-open')) renderQueue(); });
  /* 歌词是随歌曲信息异步加载的，到了就重取一次 */
  Tide.on('lyrics', () => { lyricFor = null; loadLyrics(); });
  /* 榜单封面是内核后台补齐的，补一个推一个 */
  Tide.on('chartCovers', applyChartCover);

  try {
    await Tide.init();
    log('tide bridge ready, backend =', Tide.backend);
  } catch (e) {
    /* Error 对象经日志通道 JSON 化之后会变成 {}，什么都看不到，所以把 message 单独写出来 */
    log('Tide.init failed:', (e && e.message) || String(e));
    /* 这里不弹「内核连接失败」：init 只是要一次回执，超时不代表桥断了 ——
       原生侧一收到 init 就打开了事件推送，后面的命令也照常能用。
       真有问题的话，各页自己会显示「加载失败」。 */
  }

  await Promise.all([renderHome(), renderCharts(), renderLibrary(), renderSearchStatic()]);
  syncMini();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
