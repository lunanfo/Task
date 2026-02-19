/**
 * @file imdb_lookup.js
 * @desc 通过 IMDb 搜索页面爬取 ttID。支持多结果带标题/年份输出、Loon、Surge 及 Node.js。
 */

// ================= [使用说明] =================
// 1. 如果你在 Loon/Surge 的“参数(Argument)”输入框中填写，格式支持：
//    - 快捷格式：最后生还者, 2023  (直接填 剧名, 年份 即可)
//    - 标准格式：Title=最后生还者, Year=2023
//
// 2. 如果你在脚本内手动修改（不使用 UI 参数），请修改下方的 MANUAL_CONFIG：
// ===============================================

// ================= [用户配置区] =================
const MANUAL_CONFIG = {
    title: "最后生还者", // 剧集名称 (支持中英文)
    year: "2023"        // 发行年份 (可选，不填请留空 "")
};
// ===============================================

(function () {
    // --- 环境检测与 Mock ---
    const isLoon = typeof $loon !== "undefined";
    const isSurge = typeof $httpClient !== "undefined" && !isLoon;
    const isNode = typeof process !== "undefined" && !isLoon && !isSurge;

    let _argument = {};
    let _httpClient = null;
    let _notification = null;
    let _done = null;

    if (isNode) {
        const nodeArgs = process.argv.slice(2);
        _argument = {
            Title: nodeArgs[0] || MANUAL_CONFIG.title,
            Year: nodeArgs[1] || MANUAL_CONFIG.year
        };
        const https = require('https');
        _httpClient = {
            get: (options, callback) => {
                const fetch = (url) => {
                    https.get(url, { headers: options.headers }, (res) => {
                        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                            let newUrl = res.headers.location;
                            if (!newUrl.startsWith('http')) {
                                const origin = new URL(url).origin;
                                newUrl = origin + newUrl;
                            }
                            return fetch(newUrl);
                        }
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => callback(null, { status: res.statusCode }, data));
                    }).on('error', (err) => callback(err));
                };
                fetch(options.url);
            }
        };
        _notification = { post: (t, s, m) => console.log(`\n🔔 [通知] ${t} - ${s}: ${m}`) };
        _done = (obj) => { process.exit(); };
    } else {
        _httpClient = $httpClient;
        _notification = $notification;
        _done = $done;

        // 解析 Loon/Surge 传参
        let fromArg = false;
        if (typeof $argument !== 'undefined' && $argument !== null) {
            if (typeof $argument === 'string') {
                if ($argument.includes('=')) {
                    // 模式 A：Key=Value 格式
                    $argument.split(/[&,]/).forEach(item => {
                        let [key, val] = item.split('=');
                        if (key) _argument[key.trim()] = val ? val.trim() : true;
                    });
                } else if ($argument.trim().length > 0) {
                    // 模式 B：纯字符串格式 "剧名, 年份"
                    let parts = $argument.split(/[&,]/);
                    _argument.Title = parts[0] ? parts[0].trim() : "";
                    _argument.Year = parts[1] ? parts[1].trim() : "";
                }
                fromArg = !!(_argument.Title);
            } else if (typeof $argument === 'object' && Object.keys($argument).length > 0) {
                // 模式 C：Loon 对象模式
                _argument = $argument;
                fromArg = true;
            }
        }

        if (!fromArg || (!_argument.Title && !MANUAL_CONFIG.title)) {
            _argument.Title = _argument.Title || MANUAL_CONFIG.title;
            _argument.Year = _argument.Year || MANUAL_CONFIG.year;
        }
    }

    // --- 核心逻辑 ---
    const searchName = (_argument.Title || "").trim();
    const searchYear = (_argument.Year || "").trim();

    console.log("\n" + "=".repeat(15) + " IMDb Debug 模式 " + "=".repeat(15));
    console.log(`[参数接收] 名称: "${searchName}", 年份: "${searchYear}"`);

    if (!searchName) {
        console.log("❌ 错误：未检测到有效剧名");
        if (_notification) _notification.post("IMDb 探测器", "错误", "请配置剧集名称");
        _done({}); return;
    }

    // 构造搜索 URL
    const query = encodeURIComponent(`${searchName} ${searchYear}`.trim());
    const searchUrl = `https://www.imdb.com/find?q=${query}&s=tt&ttype=tv`;

    console.log(`[网络请求] 目标 URL: ${searchUrl}`);

    const options = {
        url: searchUrl,
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
    };

    _httpClient.get(options, (error, response, data) => {
        if (error) {
            console.log("❌ 网络请求失败: " + error);
            _done({}); return;
        }

        console.log(`[响应状态] HTTP Status: ${response.status}`);

        if (response.status !== 200) {
            console.log(`❌ 异常：服务器返回 ${response.status}`);
            _done({}); return;
        }

        let foundResults = [];

        // 尝试解析 __NEXT_DATA__
        try {
            const nextDataMatch = data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (nextDataMatch && nextDataMatch[1]) {
                const jsonData = JSON.parse(nextDataMatch[1]);
                const results = jsonData.props.pageProps.titleResults.results;
                if (results && Array.isArray(results)) {
                    results.slice(0, 5).forEach(item => {
                        if (item.listItem) {
                            foundResults.push({
                                id: item.listItem.titleId || "",
                                title: item.listItem.titleText || "未知标题",
                                year: item.listItem.releaseYear || "未知年份"
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.log(`[解析提示] 尝试 JSON 解析失败，切换至备用正则模式: ${e.message}`);
        }

        // 备用方案：简单正则匹配（只能拿到 ID，拿不到准确标题/年份）
        if (foundResults.length === 0) {
            const regex = /\/title\/(tt\d+)\//g;
            let match;
            let seen = new Set();
            while ((match = regex.exec(data)) !== null && seen.size < 5) {
                if (!seen.has(match[1])) {
                    seen.add(match[1]);
                    foundResults.push({ id: match[1], title: "匹配结果", year: "?" });
                }
            }
        }

        if (foundResults.length > 0) {
            console.log(`✅ [提取成功] 共找到 ${foundResults.length} 个相关条目`);

            // 通知显示第一个
            const first = foundResults[0];
            if (_notification) _notification.post("IMDb 探测器", searchName, `找到 ${foundResults.length} 个结果\n首选: ${first.title} (${first.year}) - ${first.id}`);

            console.log("\n" + "*".repeat(10) + " 搜索详细结果 (前5项) " + "*".repeat(10));
            foundResults.forEach((res, index) => {
                console.log(` [${index + 1}] ID: ${res.id} | 标题: ${res.title} | 年份: ${res.year}`);
            });
            console.log("*".repeat(36) + "\n");
        } else {
            console.log("⚠️ [匹配失败] 未发现匹配的结果。可能是名称太模糊或 IMDb 结构变化。");
            if (_notification) _notification.post("IMDb 探测器", "未找到结果", "请检查名称后重试");
        }

        console.log("=".repeat(40) + "\n");
        _done({});
    });
})();
