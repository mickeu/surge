/*
 * 内存流量Tailscale实时监控（Memory Traffic）v37
 *
 * 内存 + 流量 + Tailscale 状态卡。
 * Tailscale 段完全按「Tailscale 状态」卡的标准呈现：
 *   会话状态 / 本机 / DERP / 出口 / 流量（含 TCP、UDP 连接数）/ 设备在线数与直连中继分布 / 设备列表。
 * 不再统计各设备入站流量，也不再采样请求列表，面板一次取数直接出结果。
 *
 * 数据来源：
 *   GET  /v1/metrics                          —— 内存、运行时间、接口总流量
 *   POST /v1/mcp  get_proxy_runtime_status    —— Tailscale 会话、DERP、出口、peer 路径
 *
 * 策略名自动发现：参数 policy 留空时，从当前 Profile 的 `xxx = tailscale` 策略行取，
 * 结果缓存到持久化状态；策略改名或换配置后调用失败会自动重新探测一次。
 * 入站设备名单取自该策略运行时的 peer 列表，新设备上线即出现，无需在参数页填写任何设备。
 *
 * ⚠️ 依赖 http-api-mcp：Surge → 设置 → HTTP API → 勾选 MCP。
 *    未开启时 Tailscale 段显示「不可用」，内存与流量不受影响。
 *
 * ⚠️ Tailscale 入站设备访问被本机 MITM 的域名需在本机 Surge 导出 CA 证书并装到入站设备，
 *    否则这些域名在该设备上会握手失败（典型：入站设备打不开苹果天气）。
 */

var DEFAULT_API_HOST = "127.0.0.1";
var DEFAULT_API_PORT = "6171";
var DEFAULT_API_KEY = "surgetest";
var REQUEST_TIMEOUT = 5;
var STATE_KEY = "MemoryTrafficTailscale";

var DERP_CITY = {
    nyc: "纽约", sfo: "旧金山", lax: "洛杉矶", sea: "西雅图", dfw: "达拉斯",
    ord: "芝加哥", mia: "迈阿密", atl: "亚特兰大", den: "丹佛", sjc: "圣何塞",
    tor: "多伦多", yyz: "多伦多", hkg: "香港", tok: "东京", sin: "新加坡",
    syd: "悉尼", blr: "班加罗尔", fra: "法兰克福", nue: "纽伦堡",
    ams: "阿姆斯特丹", lhr: "伦敦", par: "巴黎", mad: "马德里", waw: "华沙",
    sto: "斯德哥尔摩", sao: "圣保罗", dbi: "巴厘岛", hnl: "檀香山",
    jnb: "约翰内斯堡", hel: "赫尔辛基", vie: "维也纳", prg: "布拉格",
    tpe: "台北", sel: "首尔", bom: "孟买", dxb: "迪拜", kix: "大阪"
};

function isFiniteNumber(value) {
    return isFinite(Number(value));
}

function formatBytes(value) {
    if (!isFiniteNumber(value)) {
        return "—";
    }

    var bytes = Math.max(0, Number(value));
    var units = ["B", "KB", "MB", "GB", "TB"];
    var unitIndex = 0;

    while (bytes >= 1024 && unitIndex < units.length - 1) {
        bytes /= 1024;
        unitIndex++;
    }

    return bytes.toFixed(2) + " " + units[unitIndex];
}

function formatUptime(value) {
    if (!isFiniteNumber(value)) {
        return "—";
    }

    var seconds = Math.max(0, Math.floor(Number(value)));
    var days = Math.floor(seconds / 86400);
    seconds -= days * 86400;

    var hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;

    var minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;

    var parts = [];
    if (days > 0) {
        parts.push(days + "天");
    }
    if (hours > 0 || days > 0) {
        parts.push(hours + "小时");
    }
    if (minutes > 0 || hours > 0 || days > 0) {
        parts.push(minutes + "分钟");
    }
    if (parts.length === 0) {
        parts.push(seconds + "秒");
    }

    return parts.join(" ");
}

