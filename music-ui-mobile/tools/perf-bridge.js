/* ═══════════════════════════════════════════════════════════
   压测桩（只在 tools/perf-harness.html 里用，不进 APK）

   它把自己伪装成原生桥：界面发来的每条命令都记一笔，然后同步回一份
   假数据。这样界面跑的是**原生后端**那条代码路径 —— 与真机上完全一致，
   但发出去多少条 postMessage、改了多少个 DOM 节点，都能数出来。

   量四件事：
     · 启动到 load 之间界面发出去的消息（按命令名分组）
     · 每个工作负载造成的 DOM 变更数（全屏 / 专辑封面 / 迷你条封面 / 歌词）
     · 每个工作负载同步跑完的真实耗时
     · 期间发出的桥消息

   结果既写进 #perf-out，也 POST 给 tools/perf-run.py —— 那边不用
   --virtual-time-budget，所以 performance.now() 是真实时钟。
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var N_LONG = 300;    // 长列表规模：搜索结果/大歌单那一档

var counts = {};
var msgMark = {};
var countsAtLoad = null;

/* ── 假数据 ───────────────────────────────────────────── */

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function song(i) {
  return {
    key: 'k' + i,
    name: '压测歌曲 ' + i,
    singer: '压测歌手 ' + (i % 20),
    album: '压测专辑 ' + (i % 7),
    interval: '3:' + pad2(i % 60),
    source: 'kw',
    pic: '',                 // 不带图：免掉图片解码带来的不确定变更
  };
}

function songs(n, off) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(song(i + (off || 0)));
  return out;
}

function boards() {
  var out = [];
  for (var i = 0; i < 12; i++) {
    out.push({
      id: 'board:kw__' + (i + 1), name: '压测榜 ' + (i + 1),
      cover: 'c', img: '', meta: '在线排行榜', tops: ['a', 'b', 'c'],
    });
  }
  return out;
}

function playlists(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ id: 'sl:kw:' + i, name: '压测歌单 ' + i, cover: 'c', img: '', meta: '1.2万 次播放' });
  }
  return out;
}

function lrcFixture() {
  var out = '';
  for (var i = 0; i < 40; i++) {
    out += '[' + Math.floor(i / 4) + ':' + pad2((i * 15) % 60) + '.00]第 ' + i + ' 行歌词\n';
  }
  return out;
}

function reply(cmd) {
  switch (cmd) {
    case 'init':           return { ok: true };
    case 'home':           return { playlists: playlists(6), likes: songs(N_LONG), token: 't_home' };
    case 'charts':         return { charts: boards() };
    case 'library':        return { my: [], fav: [], stats: { love: N_LONG, lists: 0, downloads: 0, follows: 0 } };
    case 'playlistDetail': return { title: '压测歌单', author: '压测', desc: '', cover: 'c', songs: songs(N_LONG), token: 't_pl' };
    case 'chartDetail':    return { title: '压测榜', author: '', desc: '', cover: 'c', songs: songs(N_LONG), token: 't_bd' };
    case 'square':         return { playlists: playlists(12) };
    case 'search':         return { songs: songs(141), token: 't_se' };
    case 'hot':            return { hot: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) { return { w: '热词' + i, d: '大家都在搜', b: '' }; }) };
    case 'history':        return { history: ['周杰伦', '深夜电台', 'lofi'] };
    case 'addHistory':     return { history: ['周杰伦', '深夜电台', 'lofi'] };
    case 'queue':          return { songs: songs(N_LONG) };
    case 'lyrics':         return { lrc: lrcFixture(), tlrc: '' };
    default:               return { ok: true };
  }
}

/* ── 假装成原生 ───────────────────────────────────────── */

window.ReactNativeWebView = {
  postMessage: function (raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.cmd) counts[m.cmd] = (counts[m.cmd] || 0) + 1;
    if (m.id && window.TideNative) {
      window.TideNative.reply(m.id, true, m.cmd === '__log' ? {} : reply(m.cmd, m.args));
    }
  },
};

/* ── 计数 ─────────────────────────────────────────────── */

var tally = { all: 0, art: 0, mini: 0, lyric: 0 };
var results = {};
var mutations_total = 0;

function snapshotCounts() {
  var c = {};
  for (var k in counts) c[k] = counts[k];
  return c;
}
function countsSince(mark) {
  var out = {};
  for (var k in counts) {
    var d = counts[k] - (mark[k] || 0);
    if (d) out[k] = d;
  }
  return out;
}
function zeroTally() {
  tally.all = 0; tally.art = 0; tally.mini = 0; tally.lyric = 0;
  mutations_total = 0;
}

function watch(root, tag) {
  if (!root) return;
  var o = new MutationObserver(function (recs) { tally[tag] += recs.length; });
  o.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
}

var emit = function (name, payload) {
  if (window.TideNative) window.TideNative.event(name, payload);
};

function playerPayload(i, isPlay) {
  return {
    song: song(i), isPlay: !!isPlay, position: 12.5, duration: 231,
    mode: 2, liked: false,
  };
}

