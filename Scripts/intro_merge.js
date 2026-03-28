/**
 * @file intro_merge.js
 * @description Intro 增强脚本：合并 IntroDB 与 TheIntroDB 数据。
 * 💡 提示：本脚本默认仅对 Infuse App 生效，以减少对浏览器和其他软件及其性能的干扰。
 * 💡 调试模式：开启后，脚本将对所有 App 和浏览器访问全量生效。
 */

const $ = new Env("IntroDB_Merge");

// ================= 配置区 =================
/**  数据优先级策略：
* 0: TheIntroDB 优先
* 1: IntroDB 优先 (强制覆盖 TheIntroDB 的数据)
*/
let PRIORITY_MODE = 1; // 1: introdb 优先, 0: theintrodb 优先
let TIDB_API_KEY = ""; // 存放 TheIntroDB API 密钥
let TIDB_API_KEY_ENABLED = false; // TIDB 密钥总开关 (默认关闭)
let DEBUG_MODE = false; // 调试模式：开启后对所有 App 生效

// 1. 动态获取环境原生参数 (Loon、Surge 传入形式)
let argumentStr = typeof $argument !== 'undefined' ? $argument : null;

if (typeof argumentStr === 'string' && argumentStr.trim()) {
  const argStr = argumentStr.trim();
  if (argStr.includes('=')) {
    // Surge / 键值对模式: priority=introdb, tidb_api_key=sk-...
    argStr.split(/[&,]/).forEach(item => {
      let [key, val] = item.split('=');
      if (key) {
        key = key.trim().toLowerCase();
        val = val ? val.trim() : "";
        if (key === 'priority' || key === 'intro_priority') {
          if (val === 'theintrodb') PRIORITY_MODE = 0;
          if (val === 'introdb') PRIORITY_MODE = 1;
        }
        if (key === 'tidb_api_key' || key === 'apikey' || key === 'api_key') {
          TIDB_API_KEY = val;
        }
        if (key === 'tidb_api_key_enabled' || key === 'apikey_enabled') {
          TIDB_API_KEY_ENABLED = (val === 'true' || val === '1' || val === '开启' || val === true);
        }
        if (key === 'debug' || key === 'debug_mode' || key === 'all_apps') {
          DEBUG_MODE = (val === 'true' || val === '1' || val === '开启' || val === true);
        }
      }
    });
  } else if (argStr.includes(',')) {
    // Loon / 顺序模式: theintrodb, sk-...
    const list = argStr.split(',').map(s => s.trim());
    if (list[0] && list[0].toLowerCase().includes("theintrodb")) PRIORITY_MODE = 0;
    if (list[1]) TIDB_API_KEY = list[1];
    if (list[2]) TIDB_API_KEY_ENABLED = (list[2].includes("true") || list[2] === "1" || list[2] === "开启");
    if (list[3]) DEBUG_MODE = (list[3].includes("true") || list[3] === "1" || list[3] === "开启");
  } else {
    // 极简兼容模式: 纯粹写了一个 theintrodb
    const cleanArg = argStr.toLowerCase().replace(/\s+/g, '');
    if (cleanArg.includes("theintrodb")) PRIORITY_MODE = 0;
  }
}

// 2. 获取 BoxJS 兜底统一配置
let boxjsPriority = $.getdata('intro_priority');
let boxjsApiKey = $.getdata('tidb_api_key');
let boxjsApiKeyEnabled = $.getdata('tidb_api_key_enabled');

// 若无原生优先级，下放至 BoxJS 取值
if (!argumentStr) {
  if (boxjsPriority && boxjsPriority.toLowerCase().includes("theintrodb")) {
    PRIORITY_MODE = 0;
  }
  if (boxjsApiKeyEnabled !== undefined && boxjsApiKeyEnabled !== null) {
    TIDB_API_KEY_ENABLED = (boxjsApiKeyEnabled === "true" || boxjsApiKeyEnabled === true);
  }
}
// API 密钥如果未通过参数传入，下放 BoxJS 取值
if (!TIDB_API_KEY && boxjsApiKey) {
  TIDB_API_KEY = boxjsApiKey.trim();
}
// BoxJS 调试模式读取
let boxjsDebug = $.getdata('intro_debug_mode');
if (!argumentStr && boxjsDebug !== undefined && boxjsDebug !== null) {
  DEBUG_MODE = (boxjsDebug === "true" || boxjsDebug === true);
}
// =========================================

const CACHE_KEY = "IntroDB_Cache";

/**
 * 持久化存储工具 (基于 Env.js 实现统一储存)
 */
const storage = {
  read: (key) => $.getdata(key),
  write: (val, key) => $.setdata(val, key)
};

function complete(obj) {
  $.done(obj);
}

