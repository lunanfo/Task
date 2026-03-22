/**
 * @file emby-search-modifier.js
 * @description 修改 Emby 搜索参数，支持通过特殊符号指定搜索类型：@ 电影，$ 剧集，# 播放列表，! 合集
 * 💡 提示：本脚本默认仅对 Infuse App 生效，以减少对浏览器和其他软件及其性能的干扰。
 * 💡 调试模式：开启后，脚本将对所有 App 和浏览器访问全量生效。
 */

/*
[rewrite_local]
# Surge
EmbySearchModifier = type=http-request, pattern=^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!], script-path=https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

# Loon
http-request ^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!] tag=EmbySearchModifier, script-path=https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

# Quantumult X
^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!] url script-request-header https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

[mitm]
#hostname = *.your-emby-server.com //在hostname中添加你的emby服务器地址
*/
let url = $request.url;
const headers = $request.headers || {};

// 1. 获取调试模式参数
let DEBUG_MODE = false;
const argumentStr = typeof $argument !== 'undefined' ? $argument : "";
if (argumentStr.includes("debug=true") || argumentStr.includes("debug=1")) {
    DEBUG_MODE = true;
}

// 2. 三重 UA 安全提取与 Infuse 专属过滤
const userAgent = (headers['User-Agent'] || headers['user-agent'] || headers['User-agent'] || "").toLowerCase();

// 如果未开启调试模式，且不是 Infuse，则直接放行
if (!DEBUG_MODE && !userAgent.includes("infuse")) {
    $done({});
} else {
    const movieRegex = new RegExp('SearchTerm=@([^&]*)', 'g');
    const seriesRegex = new RegExp('SearchTerm=\\$([^&]*)', 'g');
    const playlistRegex = new RegExp('SearchTerm=#([^&]*)', 'g');
    const boxsetRegex = new RegExp('SearchTerm=!([^&]*)', 'g');

    if (url.includes('SearchTerm=@')) {
        url = url.replace(movieRegex, (match, value) => { 
            return 'IncludeItemTypes=Movie&SearchTerm=' + value
        });
    } else if (url.includes('SearchTerm=$')) {
        url = url.replace(seriesRegex, (match, value) => { 
            return 'IncludeItemTypes=Series&SearchTerm=' + value
        });
    } else if (url.includes('SearchTerm=#')) {
        url = url.replace(playlistRegex, (match, value) => { 
            return 'IncludeItemTypes=Playlist&SearchTerm=' + value
        });
    } else if (url.includes('SearchTerm=!')) {
        url = url.replace(boxsetRegex, (match, value) => { 
            return 'IncludeItemTypes=BoxSet&SearchTerm=' + value
        });
    }
    $done({url: url});   // Return the modified URL
}
