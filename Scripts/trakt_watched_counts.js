/*
 * Trakt Watched Counts  v1.0.0
 * 仅对 Infuse 生效。
 */

const $ = new Env('Trakt Stats');

// ================= 平台适配 =================
const isSurge = typeof $environment !== 'undefined' && !!$environment && typeof $environment['surge-version'] !== 'undefined';
const isLoon = typeof $loon !== 'undefined';
const isQX = !isSurge && !isLoon && typeof $prefs !== 'undefined';

function complete(obj) {
  const o = obj || {};
  if (isQX) {
    const status = o.status !== undefined ? o.status : ($response && $response.status) || 200;
    return $done({
      status: typeof status === 'number' ? `HTTP/1.1 ${status}` : status,
      headers: o.headers || ($response && $response.headers) || {},
      body: o.body !== undefined ? o.body : ($response && $response.body) || ''
    });
  }
  return $done(o);
}
function send(url, headers, cb) {
  const req = { url: url, method: 'GET', headers: headers || {} };
  const fin = (err, r, d) => {
    if (err || !r) return cb(null);
    const h = {};
    Object.keys(r.headers || {}).forEach(k => { h[k] = r.headers[k]; });
    cb({ status: r.status || r.statusCode || 0, headers: h, body: d });
  };
  try {
    if (isSurge || isLoon) $httpClient.get(req, fin);
    else $task.fetch(req).then(r => fin(null, r, r.body), () => fin('error'));
  } catch (e) { cb(null); }
}

// ================= 工具 =================
function headerOf(headers, name) {
  const want = name.toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === want) return headers[keys[i]];
  }
  return null;
}
function isInfuse() {
  const ua = String(headerOf(($request && $request.headers) || {}, 'User-Agent') || '').toLowerCase();
  return ua.includes('infuse');
}

// ================= 伪装 VIP =================
function forgeVIP(raw) {
  const patch = j => {
    if (!j || !j.user) return false;
    // 只改 Infuse 判断所需的字段，其余保持服务端原值
    j.user.vip = true;
    j.user.vip_ep = true;
    return true;
  };
  try {
    const j = JSON.parse(raw);
    if (patch(j)) return JSON.stringify(j);
  } catch (e) {}
  try {
    const dec = typeof atob === 'function' ? atob(raw) : '';
    const j = JSON.parse(dec);
    if (patch(j)) return btoa(JSON.stringify(j));
  } catch (e) {}
  return null;
}

// ================= 计数（读响应头） =================
function countOf(host, path, headers, cb) {
  send(host + path + (path.indexOf('?') > -1 ? '&' : '?') + 'limit=1', headers, resp => {
    if (!resp || resp.status !== 200) return cb(null);
    const h = {};
    Object.keys(resp.headers).forEach(k => { h[k.toLowerCase()] = resp.headers[k]; });
    const n = parseInt(h['x-pagination-item-count'], 10);
    cb(Number.isFinite(n) ? n : null);
  });
}

function buildStats(movies, episodes, shows) {
  return {
    movies:        { plays: 0, watched: movies,   minutes: 0, collected: 0, ratings: 0, comments: 0 },
    shows:         { watched: shows, collected: 0, ratings: 0, comments: 0 },
    seasons:       { ratings: 0, comments: 0 },
    episodes:      { plays: 0, watched: episodes, minutes: 0, collected: 0, ratings: 0, comments: 0 },
    network:       { friends: 0, followers: 0, following: 0 },
    ratings:       { total: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, '10': 0 } },
    progress:      { started: 0, finished: 0, dropped: 0 },
    lists:         0,
    list_comments: 0,
    total_minutes: 0,
    total_plays:   0
  };
}

// ================= 入口 =================
!(function main() {
  const url = String(($request && $request.url) || '').split('#')[0];

  // 1) 仅对 Infuse 生效
  if (!url || !isInfuse()) return complete({});

  const reqHeaders = ($request && $request.headers) || {};
  const resHeaders = ($response && $response.headers) || {};
  const resBody = ($response && $response.body) || '';

  // 2) 伪装 VIP
  if (/\/users\/settings(\?|$)/.test(url)) {
    const forged = forgeVIP(resBody);
    if (forged === null) return complete({});
    const headers = {};
    Object.keys(resHeaders).forEach(k => {
      if (!/^content-(length|encoding)$/i.test(k)) headers[k] = resHeaders[k];
    });
    headers['Content-Type'] = 'application/json; charset=utf-8';
    console.log('[Trakt Stats] 已伪装 VIP');
    return complete({ status: 200, headers: headers, body: forged });
  }

  // 3) 还原统计
  if (/\/users\/(me|[^\/]+)\/stats(\?|$)/.test(url)) {
    // 原样透传请求头，只去掉长度/编码（body 为空）
    const H = {};
    Object.keys(reqHeaders).forEach(k => {
      if (!/^content-(length|encoding)$/i.test(k)) H[k] = reqHeaders[k];
    });

    const host = /apiz\.trakt\.tv/.test(url) ? 'https://apiz.trakt.tv/' : 'https://api.trakt.tv/';
    let pending = 3;
    const got = { movies: null, episodes: null, shows: null };

    const settle = () => {
      if (--pending > 0) return;
      if (got.movies === null && got.episodes === null && got.shows === null) {
        console.log('[Trakt Stats] 拉取失败，回退原响应');
        if ($response && $response.status === 200 && resBody) {
          return complete({ status: 200, headers: resHeaders, body: resBody });
        }
        return complete({ status: 204, headers: {}, body: '' });
      }
      const stats = buildStats(got.movies || 0, got.episodes || 0, got.shows || 0);
      console.log(`[Trakt Stats] 电影 ${stats.movies.watched} / 剧集 ${stats.episodes.watched} / 剧 ${stats.shows.watched}`);
      // 基于原始响应头覆盖，保留缓存协商等字段
      const headers = {};
      Object.keys(resHeaders).forEach(k => {
        if (!/^content-(length|encoding)$/i.test(k)) headers[k] = resHeaders[k];
      });
      headers['Content-Type'] = 'application/json; charset=utf-8';
      complete({ status: 200, headers: headers, body: JSON.stringify(stats) });
    };

    countOf(host, 'sync/watched/movies', H, n => { got.movies = n; settle(); });
    countOf(host, 'sync/watched/episodes', H, n => { got.episodes = n; settle(); });
    countOf(host, 'users/me/watched/shows', H, n => { got.shows = n; settle(); });
    return;
  }

  return complete({});
})();

// ================= 环境 =================
function Env(name) {
  this.name = name;
  this.log = (...a) => console.log(`[${this.name}]`, ...a);
  return this;
}
