/**
 * @file introdb_segments.js
 */

(function () {
    const isRequest = typeof $request !== 'undefined' && typeof $response === 'undefined';
    const phase = isRequest ? "请求中" : "响应中";

    // --- 核心参数解析 (适配 Loon 列表、Surge 键值对、手写快捷) ---
    let args = {};
    if (typeof $argument === 'string' && $argument.trim()) {
        const argStr = $argument.trim();
        if (argStr.includes('=')) {
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
    } else if (typeof $argument === 'object') {
        args = $argument;
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

            $httpClient.get({
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
