//#!desc=Unlock Infuse Adult Capture
//To modify the request parameters for Infuse, you can use a script to intercept and modify the request. Here's an example of how you can adjust the query parameter &include_adult=true:

/*
surge example:

[rewrite_local]
UnlockInfuseAdultCapture = type=http-request, pattern=^https:\/\/movie\-api\.infuse\.im\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?), script-path=https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js
UnlockInfuseAdultCapture = type=http-request, pattern=^https:\/\/api\.themoviedb\.org\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?), script-path=https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js

loon example:

[rewrite_local]
http-request ^https:\/\/movie\-api\.infuse\.im\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?) tag=UnlockInfuseAdultCapture, script-path=https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js
http-request ^https:\/\/api\.themoviedb\.org\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?) tag=UnlockInfuseAdultCapture, script-path=https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js


QX Script Example:

[rewrite_local]
^https:\/\/movie\-api\.infuse\.im\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?) url script-request-header https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js
^https:\/\/api\.themoviedb\.org\/3\/(?:movie\/\d+\?|search\/movie\?|tv\/\d+\?|search\/tv\?) url script-request-header https://github.com/lunanfo/Task/raw/refs/heads/main/Scripts/uiac.js


#[mitm]
hostname = movie-api.infuse.im, api.themoviedb.org
*/




let url = $request.url;

if (url.includes("include_adult=false")) {
    // 若原带有 include_adult=false，直接予以纠正
    url = url.replace("include_adult=false", "include_adult=true");
} else if (!url.includes("include_adult=true")) {
    // 防止末尾出现 '?&' 的丑陋组合。如果连 '?' 也没有，则补全 '?'
    const separator = /[?&]$/.test(url) ? '' : (url.includes('?') ? '&' : '?');
    url += separator + "include_adult=true";
}

$done({ url });


//This script checks if &include_adult=true is already present in the request. If not, it appends it to the URL.