function parseMetrics(text) {
    var metrics = [];
    var lines = String(text).split(/\r?\n/);
    var metricPattern =
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/;
    var labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.charAt(0) === "#") {
            continue;
        }

        var match = line.match(metricPattern);
        if (!match) {
            continue;
        }

        var labels = {};
        var labelText = match[2] || "";
        var labelMatch;

        labelPattern.lastIndex = 0;
        while ((labelMatch = labelPattern.exec(labelText)) !== null) {
            labels[labelMatch[1]] = labelMatch[2]
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
        }

        metrics.push({
            name: match[1],
            labels: labels,
            value: Number(match[3])
        });
    }

    return metrics;
}

function getMetric(metrics, metricName) {
    for (var i = 0; i < metrics.length; i++) {
        if (metrics[i].name === metricName) {
            return metrics[i];
        }
    }
    return null;
}

function sumMetrics(metrics, metricName) {
    var total = 0;
    var found = false;

    for (var i = 0; i < metrics.length; i++) {
        if (metrics[i].name === metricName && isFiniteNumber(metrics[i].value)) {
            // 排除回环接口，避免把 Surge 自身流量算进来
            if (metrics[i].labels && metrics[i].labels.interface === "lo0") {
                continue;
            }
            total += Number(metrics[i].value);
            found = true;
        }
    }

    return found ? total : NaN;
}

function parseArgument(arg) {
    var result = {};
    if (typeof arg === "string") {
        arg.split(/[&,;]/).forEach(function (part) {
            var idx = part.indexOf("=");
            if (idx > 0) {
                result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
            }
        });
    } else if (arg && typeof arg === "object") {
        for (var key in arg) {
            result[key] = arg[key];
        }
    }
    return result;
}

// peer 名带 MagicDNS 后缀（iphone-12.tailf4e00c.ts.net），面板上只显示短名
function shortPeerName(name) {
    return String(name || "").split(".")[0].trim();
}

var CITY_SHORT = {
    nue: "纽伦", sfo: "旧金", lax: "洛城", ams: "阿姆", sjc: "圣何",
    sto: "斯德", jnb: "约堡", blr: "班加", fra: "法兰", hkg: "香港",
    nyc: "纽约", tok: "东京", sin: "新加坡", syd: "悉尼", tor: "多伦",
    ord: "芝加哥", dfw: "达拉斯", mia: "迈阿密", sea: "西雅图", lhr: "伦敦",
    par: "巴黎", mad: "马德里", waw: "华沙", sao: "圣保罗", dbi: "巴厘"
};

function shortCity(code) {
    var k = String(code || "").toLowerCase();
    return CITY_SHORT[k] || derpCity(code);
}

function derpCity(code) {
    if (!code) {
        return "未知";
    }
    return DERP_CITY[String(code).toLowerCase()] || String(code).toUpperCase();
}

// 面板用系统比例字体：名字补空格必须按字宽估算，不能按字符数。
// 半角空格在 SF Pro 里约 0.26em，全角空格 1em，用两者组合逼近目标宽度。
var CHAR_WIDTH = {
    i: 0.264, l: 0.264, j: 0.264, t: 0.335, f: 0.335, r: 0.365,
    s: 0.5, e: 0.556, o: 0.579, n: 0.565, u: 0.565, p: 0.579,
    h: 0.565, a: 0.55, b: 0.579, c: 0.53, d: 0.579, g: 0.579,
    k: 0.53, v: 0.51, x: 0.5, y: 0.5, z: 0.48, q: 0.579,
    ".": 0.26, ",": 0.26, "-": 0.34, "_": 0.5, " ": 0.23,
    m: 0.878, w: 0.75, M: 0.88, W: 0.95
};

function textWidth(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (CHAR_WIDTH[ch] !== undefined) {
            total += CHAR_WIDTH[ch];
        } else if (ch >= "0" && ch <= "9") {
            total += 0.55;
        } else if (ch >= "A" && ch <= "Z") {
            total += 0.62;
        } else {
            total += 0.55;
        }
    }
    return total;
}

function padToWidth(text, target) {
    // 只用半角空格：粒度 0.23em（0.26 偏左、0.22 偏右，取中）
    var rem = target - textWidth(text);
    var count = Math.round(rem / 0.23);
    if (count < 1) {
        count = 1;
    }
    var out = text;
    for (var i = 0; i < count; i++) {
        out += " ";
    }
    return out;
}

function loadState() {
    try {
        var raw = $persistentStore.read(STATE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                return parsed;
            }
        }
    } catch (e) {
        // 损坏的状态直接重建
    }
    return {};
}

