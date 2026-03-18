/**
 * @file introdb_segments.js
 * @description IntroDB 增强脚本：解析请求并根据配置注入/修改跳过片段。
 * 💡 TheIntroDB API Key (默认关闭)：使用 IntroMerge 脚本填入 Key 并开启开关可提升 Limit，同时可即时获取自己提交的未审核条目且自己条目权重 x10。
 */

const $ = new Env("IntroDB_Segments");

(function () {
  const isRequest = typeof $request !== 'undefined' && typeof $response === 'undefined';
  const phase = isRequest ? "请求中" : "响应中";

  // --- 核心参数解析 (适配 Loon 列表、Surge 键值对、手写快捷、Qx BoxJS) ---
  let args = {};
  let argumentStr = typeof $argument !== 'undefined' ? $argument : null;

  if (typeof argumentStr === 'string' && argumentStr.trim()) {
    const argStr = argumentStr.trim();
    if (argStr.startsWith("{") && argStr.endsWith("}")) {
      // 旧版 BoxJS JSON 模式防呆
      try { args = JSON.parse(argStr); } catch (e) { }
    } else if (argStr.includes('=')) {
      // A. Surge 标准模式: "Modify=true,ForceUpdate=false"
      argStr.split(/[&,]/).forEach(item => {
        let [key, val] = item.split('=');
        if (key) args[key.trim()] = val ? val.trim() : true;
      });
    } else if (argStr.includes(',')) {
      // B. Loon 位置列表模式: "true,false,true,imdbid,..."
      const list = argStr.split(',').map(s => s.trim());
      const keys = ["Modify", "ForceUpdate", "Filter", "Target", "TargetSeason", "IntroOn", "IntroS", "IntroE", "RecapOn", "RecapS", "RecapE", "OutroOn", "OutroS", "OutroE"];
      keys.forEach((k, i) => { if (list[i] !== undefined) args[k] = list[i]; });
    } else {
      // C. 快捷模式: "最后生还者"
      args.Target = argStr;
      args.Modify = "true";
      args.Filter = "true";
      args.IntroOn = "true";
    }
  } else if (typeof argumentStr === 'object' && argumentStr !== null) {
    args = argumentStr;
  }

  // 独立按键提取：适配拆分版的 BoxJS UI 组件（仅在没传入原生参数时生效）
  if (Object.keys(args).length === 0 && !argumentStr) {
    const qxKeys = ["Modify", "ForceUpdate", "Filter", "Target", "TargetSeason", "IntroOn", "IntroS", "IntroE", "RecapOn", "RecapS", "RecapE", "OutroOn", "OutroS", "OutroE"];
    qxKeys.forEach(k => {
      let val = $.getdata(`introdb_segments_${k}`);
      if (val !== undefined && val !== null && val !== '') {
        args[k] = val;
      }
    });
  }

  const config = {
    enabled: (args.Modify == "true" || args.Modify === true),
    force_update: (args.ForceUpdate == "true" || args.ForceUpdate === true),
    filter: (args.Filter == "true" || args.Filter === true),
    target: (args.Target || "").toString().trim(),
    target_season: (args.TargetSeason || "").toString().trim(),
    intro_on: (args.IntroOn == "true" || args.IntroOn === true),
    intro_s: parseTime(args.IntroS),
    intro_e: parseTime(args.IntroE),
    recap_on: (args.RecapOn == "true" || args.RecapOn === true),
    recap_s: parseTime(args.RecapS),
    recap_e: parseTime(args.RecapE),
    outro_on: (args.OutroOn == "true" || args.OutroOn === true),
    outro_s: parseTime(args.OutroS),
    outro_e: parseTime(args.OutroE)
  };

  if (!config.enabled) { $done({}); return; }

  // --- 请求阶段：强制刷新处理 ---
  if (isRequest) {
    if (config.force_update) {
      let headers = $request.headers;
      let mod = false;
      ["If-None-Match", "if-none-match", "If-Modified-Since", "if-modified-since"].forEach(h => {
        if (headers[h]) { delete headers[h]; mod = true; }
      });
      if (mod) {
        console.log("--- IntroDB 强制刷新：已移除缓存 Header ---");
        $done({ headers });
      } else {
        $done({});
      }
    } else {
      $done({});
    }
    return;
  }

  // --- 响应阶段：数据补全 ---
  (async () => {
    console.log("--- IntroDB 开始补全数据 ---");
    console.log(`HTTP 状态码: ${$response.status}`);

    if ($response.status == 304 || !$response.body) {
      console.log("无法修改：状态 304 或无响应体"); $done({}); return;
    }

    try {
      const url = $request.url || "";
      const currentId = (url.match(/imdb_id=([^&]+)/) || [])[1];
      const currentSeason = (url.match(/season=([^&]+)/) || [])[1];

      // 过滤逻辑
      if (config.filter) {
        const PROTECTION_ID = "tt6953912";
        let isMatch = false;

        if (!config.target) {
          // 情况 1: 开关打开但未填写内容 -> 使用保护机制 ID
          console.log(`[过滤] ⚠️ 开关已开启但未设置目标，默认指向保护 ID`);
          if (currentId === PROTECTION_ID) isMatch = true;
        } else {
          // 情况 2: 开关打开且填写了内容 -> 进行智能匹配
          const targets = config.target.split(',').map(s => s.trim()).filter(s => s);

          // A. 静态 ID 匹配
          if (currentId && targets.some(t => t === currentId)) {
            console.log(`[过滤] ID 静态匹配成功: ${currentId}`);
            isMatch = true;
          }

          // B. 动态名称查找
          if (!isMatch && currentId) {
            const names = targets.filter(t => !t.startsWith('tt'));
            if (names.length > 0) {
              console.log(`[过滤] 开始在名称清单中探测匹配 ID...`);
              for (let name of names) {
                if (await fetchImdbId(name) === currentId) {
                  console.log(`[过滤] 智能探测命中: ${name} -> ${currentId}`);
                  isMatch = true; break;
                }
              }
            }
          }
        }

        if (!isMatch) {
          console.log(`[过滤] 未命中目标清单，跳过处理: ${currentId}`);
          $done({}); return;
        }

        // 季节检查 (仅在 ID 匹配通过后执行)
        if (config.target_season && currentSeason) {
          const seasons = parseSeasonRange(config.target_season);
          if (!seasons.includes(currentSeason)) {
            console.log(`[过滤] 季不匹配: 当前 ${currentSeason}, 目标季 ${seasons.join(',')}`);
            $done({}); return;
          }
        }
      }
      // 情况 3: 开关未打开 -> 直接匹配所有 (跳过上面的 ID 过滤块)

      let obj = JSON.parse($response.body);
      const seg = (s, e) => ({ "start_sec": s, "end_sec": e, "start_ms": s * 1000, "end_ms": e * 1000, "confidence": 1, "submission_count": 3 });
      let mod = false;

      if (config.intro_on && !obj.intro) {
        console.log(`正在填补 Intro: ${config.intro_s}-${config.intro_e}`);
        obj.intro = seg(config.intro_s, config.intro_e); mod = true;
      }
      if (config.recap_on && !obj.recap) {
        console.log(`正在填补 Recap: ${config.recap_s}-${config.recap_e}`);
        obj.recap = seg(config.recap_s, config.recap_e); mod = true;
      }
      if (config.outro_on && !obj.outro) {
        console.log(`正在填补 Outro: ${config.outro_s}-${config.outro_e}`);
        obj.outro = seg(config.outro_s, config.outro_e); mod = true;
      }

      if (mod) {
        console.log("--- IntroDB 数据补全完成 ---");
        $done({ body: JSON.stringify(obj) });
      } else {
        console.log("无需补全 (开关未开启或数据已存在)"); $done({});
      }
    } catch (e) {
      console.log("处理出错: " + e.message); $done({});
    }
  })();

  function parseTime(t) {
    if (t === undefined || t === null) return 0;
    let s = t.toString().trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let p = s.split(':').map(v => parseInt(v, 10) || 0);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return parseInt(s, 10) || 0;
  }

  function parseSeasonRange(str) {
    let seasons = [];
    str.split(',').forEach(item => {
      item = item.trim();
      if (item.includes('-')) {
        let [s, e] = item.split('-').map(n => parseInt(n.trim(), 10));
        for (let i = Math.min(s, e); i <= Math.max(s, e); i++) seasons.push(i.toString());
      } else if (item) { seasons.push(item); }
    });
    return seasons;
  }

  /**
   * 根据查询词（名称 @ 年份）获取 IMDb ttID
   */
  async function fetchImdbId(queryStr) {
    const PROTECTION_ID = "tt6953912";
    const [title, year] = queryStr.split('@').map(s => s.trim());

    return new Promise((resolve) => {
      if (!title) { resolve(PROTECTION_ID); return; }

      const q = encodeURIComponent(`${title} ${year || ""}`.trim());
      const url = `https://www.imdb.com/find?q=${q}&s=tt&ttype=tv`;
      console.log(`[IMDb 探测] 正在搜寻: ${title} ${year || ""}`);

      $.get({
        url,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
      }, (error, response, data) => {
        if (error || (response && response.status !== 200)) {
          console.log(`[IMDb 探测] 请求失败 ${error || response.status}，返回保护 ID`);
          resolve(PROTECTION_ID); return;
        }

        try {
          const match = data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
          if (match && match[1]) {
            const results = JSON.parse(match[1]).props.pageProps.titleResults.results;
            if (results && results.length > 0 && results[0].listItem) {
              const res = results[0].listItem;
              console.log(`[IMDb 探测] ✅ 命中: ${res.titleText} (${res.releaseYear}) -> ${res.titleId}`);
              resolve(res.titleId); return;
            }
          }
        } catch (e) { }

        const regexMatch = data.match(/\/title\/(tt\d+)\//);
        if (regexMatch && regexMatch[1]) {
          console.log(`[IMDb 探测] ✅ 正则命中: ${regexMatch[1]}`);
          resolve(regexMatch[1]);
        } else {
          console.log(`[IMDb 探测] ⚠️ 未找到结果，返回保护 ID`);
          resolve(PROTECTION_ID);
        }
      });
    });
  }
})();


function Env(name, opts) {
  class Http {
    constructor(env) {
      this.env = env
    }

    send(opts, method = 'GET') {
      opts = typeof opts === 'string' ? { url: opts } : opts
      let sender = this.get
      if (method === 'POST') {
        sender = this.post
      }

      const delayPromise = (promise, delay = 1000) => {
        return Promise.race([
          promise,
          new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('请求超时'))
            }, delay)
          })
        ])
      }

      const call = new Promise((resolve, reject) => {
        sender.call(this, opts, (err, resp, body) => {
          if (err) reject(err)
          else resolve(resp)
        })
      })

      return opts.timeout ? delayPromise(call, opts.timeout) : call
    }

    get(opts) {
      return this.send.call(this.env, opts)
    }

    post(opts) {
      return this.send.call(this.env, opts, 'POST')
    }
  }

  return new (class {
    constructor(name, opts) {
      this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }
      this.logLevelPrefixs = {
        debug: '[DEBUG] ',
        info: '[INFO] ',
        warn: '[WARN] ',
        error: '[ERROR] '
      }
      this.logLevel = 'info'
      this.name = name
      this.http = new Http(this)
      this.data = null
      this.dataFile = 'box.dat'
      this.logs = []
      this.isMute = false
      this.isNeedRewrite = false
      this.logSeparator = '\n'
      this.encoding = 'utf-8'
      this.startTime = new Date().getTime()
      Object.assign(this, opts)
      this.log('', `🔔${this.name}, 开始!`)
    }

    getEnv() {
      if ('undefined' !== typeof $environment && $environment['surge-version'])
        return 'Surge'
      if ('undefined' !== typeof $environment && $environment['stash-version'])
        return 'Stash'
      if ('undefined' !== typeof module && !!module.exports) return 'Node.js'
      if ('undefined' !== typeof $task) return 'Quantumult X'
      if ('undefined' !== typeof $loon) return 'Loon'
      if ('undefined' !== typeof $rocket) return 'Shadowrocket'
    }

    isNode() {
      return 'Node.js' === this.getEnv()
    }

    isQuanX() {
      return 'Quantumult X' === this.getEnv()
    }

    isSurge() {
      return 'Surge' === this.getEnv()
    }

    isLoon() {
      return 'Loon' === this.getEnv()
    }

    isShadowrocket() {
      return 'Shadowrocket' === this.getEnv()
    }

    isStash() {
      return 'Stash' === this.getEnv()
    }

    toObj(str, defaultValue = null) {
      try {
        return JSON.parse(str)
      } catch {
        return defaultValue
      }
    }

    toStr(obj, defaultValue = null, ...args) {
      try {
        return JSON.stringify(obj, ...args)
      } catch {
        return defaultValue
      }
    }

    getjson(key, defaultValue) {
      let json = defaultValue
      const val = this.getdata(key)
      if (val) {
        try {
          json = JSON.parse(this.getdata(key))
        } catch { }
      }
      return json
    }

    setjson(val, key) {
      try {
        return this.setdata(JSON.stringify(val), key)
      } catch {
        return false
      }
    }

    getScript(url) {
      return new Promise((resolve) => {
        this.get({ url }, (err, resp, body) => resolve(body))
      })
    }

    runScript(script, runOpts) {
      return new Promise((resolve) => {
        let httpapi = this.getdata('@chavy_boxjs_userCfgs.httpapi')
        httpapi = httpapi ? httpapi.replace(/\n/g, '').trim() : httpapi
        let httpapi_timeout = this.getdata(
          '@chavy_boxjs_userCfgs.httpapi_timeout'
        )
        httpapi_timeout = httpapi_timeout ? httpapi_timeout * 1 : 20
        httpapi_timeout =
          runOpts && runOpts.timeout ? runOpts.timeout : httpapi_timeout
        const [key, addr] = httpapi.split('@')
        const opts = {
          url: `http://${addr}/v1/scripting/evaluate`,
          body: {
            script_text: script,
            mock_type: 'cron',
            timeout: httpapi_timeout
          },
          headers: {
            'X-Key': key,
            'Accept': '*/*'
          },
          policy: 'DIRECT',
          timeout: httpapi_timeout
        }
        this.post(opts, (err, resp, body) => resolve(body))
      }).catch((e) => this.logErr(e))
    }

    loaddata() {
      if (this.isNode()) {
        this.fs = this.fs ? this.fs : require('fs')
        this.path = this.path ? this.path : require('path')
        const curDirDataFilePath = this.path.resolve(this.dataFile)
        const rootDirDataFilePath = this.path.resolve(
          process.cwd(),
          this.dataFile
        )
        const isCurDirDataFile = this.fs.existsSync(curDirDataFilePath)
        const isRootDirDataFile =
          !isCurDirDataFile && this.fs.existsSync(rootDirDataFilePath)
        if (isCurDirDataFile || isRootDirDataFile) {
          const datPath = isCurDirDataFile
            ? curDirDataFilePath
            : rootDirDataFilePath
          try {
            return JSON.parse(this.fs.readFileSync(datPath))
          } catch (e) {
            return {}
          }
        } else return {}
      } else return {}
    }

    writedata() {
      if (this.isNode()) {
        this.fs = this.fs ? this.fs : require('fs')
        this.path = this.path ? this.path : require('path')
        const curDirDataFilePath = this.path.resolve(this.dataFile)
        const rootDirDataFilePath = this.path.resolve(
          process.cwd(),
          this.dataFile
        )
        const isCurDirDataFile = this.fs.existsSync(curDirDataFilePath)
        const isRootDirDataFile =
          !isCurDirDataFile && this.fs.existsSync(rootDirDataFilePath)
        const jsondata = JSON.stringify(this.data)
        if (isCurDirDataFile) {
          this.fs.writeFileSync(curDirDataFilePath, jsondata)
        } else if (isRootDirDataFile) {
          this.fs.writeFileSync(rootDirDataFilePath, jsondata)
        } else {
          this.fs.writeFileSync(curDirDataFilePath, jsondata)
        }
      }
    }

    lodash_get(source, path, defaultValue = undefined) {
      const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.')
      let result = source
      for (const p of paths) {
        result = Object(result)[p]
        if (result === undefined) {
          return defaultValue
        }
      }
      return result
    }

    lodash_set(obj, path, value) {
      if (Object(obj) !== obj) return obj
      if (!Array.isArray(path)) path = path.toString().match(/[^.[\]]+/g) || []
      path
        .slice(0, -1)
        .reduce(
          (a, c, i) =>
            Object(a[c]) === a[c]
              ? a[c]
              : (a[c] = Math.abs(path[i + 1]) >> 0 === +path[i + 1] ? [] : {}),
          obj
        )[path[path.length - 1]] = value
      return obj
    }

    getdata(key) {
      let val = this.getval(key)
      // 如果以 @
      if (/^@/.test(key)) {
        const [, objkey, paths] = /^@(.*?)\.(.*?)$/.exec(key)
        const objval = objkey ? this.getval(objkey) : ''
        if (objval) {
          try {
            const objedval = JSON.parse(objval)
            val = objedval ? this.lodash_get(objedval, paths, '') : val
          } catch (e) {
            val = ''
          }
        }
      }
      return val
    }

    setdata(val, key) {
      let issuc = false
      if (/^@/.test(key)) {
        const [, objkey, paths] = /^@(.*?)\.(.*?)$/.exec(key)
        const objdat = this.getval(objkey)
        const objval = objkey
          ? objdat === 'null'
            ? null
            : objdat || '{}'
          : '{}'
        try {
          const objedval = JSON.parse(objval)
          this.lodash_set(objedval, paths, val)
          issuc = this.setval(JSON.stringify(objedval), objkey)
        } catch (e) {
          const objedval = {}
          this.lodash_set(objedval, paths, val)
          issuc = this.setval(JSON.stringify(objedval), objkey)
        }
      } else {
        issuc = this.setval(val, key)
      }
      return issuc
    }

    getval(key) {
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
          return $persistentStore.read(key)
        case 'Quantumult X':
          return $prefs.valueForKey(key)
        case 'Node.js':
          this.data = this.loaddata()
          return this.data[key]
        default:
          return (this.data && this.data[key]) || null
      }
    }

    setval(val, key) {
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
          return $persistentStore.write(val, key)
        case 'Quantumult X':
          return $prefs.setValueForKey(val, key)
        case 'Node.js':
          this.data = this.loaddata()
          this.data[key] = val
          this.writedata()
          return true
        default:
          return (this.data && this.data[key]) || null
      }
    }

    initGotEnv(opts) {
      this.got = this.got ? this.got : require('got')
      this.cktough = this.cktough ? this.cktough : require('tough-cookie')
      this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar()
      if (opts) {
        opts.headers = opts.headers ? opts.headers : {}
        if (opts) {
          opts.headers = opts.headers ? opts.headers : {}
          if (
            undefined === opts.headers.cookie &&
            undefined === opts.headers.Cookie &&
            undefined === opts.cookieJar
          ) {
            opts.cookieJar = this.ckjar
          }
        }
      }
    }

    get(request, callback = () => { }) {
      if (request.headers) {
        delete request.headers['Content-Type']
        delete request.headers['Content-Length']

        // HTTP/2 全是小写
        delete request.headers['content-type']
        delete request.headers['content-length']
      }
      if (request.params) {
        request.url += '?' + this.queryStr(request.params)
      }
      // followRedirect 禁止重定向
      if (
        typeof request.followRedirect !== 'undefined' &&
        !request['followRedirect']
      ) {
        if (this.isSurge() || this.isLoon()) request['auto-redirect'] = false // Surge & Loon
        if (this.isQuanX())
          request.opts
            ? (request['opts']['redirection'] = false)
            : (request.opts = { redirection: false }) // Quantumult X
      }
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
        default:
          if (this.isSurge() && this.isNeedRewrite) {
            request.headers = request.headers || {}
            Object.assign(request.headers, { 'X-Surge-Skip-Scripting': false })
          }
          $httpClient.get(request, (err, resp, body) => {
            if (!err && resp) {
              resp.body = body
              resp.statusCode = resp.status ? resp.status : resp.statusCode
              resp.status = resp.statusCode
            }
            callback(err, resp, body)
          })
          break
        case 'Quantumult X':
          if (this.isNeedRewrite) {
            request.opts = request.opts || {}
            Object.assign(request.opts, { hints: false })
          }
          $task.fetch(request).then(
            (resp) => {
              const {
                statusCode: status,
                statusCode,
                headers,
                body,
                bodyBytes
              } = resp
              callback(
                null,
                { status, statusCode, headers, body, bodyBytes },
                body,
                bodyBytes
              )
            },
            (err) => callback((err && err.error) || 'UndefinedError')
          )
          break
        case 'Node.js':
          let iconv = require('iconv-lite')
          this.initGotEnv(request)
          this.got(request)
            .on('redirect', (resp, nextOpts) => {
              try {
                if (resp.headers['set-cookie']) {
                  const ck = resp.headers['set-cookie']
                    .map(this.cktough.Cookie.parse)
                    .toString()
                  if (ck) {
                    this.ckjar.setCookieSync(ck, null)
                  }
                  nextOpts.cookieJar = this.ckjar
                }
              } catch (e) {
                this.logErr(e)
              }
              // this.ckjar.setCookieSync(resp.headers['set-cookie'].map(Cookie.parse).toString())
            })
            .then(
              (resp) => {
                const {
                  statusCode: status,
                  statusCode,
                  headers,
                  rawBody
                } = resp
                const body = iconv.decode(rawBody, this.encoding)
                callback(
                  null,
                  { status, statusCode, headers, rawBody, body },
                  body
                )
              },
              (err) => {
                const { message: error, response: resp } = err
                callback(
                  error,
                  resp,
                  resp && iconv.decode(resp.rawBody, this.encoding)
                )
              }
            )
          break
      }
    }

    post(request, callback = () => { }) {
      const method = request.method
        ? request.method.toLocaleLowerCase()
        : 'post'

      // 如果指定了请求体, 但没指定 `Content-Type`、`content-type`, 则自动生成。
      if (
        request.body &&
        request.headers &&
        !request.headers['Content-Type'] &&
        !request.headers['content-type']
      ) {
        // HTTP/1、HTTP/2 都支持小写 headers
        request.headers['content-type'] = 'application/x-www-form-urlencoded'
      }
      // 为避免指定错误 `content-length` 这里删除该属性，由工具端 (HttpClient) 负责重新计算并赋值
      if (request.headers) {
        delete request.headers['Content-Length']
        delete request.headers['content-length']
      }
      // followRedirect 禁止重定向
      if (
        typeof request.followRedirect !== 'undefined' &&
        !request['followRedirect']
      ) {
        if (this.isSurge() || this.isLoon()) request['auto-redirect'] = false // Surge & Loon
        if (this.isQuanX())
          request.opts
            ? (request['opts']['redirection'] = false)
            : (request.opts = { redirection: false }) // Quantumult X
      }
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
        default:
          if (this.isSurge() && this.isNeedRewrite) {
            request.headers = request.headers || {}
            Object.assign(request.headers, { 'X-Surge-Skip-Scripting': false })
          }
          $httpClient[method](request, (err, resp, body) => {
            if (!err && resp) {
              resp.body = body
              resp.statusCode = resp.status ? resp.status : resp.statusCode
              resp.status = resp.statusCode
            }
            callback(err, resp, body)
          })
          break
        case 'Quantumult X':
          request.method = method
          if (this.isNeedRewrite) {
            request.opts = request.opts || {}
            Object.assign(request.opts, { hints: false })
          }
          $task.fetch(request).then(
            (resp) => {
              const {
                statusCode: status,
                statusCode,
                headers,
                body,
                bodyBytes
              } = resp
              callback(
                null,
                { status, statusCode, headers, body, bodyBytes },
                body,
                bodyBytes
              )
            },
            (err) => callback((err && err.error) || 'UndefinedError')
          )
          break
        case 'Node.js':
          let iconv = require('iconv-lite')
          this.initGotEnv(request)
          const { url, ..._request } = request
          this.got[method](url, _request).then(
            (resp) => {
              const { statusCode: status, statusCode, headers, rawBody } = resp
              const body = iconv.decode(rawBody, this.encoding)
              callback(
                null,
                { status, statusCode, headers, rawBody, body },
                body
              )
            },
            (err) => {
              const { message: error, response: resp } = err
              callback(
                error,
                resp,
                resp && iconv.decode(resp.rawBody, this.encoding)
              )
            }
          )
          break
      }
    }
    /**
     *
     * 示例:$.time('yyyy-MM-dd qq HH:mm:ss.S')
     *    :$.time('yyyyMMddHHmmssS')
     *    y:年 M:月 d:日 q:季 H:时 m:分 s:秒 S:毫秒
     *    其中y可选0-4位占位符、S可选0-1位占位符，其余可选0-2位占位符
     * @param {string} fmt 格式化参数
     * @param {number} 可选: 根据指定时间戳返回格式化日期
     *
     */
    time(fmt, ts = null) {
      const date = ts ? new Date(ts) : new Date()
      let o = {
        'M+': date.getMonth() + 1,
        'd+': date.getDate(),
        'H+': date.getHours(),
        'm+': date.getMinutes(),
        's+': date.getSeconds(),
        'q+': Math.floor((date.getMonth() + 3) / 3),
        'S': date.getMilliseconds()
      }
      if (/(y+)/.test(fmt))
        fmt = fmt.replace(
          RegExp.$1,
          (date.getFullYear() + '').substr(4 - RegExp.$1.length)
        )
      for (let k in o)
        if (new RegExp('(' + k + ')').test(fmt))
          fmt = fmt.replace(
            RegExp.$1,
            RegExp.$1.length == 1
              ? o[k]
              : ('00' + o[k]).substr(('' + o[k]).length)
          )
      return fmt
    }

    /**
     *
     * @param {Object} options
     * @returns {String} 将 Object 对象 转换成 queryStr: key=val&name=senku
     */
    queryStr(options) {
      let queryString = ''

      for (const key in options) {
        let value = options[key]
        if (value != null && value !== '') {
          if (typeof value === 'object') {
            value = JSON.stringify(value)
          }
          queryString += `${key}=${value}&`
        }
      }
      queryString = queryString.substring(0, queryString.length - 1)

      return queryString
    }

    /**
     * 系统通知
     *
     * > 通知参数: 同时支持 QuanX 和 Loon 两种格式, EnvJs根据运行环境自动转换, Surge 环境不支持多媒体通知
     *
     * 示例:
     * $.msg(title, subt, desc, 'twitter://')
     * $.msg(title, subt, desc, { 'open-url': 'twitter://', 'media-url': 'https://github.githubassets.com/images/modules/open_graph/github-mark.png' })
     * $.msg(title, subt, desc, { 'open-url': 'https://bing.com', 'media-url': 'https://github.githubassets.com/images/modules/open_graph/github-mark.png' })
     *
     * @param {*} title 标题
     * @param {*} subt 副标题
     * @param {*} desc 通知详情
     * @param {*} opts 通知参数
     *
     */
    msg(title = name, subt = '', desc = '', opts = {}) {
      const toEnvOpts = (rawopts) => {
        const { $open, $copy, $media, $mediaMime } = rawopts
        switch (typeof rawopts) {
          case undefined:
            return rawopts
          case 'string':
            switch (this.getEnv()) {
              case 'Surge':
              case 'Stash':
              default:
                return { url: rawopts }
              case 'Loon':
              case 'Shadowrocket':
                return rawopts
              case 'Quantumult X':
                return { 'open-url': rawopts }
              case 'Node.js':
                return undefined
            }
          case 'object':
            switch (this.getEnv()) {
              case 'Surge':
              case 'Stash':
              case 'Shadowrocket':
              default: {
                const options = {}

                // 打开URL
                let openUrl =
                  rawopts.openUrl || rawopts.url || rawopts['open-url'] || $open
                if (openUrl)
                  Object.assign(options, { action: 'open-url', url: openUrl })

                // 粘贴板
                let copy =
                  rawopts['update-pasteboard'] ||
                  rawopts.updatePasteboard ||
                  $copy
                if (copy) {
                  Object.assign(options, { action: 'clipboard', text: copy })
                }

                // 图片通知
                let mediaUrl = rawopts.mediaUrl || rawopts['media-url'] || $media
                if (mediaUrl) {
                  let media = undefined
                  let mime = undefined
                  // http 开头的网络地址
                  if (mediaUrl.startsWith('http')) {
                    //不做任何操作
                  }
                  // 带标识的 Base64 字符串
                  // data:image/png;base64,iVBORw0KGgo...
                  else if (mediaUrl.startsWith('data:')) {
                    const [data] = mediaUrl.split(';')
                    const [, base64str] = mediaUrl.split(',')
                    media = base64str
                    mime = data.replace('data:', '')
                  }
                  // 没有标识的 Base64 字符串
                  // iVBORw0KGgo...
                  else {
                    // https://stackoverflow.com/questions/57976898/how-to-get-mime-type-from-base-64-string
                    const getMimeFromBase64 = (encoded) => {
                      const signatures = {
                        'JVBERi0': 'application/pdf',
                        'R0lGODdh': 'image/gif',
                        'R0lGODlh': 'image/gif',
                        'iVBORw0KGgo': 'image/png',
                        '/9j/': 'image/jpg'
                      }
                      for (var s in signatures) {
                        if (encoded.indexOf(s) === 0) {
                          return signatures[s]
                        }
                      }
                      return null
                    }
                    media = mediaUrl
                    mime = getMimeFromBase64(mediaUrl)
                  }

                  Object.assign(options, {
                    'media-url': mediaUrl,
                    'media-base64': media,
                    'media-base64-mime': $mediaMime ?? mime
                  })
                }

                Object.assign(options, {
                  'auto-dismiss': rawopts['auto-dismiss'],
                  'sound': rawopts['sound']
                })
                return options
              }
              case 'Loon': {
                const options = {}

                let openUrl =
                  rawopts.openUrl || rawopts.url || rawopts['open-url'] || $open
                if (openUrl) Object.assign(options, { openUrl })

                let mediaUrl = rawopts.mediaUrl || rawopts['media-url'] || $media
                if (mediaUrl) Object.assign(options, { mediaUrl })

                console.log(JSON.stringify(options))
                return options
              }
              case 'Quantumult X': {
                const options = {}

                let openUrl =
                  rawopts['open-url'] || rawopts.url || rawopts.openUrl || $open
                if (openUrl) Object.assign(options, { 'open-url': openUrl })

                let mediaUrl = rawopts.mediaUrl || rawopts['media-url'] || $media
                if (mediaUrl) Object.assign(options, { 'media-url': mediaUrl })

                let copy =
                  rawopts['update-pasteboard'] ||
                  rawopts.updatePasteboard ||
                  $copy
                if (copy) Object.assign(options, { 'update-pasteboard': copy })

                console.log(JSON.stringify(options))
                return options
              }
              case 'Node.js':
                return undefined
            }
          default:
            return undefined
        }
      }
      if (!this.isMute) {
        switch (this.getEnv()) {
          case 'Surge':
          case 'Loon':
          case 'Stash':
          case 'Shadowrocket':
          default:
            $notification.post(title, subt, desc, toEnvOpts(opts))
            break
          case 'Quantumult X':
            $notify(title, subt, desc, toEnvOpts(opts))
            break
          case 'Node.js':
            break
        }
      }
      if (!this.isMuteLog) {
        let logs = ['', '==============📣系统通知📣==============']
        logs.push(title)
        subt ? logs.push(subt) : ''
        desc ? logs.push(desc) : ''
        console.log(logs.join('\n'))
        this.logs = this.logs.concat(logs)
      }
    }

    debug(...logs) {
      if (this.logLevels[this.logLevel] <= this.logLevels.debug) {
        if (logs.length > 0) {
          this.logs = [...this.logs, ...logs]
        }
        console.log(
          `${this.logLevelPrefixs.debug}${logs.map((l) => l ?? String(l)).join(this.logSeparator)}`
        )
      }
    }

    info(...logs) {
      if (this.logLevels[this.logLevel] <= this.logLevels.info) {
        if (logs.length > 0) {
          this.logs = [...this.logs, ...logs]
        }
        console.log(
          `${this.logLevelPrefixs.info}${logs.map((l) => l ?? String(l)).join(this.logSeparator)}`
        )
      }
    }

    warn(...logs) {
      if (this.logLevels[this.logLevel] <= this.logLevels.warn) {
        if (logs.length > 0) {
          this.logs = [...this.logs, ...logs]
        }
        console.log(
          `${this.logLevelPrefixs.warn}${logs.map((l) => l ?? String(l)).join(this.logSeparator)}`
        )
      }
    }

    error(...logs) {
      if (this.logLevels[this.logLevel] <= this.logLevels.error) {
        if (logs.length > 0) {
          this.logs = [...this.logs, ...logs]
        }
        console.log(
          `${this.logLevelPrefixs.error}${logs.map((l) => l ?? String(l)).join(this.logSeparator)}`
        )
      }
    }

    log(...logs) {
      if (logs.length > 0) {
        this.logs = [...this.logs, ...logs]
      }
      console.log(logs.map((l) => l ?? String(l)).join(this.logSeparator))
    }

    logErr(err, msg) {
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
        case 'Quantumult X':
        default:
          this.log('', `❗️${this.name}, 错误!`, msg, err)
          break
        case 'Node.js':
          this.log(
            '',
            `❗️${this.name}, 错误!`,
            msg,
            typeof err.message !== 'undefined' ? err.message : err,
            err.stack
          )
          break
      }
    }

    wait(time) {
      return new Promise((resolve) => setTimeout(resolve, time))
    }

    done(val = {}) {
      const endTime = new Date().getTime()
      const costTime = (endTime - this.startTime) / 1000
      this.log('', `🔔${this.name}, 结束! 🕛 ${costTime} 秒`)
      this.log()
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        case 'Stash':
        case 'Shadowrocket':
        case 'Quantumult X':
        default:
          $done(val)
          break
        case 'Node.js':
          process.exit(1)
      }
    }
  })(name, opts)
}
