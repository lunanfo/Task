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
if (!url.includes("&include_adult=true")) {
    url += "&include_adult=true";  // Add the parameter if it's not already present
}
$done({url: url});  // Return the modified URL


//This script checks if &include_adult=true is already present in the request. If not, it appends it to the URL.