function saveState(state) {
    try {
        $persistentStore.write(JSON.stringify(state), STATE_KEY);
    } catch (e) {
        // 写入失败不影响面板
    }
}

var finished = false;

function finishPanel(title, content, style, icon, iconColor) {
    if (finished) {
        return;
    }
    finished = true;

    var result = { title: title, content: content };
    if (style) {
        result.style = style;
    }
    if (icon) {
        result.icon = icon;
    }
    if (iconColor) {
        result["icon-color"] = iconColor;
    }

    $done(result);
}

var sgFallbackTimer = setTimeout(function () {
    finishPanel(
        "内存流量Tailscale实时监控",
        "请求超时",
        "error",
        "exclamationmark.triangle.fill",
        "#FF3B30"
    );
}, 15000);

var argument = parseArgument(typeof $argument === "undefined" ? "" : $argument);
var apiHost = String(argument.api_host || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST;
var apiPort = String(argument.api_port || DEFAULT_API_PORT).trim() || DEFAULT_API_PORT;
var apiKey = String(argument.api_key || DEFAULT_API_KEY).trim() || DEFAULT_API_KEY;
var metricsUrl = "http://" + apiHost + ":" + apiPort + "/v1/metrics";
var policyArgument = String(argument.policy || "").trim();
// 参数口留占位词时一律走自动探测
if (/^(自动|auto|选填|留空自动识别)$/.test(policyArgument)) {
    policyArgument = "";
}

var metricsBody = null;
var metricsError = null;
var runtime = null;
var runtimeError = null;

// $httpAPI 直连引擎：不产生真实请求，不会把「最近请求」窗口刷满
function apiGet(path, callback) {
    try {
        $httpAPI("GET", path, null, function (result) {
            var payload = result;
            if (typeof payload === "string") {
                try {
                    payload = JSON.parse(payload);
                } catch (e) {
                    callback("返回非 JSON", null);
                    return;
                }
            }
            callback(null, payload);
        });
    } catch (e) {
        callback(String(e), null);
    }
}

function mcpCall(tool, toolArguments, callback) {
    try {
        $httpAPI(
            "POST",
            "/v1/mcp",
            {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name: tool, arguments: toolArguments }
            },
            function (result) {
                var payload = result;
                if (typeof payload === "string") {
                    try {
                        payload = JSON.parse(payload);
                    } catch (e) {
                        callback("MCP 返回非 JSON", null);
                        return;
                    }
                }
                if (!payload) {
                    callback("MCP 无响应", null);
                    return;
                }
                if (payload.error) {
                    callback("MCP " + (payload.error.message || "错误"), null);
                    return;
                }
                var content = payload.result && payload.result.content;
                var text = content && content[0] ? content[0].text : null;
                if (!text) {
                    callback("MCP 空结果", null);
                    return;
                }
                try {
                    callback(null, JSON.parse(text));
                } catch (e) {
                    callback("MCP 结果解析失败", null);
                }
            }
        );
    } catch (e) {
        callback(String(e), null);
    }
}

