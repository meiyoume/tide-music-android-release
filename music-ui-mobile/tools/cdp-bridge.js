/* ═══════════════════════════════════════════════════════════
   CDP 压测桩（只在 tools/_perf-cdp.mjs 现造的临时页面里用，不进 APK）

   和 perf-bridge.js 是同一个思路（伪装成原生桥，让界面走真后端那条路），
   但这里**不自己跑基准**：只把 window.__emit 露出来，由外面的 CDP 脚本
   决定什么时候推什么事件，并且用 CDP 的 Performance.getMetrics 数
   layout / style recalc 的真实次数与耗时 —— 那才是「流畅度」的硬指标。

   数据刻意给得很少（首页 6 首、无封面图）：这一轮量的是**动画与重排**，
   不是长列表渲染，数据一多就把信号淹了。
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

function song(i) {
  return {
    key: 'k' + i, name: '压测歌曲 ' + i, singer: '压测歌手 ' + (i % 20),
    album: '压测专辑 ' + (i % 7), interval: '3:55', source: 'kw', pic: '',
  };
}
function songs(n) { var o = []; for (var i = 0; i < n; i++) o.push(song(i)); return o; }

var LRC = '';
for (var i = 0; i < 40; i++) {
  LRC += '[' + Math.floor(i / 4) + ':' + ('0' + ((i * 15) % 60)).slice(-2) + '.00]第 ' + i + ' 行歌词\n';
}

function reply(cmd) {
  switch (cmd) {
    case 'init':        return { ok: true };
    case 'home':        return { playlists: [], likes: songs(6), token: 't_home' };
    case 'charts':      return { charts: [] };
    case 'library':     return { my: [], fav: [], stats: { love: 0, lists: 0, downloads: 0, follows: 0 } };
    case 'queue':       return { songs: songs(6) };
    case 'lyrics':      return { lrc: LRC, tlrc: '' };
    case 'soundEffect': return null;
    default:            return { ok: true };
  }
}

window.ReactNativeWebView = {
  postMessage: function (raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.id && window.TideNative) window.TideNative.reply(m.id, true, reply(m.cmd));
  },
};

/* 由 CDP 侧调：__emit('player', {...}) / __emit('progress', {...}) */
window.__emit = function (name, payload) {
  if (window.TideNative) window.TideNative.event(name, payload);
};

/* 当前正在跑的动画（transition 也算）—— 用来证明「有没有东西一直在动」 */
window.__anims = function () {
  try {
    return document.getAnimations().map(function (a) {
      var t = a.effect && a.effect.target;
      var who = !t ? '?' : (t.id || (typeof t.className === 'string' ? t.className : '') || t.tagName);
      return (a.transitionProperty || a.animationName || '?') + '@' + String(who).slice(0, 40);
    });
  } catch (e) { return ['(getAnimations 不可用)']; }
};
})();
