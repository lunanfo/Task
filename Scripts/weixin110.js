/*
 * 微信拦截页提取链接并发送通知
 * 支持：Loon / Surge / Quantumult X / Shadowrocket
 *
 * ============================================================
 * Loon 3.5.1 (983)+
 * ============================================================
 *
 * [Script]
 * response if ${url} ~= /^https?:\/\/weixin110\.qq\.com\/cgi-bin\/mmspamsupport-bin\/newredirectconfirmcgi/i then script("https://raw.githubusercontent.com/lunanfo/Task/main/Scripts/weixin110.js") with tag="微信解封跳转", requires_body=true
 *
 * [MITM]
 * hostname = weixin110.qq.com
 *
 *
 * ============================================================
 * Surge
 * ============================================================
 *
 * [Script]
 * weixin-redirect = type=http-response,pattern=^https?:\/\/weixin110\.qq\.com\/cgi-bin\/mmspamsupport-bin\/newredirectconfirmcgi,script-path=https://raw.githubusercontent.com/lunanfo/Task/main/Scripts/weixin110.js,requires-body=true
 *
 * [MITM]
 * hostname = %APPEND% weixin110.qq.com
 *
 *
 * ============================================================
 * Quantumult X
 * ============================================================
 *
 * [rewrite_local]
 * ^https?:\/\/weixin110\.qq\.com\/cgi-bin\/mmspamsupport-bin\/newredirectconfirmcgi url script-response-body https://raw.githubusercontent.com/lunanfo/Task/main/Scripts/weixin110.js
 *
 * [mitm]
 * hostname = weixin110.qq.com
 *
 *
 * ============================================================
 * Shadowrocket
 * ============================================================
 *
 * [Script]
 * 微信跳转 = type=http-response,pattern=^https?:\/\/weixin110\.qq\.com\/cgi-bin\/mmspamsupport-bin\/newredirectconfirmcgi,script-path=https://raw.githubusercontent.com/lunanfo/Task/main/Scripts/weixin110.js,requires-body=true
 *
 * [MITM]
 * hostname = %APPEND% weixin110.qq.com
 */

const body = $response.body;

if (body) {
    // 提取目标链接
    const match = body.match(/:&#x2f;&#x2f;(\S*)"}/);

    if (match && match[1]) {
        const str = match[1]
            .replace(/&#x2f;/g, "/")
            .replace(/&amp;/g, "&")
            .split('"')[0];

        const isTaobao = str.includes("m.tb.cn");

        const opener = isTaobao
            ? `taobao://${str}`
            : `https://${str}`;

        const message = isTaobao
            ? "🛍️点击打开淘宝"
            : "🔗点击打开链接";

        notify("", "", message, opener);
    }
}

// 保持原始拦截页
$done({ body });


function notify(title, subtitle, message, url) {

    // Quantumult X
    if (typeof $task !== "undefined") {
        $notify(title, subtitle, message, {
            "open-url": url
        });
        return;
    }

    // Loon
    if (typeof $loon !== "undefined") {
        $notification.post(title, subtitle, message, {
            openUrl: url
        });
        return;
    }

    // Surge / Shadowrocket
    if (typeof $notification !== "undefined") {
        $notification.post(title, subtitle, message, {
            url: url
        });
    }
}