/* 暂时注释掉处理null的代码（应用已可处理）
 * 修复片段中的 null 值 (0/99999999 修正)
 * 支持数组和单个对象
 *
function fixSegments(val, startField, endField, startValue, endValue) {
    let mod = false;
    const process = (item) => {
        if (item && typeof item === 'object') {
            if (startField && item[startField] === null) {
                item[startField] = startValue;
                mod = true;
            }
            if (endField && item[endField] === null) {
                item[endField] = endValue;
                mod = true;
            }
        }
    };

    if (Array.isArray(val)) {
        val.forEach(process);
    } else if (val) {
        process(val);
    }
    return mod;
}
*/

/**
 * 延迟等待辅助函数
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 从 URL 中提取参数 (适配 ID/季/集)
 */
function getUrlParam(url, name) {
  const reg = new RegExp(`[?&]${name}=([^&#]*)`, 'i');
  const m = url.match(reg);
  return m ? (isNaN(m[1]) ? m[1] : parseInt(m[1])) : null;
}

/**
 * 确保返回值为数组格式 (适配 TheIntroDB 结构)
 */
function ensureArray(val) {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/**
 * 转换 IntroDB 片段项为 TheIntroDB 格式项
 * 仅保留核心字段：start_ms, end_ms (新版 TIDB API 已弃用 confidence 等统计字段)
 */
function mapSegmentItem(item) {
  if (item && typeof item === 'object') {
    return {
      start_ms: item.start_ms,
      end_ms: item.end_ms
    };
  }
  return null;
}

/**
 * 处理单个 Episode 对象 (遵循 TheIntroDB 格式规范)
 * 注：TIDB 支持每个类型 (如 credits) 对应多个片段数组，而 IDB 目前通常仅为单个片段。
 * 本函数确保两者合并时，结果始终符合 TIDB 的多片段数组结构。
 */
function processEpisode(episode, cacheObj) {
  // 1. 合并与映射逻辑：根据优先级决定使用 TIDB 生成数据还是 IDB 缓存
  if (cacheObj) {
    // 判断逻辑：强制覆盖模式 (PRIORITY_MODE 1) OR 目标数据缺失 (TIDB 无数据)
    const shouldPatchIntro = (PRIORITY_MODE === 1) || (!episode.intro || episode.intro.length === 0);
    const shouldPatchCredits = (PRIORITY_MODE === 1) || (!episode.credits || episode.credits.length === 0);
    const shouldPatchRecap = (PRIORITY_MODE === 1) || (!episode.recap || episode.recap.length === 0);

    if (shouldPatchIntro && cacheObj.intro) {
      console.log(`[IntroDB Fix] Using IntroDB for INTRO (Mode: ${PRIORITY_MODE === 1 ? 'Override' : 'Patch'})`);
      episode.intro = ensureArray(cacheObj.intro).map(mapSegmentItem).filter(Boolean);
    }

    if (shouldPatchCredits && cacheObj.outro) {
      console.log(`[IntroDB Fix] Using IntroDB for CREDITS (Mode: ${PRIORITY_MODE === 1 ? 'Override' : 'Patch'})`);
      episode.credits = ensureArray(cacheObj.outro).map(mapSegmentItem).filter(Boolean);
    }

    if (shouldPatchRecap && cacheObj.recap) {
      console.log(`[IntroDB Fix] Using IntroDB for RECAP (Mode: ${PRIORITY_MODE === 1 ? 'Override' : 'Patch'})`);
      episode.recap = ensureArray(cacheObj.recap).map(mapSegmentItem).filter(Boolean);
    }
  }

  // 2. 0/99999999 修正与格式规范 (TheIntroDB 风格：无内容则不返回该字段)
  // 暂时注释掉处理null的代码，app已可以正常处理
  /*
  const fields = ["intro", "credits", "recap", "preview"];
  fields.forEach(field => {
      if (episode[field]) {
          const arr = ensureArray(episode[field]).filter(item => item !== null);
          if (arr.length > 0) {
              fixSegments(arr, "start_ms", "end_ms", 0, 99999999);
              episode[field] = arr;
          } else {
              delete episode[field];
          }
      } else {
          delete episode[field];
      }
  });
  */

  return episode;
}

/**
 * 获取基于季集的动态缓存 Key (适配 Infuse 多集同时请求)
 */
function getCacheKey(url) {
  const s = url.match(/[?&]season=(\d+)/);
  const e = url.match(/[?&]episode=(\d+)/);
  if (s && e) return `${CACHE_KEY}_${s[1]}_${e[1]}`;
  return CACHE_KEY;
}

async function main() {
  const isRequest = typeof $request !== "undefined" && typeof $response === "undefined";
  const url = $request.url;
  const headers = $request.headers || {};

  // 1. 三重 UA 安全提取与 Infuse 专属过滤
  const userAgent = (headers['User-Agent'] || headers['user-agent'] || headers['User-agent'] || "").toLowerCase();

  // 如果未开启调试模式，且不是 Infuse，则跳过
  if (!DEBUG_MODE && !userAgent.includes("infuse")) {
    return complete({});
  }

  // 2. 早期路径退出
  const isTIDB = url.indexOf("api.theintrodb.org") !== -1;
  const isIDB = url.indexOf("api.introdb.app") !== -1;
  if (!isTIDB && !isIDB) return complete({});

  // --- Request 阶段处理 (拦截并注入 API Key HEADER) ---
  if (isRequest) {
    if (isTIDB && url.indexOf("/v2/media") !== -1 && TIDB_API_KEY && TIDB_API_KEY_ENABLED) {
      headers["Authorization"] = `Bearer ${TIDB_API_KEY}`;
      console.log(`[Intro Merge] 已为 Infuse 注入 API Key.`);
      return complete({ headers });
    }
    return complete({});
  }

  // --- Response 阶段处理 (返回并合并最终数据) ---
  let body = $response.body;
  let statusCode = $response.statusCode || 200;
  const currentKey = getCacheKey(url);

  try {
    if (isIDB) {
      let idbCacheData = null;
      if (body) {
        try {
          let obj = JSON.parse(body);
          // 记录素材，准备 Yield 给 TIDB 处理
          idbCacheData = {
            intro: obj.intro,
            outro: obj.outro,
            recap: obj.recap
          };
          console.log(`[Intro Merge] IntroDB 素材已捕获，准备合并.`);
        } catch (e) {
          console.log(`[Intro Merge] IntroDB JSON 解析失败.`);
        }
      } else {
        console.log(`[Intro Merge] IntroDB 响应体为空.`);
      }

      // 无论是否有数据，都必须写入“已完成”标记，解除 TIDB 的等待
      storage.write(JSON.stringify({
        status: "finished",
        data: idbCacheData
      }), currentKey);

      // 始终将字段置空，强制播放器回退到 TIDB 响应中获取合并后的数据
      if (body) {
        let obj = JSON.parse(body);
        obj.intro = obj.recap = obj.outro = null;
        return complete({ body: JSON.stringify(obj) });
      }
      return complete({});

    } else if (isTIDB) {
      let cacheObj = null;
      let maxWait = 2500; // 最大等待 2.5 秒
      const interval = 150;

      // 轮询等待 IDB 的成果（或完成信号）
      console.log(`[Intro Merge] TIDB 正在等待 IDB 信号...`);
      while (maxWait > 0) {
        let cacheRaw = storage.read(currentKey);
        if (cacheRaw) {
          try {
            let parsed = JSON.parse(cacheRaw);
            if (parsed.status === "finished") {
              cacheObj = parsed.data;
              console.log(`[Intro Merge] 已命中 IDB 信号，总计等待 ${2500 - maxWait}ms.`);
              break;
            }
          } catch (e) { }
        }
        await sleep(interval);
        maxWait -= interval;
      }

      // 消耗掉缓存信号，防止下次误读
      storage.write("", currentKey);

      if ((statusCode >= 400 || !body) && cacheObj) {
        console.log(`[Intro Merge] TheIntroDB 异常 (Status: ${statusCode})，使用 IDB 兜底.`);
        statusCode = 200;
        let obj = processEpisode({
          "tmdb_id": getUrlParam(url, "tmdb_id"),
          "season": getUrlParam(url, "season"),
          "episode": getUrlParam(url, "episode"),
          "type": "tv",
          "recap": []
        }, cacheObj);
        return complete({ status: statusCode, body: JSON.stringify(obj) });
      }

      if (body) {
        try {
          let obj = JSON.parse(body);
          if (Array.isArray(obj)) {
            obj.forEach(item => processEpisode(item, cacheObj));
          } else {
            processEpisode(obj, cacheObj);
          }
          return complete({ status: statusCode, body: JSON.stringify(obj) });
        } catch (parseError) {
          if (cacheObj) {
            console.log(`[Intro Merge] TIDB JSON 解析失败，使用 IDB 强制合并.`);
            let obj = processEpisode({ intro: [], credits: [], recap: [] }, cacheObj);
            return complete({ status: 200, body: JSON.stringify(obj) });
          }
          return complete({});
        }
      }
    }
    complete({});
  } catch (e) {
    console.log("[Intro Merge] RuntimeError: " + e);
    complete({});
  }
}

(async () => {
  await main();
})().catch(e => {
  console.log("[Intro Merge] TopLevel Error: " + e);
  $.done({});
});


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
