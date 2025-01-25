//#!desc=Emby Search Type Modifier
//修改 Emby 搜索参数，支持不同类型的搜索：@ 电影，$ 剧集，# 播放列表，! 合集

/*
[rewrite_local]
# Surge
EmbySearchModifier = type=http-request, pattern=^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!], script-path=https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

# Loon
http-request ^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!] tag=EmbySearchModifier, script-path=https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

# Quantumult X
^https?:\/\/.*\/Items\?.*SearchTerm=[@$#!] url script-request-header https://raw.githubusercontent.com/lunanfo/Task/master/Scripts/emby-search-modifier.js

[mitm]
hostname = *.your-emby-server.com
*/

let url = $request.url;

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