/* 一次工作负载：清空计数 → 同步跑完 → 等一拍让 MutationObserver 交付 → 读数 */
function load(name, fn, n) {
  var t0 = performance.now();
  fn();
  var ms = performance.now() - t0;
  return new Promise(function (resolve) {
    setTimeout(function () {
      results[name] = {
        n: n,
        muts: tally.all,
        art: tally.art,
        mini: tally.mini,
        lyric: tally.lyric,
        ms: Math.round(ms * 1000) / 1000,
        msgs: countsSince(msgMark),
      };
      msgMark = snapshotCounts();
      zeroTally();
      resolve();
    }, 0);
  });
}

function header(title) {
  var host = document.getElementById('perf-host');
  if (!host) return;
  var el = document.createElement('div');
  el.className = 's-note';
  el.textContent = title;
  host.appendChild(el);
}

/* 界面到底画出来没有 —— 光看消息数会误判成「重复请求」 */
function diag() {
  function text(sel, n) {
    var el = document.querySelector(sel);
    return el ? el.textContent.trim().slice(0, n || 60) : '(没有这个节点)';
  }
  return {
    chartCards: document.querySelectorAll('#chartGrid .chartcard').length,
    chartText: text('#chartGrid'),
    myText: text('#myPlaylists'),
    listLikes: document.querySelectorAll('#listLikes .song').length,
    listPl: document.querySelectorAll('#listPlaylist .song').length,
    currentRows: document.querySelectorAll('.song.is-current').length,
  };
}

function report() {
  var payload = { boot: countsAtLoad, results: results, diag: diag() };
  var text = JSON.stringify(payload, null, 1);
  var pre = document.createElement('pre');
  pre.id = 'perf-out';
  pre.textContent = text;
  document.body.appendChild(pre);
  document.title = 'perf-done';
  try { fetch('/result', { method: 'POST', body: text }); } catch (e) {}
}

function run() {
  /* 量性能时把音效关掉：否则第一次点击会建 AudioContext，
     那笔开销会混进基准里，前后两次就没法比了。 */
  try { if (window.Sfx) { window.Sfx.setEnabled(false); window.Sfx.play = function () {}; } } catch (e) {}

  var host = document.createElement('div');
  host.id = 'perf-host';
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  document.body.appendChild(host);

  watch(document.getElementById('screens'), 'all');
  watch(document.getElementById('pArt'), 'art');
  watch(document.getElementById('miniCover'), 'mini');
  watch(document.getElementById('lyrics'), 'lyric');

  /* 先把首页那份长列表点开成一个子页：模拟搜索结果 / 大歌单那档规模 */
  var pl = document.querySelector('#scr-home .pcard[data-playlist]');
  var chain = Promise.resolve();

  if (pl) {
    chain = chain.then(function () {
      pl.click();
      return new Promise(function (r) { setTimeout(r, 0); });
    });
  }

  chain
    /* A 换歌：200 次「歌变了」的播放事件（长列表在 DOM 里，markCurrent 要扫 600 行）
       歌取 0..299 —— 和列表里的歌是同一批，标红那一步才会真的动 DOM */
    .then(function () {
      header('A 换歌 200 次');
      return load('player-change-song', function () {
        for (var k = 0; k < 200; k++) emit('player', playerPayload(k % N_LONG, true));
      }, 200);
    })
    /* B 只改播放态：200 次「同一首歌，播放/暂停」（不该重建封面、不该重扫标红） */
    .then(function () {
      header('B 切播放态 200 次');
      return load('player-toggle-only', function () {
        for (var k = 0; k < 200; k++) emit('player', playerPayload(7, k % 2 === 0));
      }, 200);
    })
    /* C 进度：200 次进度事件（歌词页打开着，最费的那种情形） */
    .then(function () {
      header('C 打开播放页与歌词');
      document.getElementById('miniTap').click();
      document.getElementById('playerStage').click();
      return new Promise(function (r) { setTimeout(r, 0); });
    })
    .then(function () {
      zeroTally();
      header('D 进度 200 次');
      return load('progress', function () {
        for (var k = 0; k < 200; k++) {
          emit('progress', { position: 10 + k * 0.25, duration: 231 });
        }
      }, 200);
    })
    /* E 榜单封面推 12 个 */
    .then(function () {
      header('E 榜单封面 12 个');
      return load('chart-covers', function () {
        for (var k = 0; k < 12; k++) {
          emit('chartCovers', { id: 'board:kw__' + (k + 1), img: '', tops: ['a', 'b', 'c'] });
        }
      }, 12);
    })
    /* F 切页签 40 次（每次都会 syncMini → 通知原生） */
    .then(function () {
      header('F 切页签 40 次');
      return load('tab-switch', function () {
        var tabs = document.querySelectorAll('.tab');
        for (var k = 0; k < 40; k++) tabs[k % tabs.length].click();
      }, 40);
    })
    .then(report)
    .catch(function (e) {
      var pre = document.createElement('pre');
      pre.id = 'perf-out';
      pre.textContent = JSON.stringify({ error: String(e && e.message || e), boot: countsAtLoad, results: results });
      document.body.appendChild(pre);
    });
}

window.addEventListener('load', function () {
  countsAtLoad = snapshotCounts();
  msgMark = snapshotCounts();
  setTimeout(run, 0);
});

})();
