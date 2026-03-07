/**
 * @file intro_fix.js
 * @description Intro 增强脚本：触发 IntroDB 降级 TIDB，并修复 TIDB 适配问题。
 * 兼容 Surge, Loon, Quantumult X
 */

const isQX = typeof $task !== "undefined";
const isLoon = typeof $loon !== "undefined";
const isSurge = typeof $httpClient !== "undefined" && !isLoon;

function complete(obj) {
    if (typeof $done !== "undefined") {
        $done(obj);
    }
}

function main() {
    if (typeof $response === "undefined") {
        complete({});
        return;
    }

    const url = $request.url;
    let body = $response.body;

    if (!body) {
        complete({});
        return;
    }

    try {
        let obj = JSON.parse(body);
        let modified = false;

        if (url.includes("api.introdb.app")) {
            // Requirement 1: When intro is null, set recap and outro to null
            if (obj.intro === null) {
                console.log("[IntroDB Fix] Intro is null, setting recap and outro to null");
                obj.recap = null;
                obj.outro = null;
                modified = true;
            }
        } else if (url.includes("api.theintrodb.org")) {
            // Requirement 2: Handle null start_ms/end_ms
            // Notice: Based on user screenshot, intro and credits are arrays of objects

            const fixSegments = (array, startField, endField, startValue, endValue) => {
                let mod = false;
                if (Array.isArray(array)) {
                    array.forEach(item => {
                        if (startField && item[startField] === null) {
                            item[startField] = startValue;
                            mod = true;
                        }
                        if (endField && item[endField] === null) {
                            item[endField] = endValue;
                            mod = true;
                        }
                    });
                } else if (array && typeof array === 'object') {
                    // Fallback for single object format
                    if (startField && array[startField] === null) { array[startField] = startValue; mod = true; }
                    if (endField && array[endField] === null) { array[endField] = endValue; mod = true; }
                }
                return mod;
            };

            if (fixSegments(obj.intro, "start_ms", "end_ms", 0, 9999)) modified = true;
            if (fixSegments(obj.credits, "start_ms", "end_ms", 0, 9999)) modified = true;

            // Handle if the root is an array
            if (Array.isArray(obj)) {
                obj.forEach(item => {
                    if (fixSegments(item.intro, "start_ms", "end_ms", 0, 9999)) modified = true;
                    if (fixSegments(item.credits, "start_ms", "end_ms", 0, 9999)) modified = true;
                });
            }
        }

        if (modified) {
            complete({ body: JSON.stringify(obj) });
        } else {
            complete({});
        }
    } catch (e) {
        console.log("[IntroDB Fix] Error parsing response body: " + e);
        complete({});
    }
}

main();
