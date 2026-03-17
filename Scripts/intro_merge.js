/**
 * @file intro_merge.js
 * @description Intro 增强脚本：合并 IntroDB 与 TheIntroDB 数据，确保跳过片段完整性。
 * 兼容 Surge, Loon, Quantumult X
 */

// ================= 配置区 =================
/**  数据优先级策略：
* 0: TheIntroDB 优先 (仅在缺失时补漏)
* 1: IntroDB 优先 (强制覆盖 TheIntroDB 的数据)
*/
let PRIORITY_MODE = 1;

// 动态获取用户配置参数 (适配 Loon & Surge)
const priorityArg = typeof $argument !== "undefined" ? $argument : null;
if (priorityArg) {
    const cleanArg = priorityArg.toLowerCase().replace(/\s+/g, '');
    if (cleanArg.includes("theintrodb")) {
        PRIORITY_MODE = 0;
    } else if (cleanArg.includes("introdb")) {
        PRIORITY_MODE = 1;
    }
}
// =========================================

const isQX = typeof $task !== "undefined";
const isLoon = typeof $loon !== "undefined";
const isSurge = typeof $httpClient !== "undefined" && !isLoon;

const CACHE_KEY = "IntroDB_Cache";

/**
 * 持久化存储工具
 */
const storage = {
    read: (key) => {
        if (isLoon) return $persistentStore.read(key);
        if (isSurge) return $persistentStore.read(key);
        if (isQX) return $prefs.valueForKey(key);
    },
    write: (val, key) => {
        if (isLoon) return $persistentStore.write(val, key);
        if (isSurge) return $persistentStore.write(val, key);
        if (isQX) return $prefs.setValueForKey(val, key);
    }
};

function complete(obj) {
    if (typeof $done !== "undefined") {
        $done(obj);
    }
}

/**
 * 修复片段中的 null 值 (0/99999999 修正)
 * 支持数组和单个对象
 */
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

/**
 * 确保返回值为数组格式 (适配 TheIntroDB 结构)
 */
function ensureArray(val) {
    if (val === null || val === undefined) return [];
    if (Array.isArray(val)) return val;
    return [val];
}

/**
 * 从 URL 中提取参数 (适配 ID/季/集)
 */
function getUrlParam(url, name) {
    const reg = new RegExp(`[?&]${name}=([^&#]*)`, 'i');
    const m = url.match(reg);
    return m ? (isNaN(m[1]) ? m[1] : parseInt(m[1])) : null;
}

/**
 * 转换 IntroDB 片段项为 TheIntroDB 格式项
 * 仅保留两者共有的核心字段，过滤掉 introdb 特有的 start_sec/updated_at 等
 */
function mapSegmentItem(item) {
    if (item && typeof item === 'object') {
        let res = {
            start_ms: item.start_ms,
            end_ms: item.end_ms
        };
        if (item.confidence !== undefined) res.confidence = item.confidence;
        if (item.submission_count !== undefined) res.submission_count = item.submission_count;
        return res;
    }
    return null;
}

/**
 * 处理单个 Episode 对象 (遵循 TheIntroDB 格式规范)
 */
function processEpisode(episode, cacheObj) {
    // 1. 合并与映射逻辑：IntroDB 缓存优先，并映射 Outro -> Credits
    if (cacheObj) {
        // 判断逻辑：强制覆盖模式 OR 目标数据缺失
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

function main() {
    // 基础校验：确保是在响应脚本语境下运行
    if (typeof $request === "undefined" || typeof $response === "undefined") {
        return complete({});
    }

    const url = $request.url;
    let body = $response.body;
    let statusCode = $response.statusCode || 200;
    const currentKey = getCacheKey(url);

    try {
        if (url.includes("api.introdb.app")) {
            if (!body) return complete({});
            let obj = JSON.parse(body);

            // Case A: 数据全，直接返回 (保持 IntroDB 格式)
            if (obj.intro !== null && obj.outro !== null) {
                console.log("[IntroDB Fix] IntroDB data is complete, passing through.");
                return complete({});
            }

            // Case B: 数据不全，缓存并置空触发 Failover
            console.log(`[IntroDB Fix] IntroDB data incomplete, caching to ${currentKey}.`);
            storage.write(JSON.stringify({
                intro: obj.intro,
                outro: obj.outro,
                recap: obj.recap
            }), currentKey);

            // 强制置空核心项 (引导 App)
            obj.intro = null;
            obj.recap = null;
            obj.outro = null;
            complete({ body: JSON.stringify(obj) });

        } else if (url.includes("api.theintrodb.org")) {
            let cacheRaw = storage.read(currentKey);
            let cacheObj = cacheRaw ? JSON.parse(cacheRaw) : null;
            let obj = null;

            // 清理缓存
            storage.write("", currentKey);

            // Case D: Server Error (4xx/5xx) 或 空响应，且有缓存
            const isErrorStatus = (statusCode >= 400);

            if ((isErrorStatus || !body) && cacheObj) {
                console.log(`[IntroDB Fix] TheIntroDB error (Status: ${statusCode}), using cache ${currentKey}.`);
                statusCode = 200;
                // 仿真 TheIntroDB 响应：提取 ID 和基础信息
                obj = processEpisode({
                    "tmdb_id": getUrlParam(url, "tmdb_id"),
                    "season": getUrlParam(url, "season"),
                    "episode": getUrlParam(url, "episode"),
                    "type": "tv",
                    "recap": []
                }, cacheObj);
            } else if (body) {
                try {
                    obj = JSON.parse(body);
                    // 处理 Root 为数组或对象的情况
                    if (Array.isArray(obj)) {
                        obj.forEach(item => processEpisode(item, cacheObj));
                    } else {
                        processEpisode(obj, cacheObj);
                    }
                } catch (parseError) {
                    // 如果 body 无法解析且有缓存，退而求其次使用缓存
                    if (cacheObj) {
                        console.log(`[IntroDB Fix] Invalid JSON from TheIntroDB, using cache ${currentKey}.`);
                        obj = processEpisode({ intro: [], credits: [], recap: [] }, cacheObj);
                        statusCode = 200;
                    } else {
                        console.log("[IntroDB Fix] Parse Error and no cache, passing through.");
                        return complete({});
                    }
                }
            } else {
                return complete({});
            }

            complete({
                status: statusCode,
                body: JSON.stringify(obj)
            });
        } else {
            // URL 不匹配，直接释放
            complete({});
        }
    } catch (e) {
        console.log("[IntroDB Fix] Runtime Error: " + e);
        complete({});
    }
}

main();