// 策略名自动发现：参数 > 缓存 > 当前 Profile 的 `xxx = tailscale` 行
function resolvePolicyName(callback) {
    if (policyArgument) {
        callback(policyArgument, true);
        return;
    }
    var state = loadState();
    if (state.tsPolicy) {
        callback(state.tsPolicy, true);
        return;
    }
    apiGet("/v1/profiles/current?sensitive=0", function (err, result) {
        if (err || !result) {
            callback(null, false);
            return;
        }
        var text = result.profile || result.originalProfile || "";
        var match = String(text).match(/(?:^|\n)\s*([^=\n\[\]#][^=\n]*?)\s*=\s*tailscale\b/i);
        var name = match && match[1] ? match[1].trim() : null;
        if (name) {
            var state2 = loadState();
            state2.tsPolicy = name;
            saveState(state2);
        }
        callback(name, true);
    });
}

function loadRuntime(callback) {
    resolvePolicyName(function (policy, resolved) {
        if (!policy) {
            runtimeError = "当前配置里没有 Tailscale 策略";
            callback();
            return;
        }
        mcpCall("get_proxy_runtime_status", { policy: policy }, function (err, data) {
            if (err || !data || !data.tailscale) {
                // 缓存的策略名失效（改名/换配置）时清掉缓存，下次重新从 Profile 探测
                if (resolved && !policyArgument) {
                    var state = loadState();
                    state.tsPolicy = null;
                    saveState(state);
                }
                runtimeError = err || "策略无 Tailscale 运行时数据";
                callback();
                return;
            }
            runtime = data;
            runtimeError = null;
            callback();
        });
    });
}

function tailscaleLines() {
    var lines = [];

    if (!runtime) {
        lines.push("Tailscale 状态 · 不可用");
        if (runtimeError) {
            lines.push(runtimeError);
        }
        return lines;
    }

    var ts = runtime.tailscale || {};
    var peers = ts.peers || [];
    var online = [];
    var offlineWithHistory = 0;
    var direct = 0;
    var relay = 0;

    for (var i = 0; i < peers.length; i++) {
        var peer = peers[i];
        if (peer.online) {
            online.push(peer);
            if (peer.status === "direct") {
                direct++;
            } else {
                relay++;
            }
        } else {
            offlineWithHistory++;
        }
    }

    var state = ts.state || "未知";
    var stage = ts.controlStage || "";

    lines.push("Tailscale 状态 · " + state);
    lines.push("状态：" + state + (stage ? " · " + stage : ""));

    lines.push("本机：" + (ts.selfIPv4 || "—"));

    var derpConnections = ts.derpConnections || [];
    var derpConnected = 0;
    for (var d = 0; d < derpConnections.length; d++) {
        if (derpConnections[d].connected) {
            derpConnected++;
        }
    }
    var stArea = loadState();
    if (ts.homeDERPRegionCode) {
        stArea.lastArea = {
            code: ts.homeDERPRegionCode,
            id: ts.homeDERPRegionID,
            conn: derpConnected,
            total: derpConnections.length
        };
        saveState(stArea);
    }
    var area = ts.homeDERPRegionCode
        ? { code: ts.homeDERPRegionCode, id: ts.homeDERPRegionID,
            conn: derpConnected, total: derpConnections.length }
        : (stArea.lastArea || null);
    var areaText = area && area.code
        ? derpCity(area.code) + " #" + (area.id === undefined ? "?" : area.id)
        : "—";
    var areaConn = area ? area.conn + "/" + area.total : "0/0";
    lines.push("区域：" + areaText + " · " + areaConn + " 连");

    var exit = ts.exitNode || {};
    var exitText = "未使用";
    if (exit.enabled && exit.status !== "disabled") {
        exitText = exit.selector && exit.selector !== "auto" ? exit.selector : "自动";
    } else if (exit.status && exit.status !== "disabled") {
        exitText = exit.status;
    }
    lines.push("出口：" + exitText + (exit.status ? " (" + exit.status + ")" : ""));

    var tcp = ts.activeTCPConnections === undefined ? "—" : ts.activeTCPConnections;
    var udp = ts.activeUDPConnections === undefined ? "—" : ts.activeUDPConnections;
    lines.push("连接：TCP " + tcp + " / UDP " + udp);

    lines.push(
        "设备：" + online.length + "/" + peers.length + " 在线 · 直连 " + direct + " / 中继 " + relay
    );

    online.sort(function (a, b) {
        var la = typeof a.lastActivityAgo === "number" ? a.lastActivityAgo : 1e9;
        var lb = typeof b.lastActivityAgo === "number" ? b.lastActivityAgo : 1e9;
        return la - lb;
    });

    var nameTarget = 0;
    for (var n = 0; n < online.length; n++) {
        var nw = textWidth(shortPeerName(online[n].name));
        if (nw > nameTarget) nameTarget = nw;
    }
    nameTarget = Math.ceil((nameTarget + 1.6) * 10) / 10;

    var listed = 0;
    for (var o = 0; o < online.length && listed < 6; o++) {
        var item = online[o];
        // 面板纯文本无行内着色；emoji 上色会把点撑大，改用与正文同号的实心/空心圆
        var isDirect = item.status === "direct";
        // 中文等宽：把「中继/直连」放行首固定前缀，设备名随后，两列都不用猜空格宽度。
        // 城市与延迟用空格连在一起，省掉一个「 · 」宽度，保证长名字行不折行。
        var line = (isDirect ? "● 直连" : "○ 中继") + " · " + shortPeerName(item.name);
        if (!isDirect) {
            line += " " + shortCity(item.derpRegionCode);
        }
        // 中继时 Surge 不总给 peer 级延迟，用 netcheck 测到的该 DERP 区域 RTT 近似
        var regionLat = (ts.netcheck && ts.netcheck.regionLatencyMs) || {};
        var lat = typeof item.latencyMs === "number"
            ? item.latencyMs
            : regionLat[String(item.derpRegionID)];
        if (typeof lat === "number" && lat > 0) {
            line += " " + Math.round(lat) + "ms";
        }
        lines.push(line);
        listed++;
    }

    var hidden = online.length - listed;
    if (hidden > 0) {
        lines.push("… 其余 " + hidden + " 台在线设备未显示");
    } else if (online.length === 0) {
        lines.push("（无在线设备）");
    }

    return lines;
}

function render() {
    if (finished) {
        return;
    }
    if (metricsError) {
        finishPanel(
            "内存流量Tailscale实时监控",
            "无法获取数据\n\n" + String(metricsError),
            "error",
            "exclamationmark.triangle.fill",
            "#FF3B30"
        );
        return;
    }

    var metrics = parseMetrics(metricsBody || "");
    var buildInfo = getMetric(metrics, "surge_build_info");
    var uptime = getMetric(metrics, "surge_uptime_seconds");
    var memory = getMetric(metrics, "surge_memory_bytes");

    var version = buildInfo && buildInfo.labels.version ? buildInfo.labels.version : "未知";
    var build = buildInfo && buildInfo.labels.build ? buildInfo.labels.build : "未知";

    var download = sumMetrics(metrics, "surge_interface_in_bytes_total");
    var upload = sumMetrics(metrics, "surge_interface_out_bytes_total");

    // Surge iOS 引擎进程的内存上限按 50 MB 计，十格条形即占用百分比
    var memoryBytes = memory && isFiniteNumber(memory.value) ? Number(memory.value) : NaN;
    var memoryBar = "";
    if (isFiniteNumber(memoryBytes)) {
        var MEMORY_LIMIT = 50 * 1024 * 1024;
        var pct = Math.max(0, Math.min(100, Math.round((memoryBytes / MEMORY_LIMIT) * 100)));
        var filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
        for (var fi = 0; fi < 10; fi++) {
            memoryBar += fi < filled ? "▰" : "▱";
        }
        memoryBar = " " + memoryBar + " " + pct + "%";
    }

    var lines = [
        "内存： " + formatBytes(memoryBytes) + memoryBar,
        "运行： " + formatUptime(uptime ? uptime.value : NaN),
        "流量： ↓ " + formatBytes(download) + " ↑ " + formatBytes(upload),
        ""
    ];

    var tsLines = tailscaleLines();
    for (var i = 0; i < tsLines.length; i++) {
        lines.push(tsLines[i]);
    }

    lines.push("");
    lines.push("Surge " + version + " · Build " + build);

    finishPanel("内存流量Tailscale实时监控", lines.join("\n"), null, "chart.bar.xaxis", "#4A90E2");
}

function requestMetrics(key, callback) {
    $httpClient.get(
        {
            url: metricsUrl,
            timeout: REQUEST_TIMEOUT,
            headers: { Accept: "text/plain", "X-Key": key }
        },
        function (error, response, body) {
            if (error) {
                callback(String(error), null);
            } else if (response && response.status && (response.status < 200 || response.status >= 300)) {
                callback("Metrics HTTP " + response.status, null);
            } else if (!body) {
                callback("Metrics 返回为空", null);
            } else {
                callback(null, body);
            }
        }
    );
}

// api_key 大小写误填（surgeTest）会 401，Surge iOS 默认口令是小写 surgetest，自动降级重试
function loadMetrics() {
    requestMetrics(apiKey, function (err, body) {
        if (err && String(err).indexOf("401") >= 0 && apiKey !== "surgetest") {
            requestMetrics("surgetest", function (err2, body2) {
                if (!err2) {
                    metricsBody = body2;
                } else {
                    metricsError = err2;
                }
                loadRuntime(render);
            });
            return;
        }
        if (err) {
            metricsError = err;
        } else {
            metricsBody = body;
        }
        loadRuntime(render);
    });
}

loadMetrics();
