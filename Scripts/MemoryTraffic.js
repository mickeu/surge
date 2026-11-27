/*
 * 内存和流量实时监控（Memory Traffic）v15
 *
 * 内存 + 本机流量 + Tailscale 运行状态面板。
 * Tailscale 部分按「Tailscale 状态」模块的标准呈现：会话状态、本机地址与名称、
 * DERP 区域与连接数、出口节点、策略流量、在线设备数与直连/中继分布、设备列表。
 * 入站设备全部自动识别（取自策略运行时的 peer 列表），不再需要在模块参数里手填设备名。
 *
 * 数据来源：
 *   GET  /v1/metrics                     —— 内存、运行时间、接口总流量
 *   POST /v1/mcp (get_proxy_runtime_status) —— Tailscale 会话、DERP、出口、peer 路径
 *   GET  /v1/requests/recent             —— 按 peer 名统计入站设备的连接与流量增量
 *
 * 累计说明：入站设备流量为自模块启用以来的累计值（持久化）。每轮高频采样请求列表，
 * 按「设备名#请求id」记录已计入字节，只累加增量，长连接后续流量也能补上。
 * 本机流量 = Surge 接口总流量 - 各 peer 入站累计；流量行显示本机自身部分。
 *
 * 策略名自动发现：参数 policy 留空时，从当前 Profile 中找 `xxx = tailscale` 的策略行，
 * 结果缓存到持久化状态；策略改名或换配置后首次调用失败会自动重新探测一次。
 *
 * ⚠️ 依赖 http-api-mcp：Surge → 设置 → HTTP API → 勾选 MCP（http-api-mcp = true）。
 *    未开启时 Tailscale 段显示「不可用」，其余指标不受影响。
 *
 * ⚠️ Tailscale 入站设备访问被本机 MITM 的域名需在本机 Surge 导出 CA 证书并装到入站设备，
 *    否则该设备上这些域名会握手失败（典型：入站设备打不开苹果天气）。
 */

var DEFAULT_API_HOST = "127.0.0.1";
var DEFAULT_API_PORT = "6171";
var DEFAULT_API_KEY = "surgetest";
var REQUEST_TIMEOUT = 3;
var STATE_KEY = "MemoryTrafficAccum";

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

function formatNumber(value) {
    if (!isFiniteNumber(value)) {
        return "—";
    }
    return String(Math.round(Number(value)));
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
            // 排除回环接口，避免把 Surge 自身流量算进本机
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

// peer 名带 MagicDNS 后缀（iphone-12.tailf4e00c.ts.net），请求列表里只有短名，
// 统计与显示统一用短名，避免同一个设备出现两条记录。
function shortPeerName(name) {
    return String(name || "").split(".")[0].trim();
}

function peerKey(name) {
    return shortPeerName(name).toLowerCase();
}

function derpCity(code) {
    if (!code) {
        return "未知";
    }
    return DERP_CITY[String(code).toLowerCase()] || String(code).toUpperCase();
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
    return { devices: {}, seen: {} };
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

    if (IS_CRON) {
        $done({});
        return;
    }

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
        "内存和流量实时监控",
        "请求超时",
        "error",
        "exclamationmark.triangle.fill",
        "#FF3B30"
    );
}, 20000);

var argument = parseArgument(typeof $argument === "undefined" ? "" : $argument);
var apiHost = String(argument.api_host || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST;
var apiPort = String(argument.api_port || DEFAULT_API_PORT).trim() || DEFAULT_API_PORT;
var apiKey = String(argument.api_key || DEFAULT_API_KEY).trim() || DEFAULT_API_KEY;
var apiBase = "http://" + apiHost + ":" + apiPort;
var METRICS_URL = apiBase + "/v1/metrics";
var policyArgument = String(argument.policy || "").trim();
// 参数口留默认占位或写「自动」时一律走自动探测
if (/^(自动|auto|选填|留空自动识别)$/.test(policyArgument)) {
    policyArgument = "";
}

// 面板脚本只在面板可见时才被调度，cron 模式由定时脚本常驻采样，
// 两种模式共用同一份 state，按请求 id 增量累加，天然去重。
var MODE = String(argument.mode || "panel").trim().toLowerCase();
var IS_CRON = MODE === "cron";
var RUN_MS = Math.max(3000, Number(argument.run_ms) || (IS_CRON ? 300000 : 0));
var GAP_MS = Math.max(2000, Number(argument.gap_ms) || 4000);
var SAMPLE_COUNT = IS_CRON ? 0 : 2;
var RUN_DEADLINE = IS_CRON ? Date.now() + RUN_MS : 0;
// cron 模式下 runtime 每约 1 分钟刷新一次，保证新上线的 peer 能被自动纳入统计
var RUNTIME_REFRESH_TICKS = IS_CRON ? Math.ceil(60000 / GAP_MS) : 1;

if (IS_CRON) {
    clearTimeout(sgFallbackTimer);
    setTimeout(function () {
        render();
    }, RUN_MS + 8000);
}

var SEEN_MAX = 600;

var metricsBody = null;
var metricsFailed = null;
var sampleIndex = 0;
var stateCache = null;
var runtime = null;
var runtimeError = null;
var runtimeTicks = 0;
var peerSet = null;
var peerOrder = [];

function getState() {
    if (!stateCache) {
        stateCache = loadState();
    }
    return stateCache;
}

function trimSeen(seen) {
    var ids = [];
    for (var id in seen) {
        if (Object.prototype.hasOwnProperty.call(seen, id)) {
            ids.push(id);
        }
    }
    if (ids.length <= SEEN_MAX) {
        return;
    }
    ids.sort(function (a, b) {
        return (Number(seen[b][2]) || 0) - (Number(seen[a][2]) || 0);
    });
    for (var i = SEEN_MAX; i < ids.length; i++) {
        delete seen[ids[i]];
    }
}

function applyPeerList(peers) {
    peerSet = {};
    peerOrder = [];
    if (!peers) {
        return;
    }
    for (var i = 0; i < peers.length; i++) {
        var short = shortPeerName(peers[i].name);
        if (!short) {
            continue;
        }
        peerSet[short.toLowerCase()] = short;
        peerOrder.push(short);
    }
}

function absorbRequests(list) {
    if (!peerSet || peerOrder.length === 0) {
        return;
    }
    var st = getState();
    if (!st.devices) {
        st.devices = {};
    }
    if (!st.seen) {
        st.seen = {};
    }
    var devicesState = st.devices;
    var seen = st.seen;
    var now = Date.now() / 1000;

    for (var i = 0; i < list.length; i++) {
        var r = list[i] || {};
        var raw = String(r.deviceName || "");
        if (!raw) {
            continue;
        }
        var short = shortPeerName(raw);
        var key = short.toLowerCase();
        if (!peerSet[key]) {
            continue;
        }
        var id = String(r.id || "");
        if (!id) {
            continue;
        }
        var inBytes = Number(r.inBytes) || 0;
        var outBytes = Number(r.outBytes) || 0;
        var seenKey = key + "#" + id;
        var entry = devicesState[key];
        if (!entry) {
            entry = { name: peerSet[key], in: 0, out: 0, count: 0 };
            devicesState[key] = entry;
        }
        entry.name = peerSet[key];
        var prev = seen[seenKey];
        if (!prev) {
            entry.in += inBytes;
            entry.out += outBytes;
            entry.count += 1;
            seen[seenKey] = [inBytes, outBytes, now];
        } else {
            if (inBytes > prev[0]) {
                entry.in += inBytes - prev[0];
                prev[0] = inBytes;
            }
            if (outBytes > prev[1]) {
                entry.out += outBytes - prev[1];
                prev[1] = outBytes;
            }
            prev[2] = now;
        }
    }

    trimSeen(seen);
}

function parseRequestList(body) {
    if (!body) {
        return [];
    }
    try {
        var parsed = JSON.parse(body);
        return Array.isArray(parsed) ? parsed : (parsed.requests || []);
    } catch (e) {
        return [];
    }
}

// $httpAPI 直连引擎：不产生真实请求，不会把「最近请求」50 条窗口刷满
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

// MCP over HTTP API：脚本内唯一的 Tailscale 运行时数据来源
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

function requestList(result) {
    if (!result) {
        return [];
    }
    if (Array.isArray(result)) {
        return result;
    }
    return result.requests || [];
}

function fetchRecent(callback) {
    apiGet("/v1/requests/recent", function (err, result) {
        callback(err ? [] : requestList(result));
    });
}

// 策略名自动发现：优先参数，其次持久化缓存，最后从当前 Profile 里找 `xxx = tailscale`
function findTailnetPolicyInProfile(text, callback) {
    var match = String(text || "").match(/(?:^|\n)\s*([^=\n\[\]#][^=\n]*?)\s*=\s*tailscale\b/i);
    if (match && match[1]) {
        callback(match[1].trim());
        return;
    }
    callback(null);
}

function resolvePolicyName(callback) {
    if (policyArgument) {
        callback(policyArgument, false);
        return;
    }
    var st = getState();
    apiGet("/v1/profiles/current?sensitive=0", function (err, result) {
        if (err || !result) {
            callback(st.tsPolicy || null, true);
            return;
        }
        var text = result.profile || result.originalProfile || "";
        findTailnetPolicyInProfile(text, function (name) {
            if (name) {
                st.tsPolicy = name;
                saveState(st);
            } else {
                st.tsPolicy = null;
                saveState(st);
            }
            callback(name, true);
        });
    });
}

function refreshRuntime(callback) {
    runtimeTicks = 0;
    resolvePolicyName(function (policy, fromProfile) {
        if (!policy) {
            runtimeError = "未找到 Tailscale 策略";
            if (peerSet === null) {
                var st = getState();
                applyPeerList((st.peerNames || []).map(function (n) { return { name: n }; }));
            }
            callback();
            return;
        }
        mcpCall("get_proxy_runtime_status", { policy: policy }, function (err, data) {
            if (err || !data || !data.tailscale) {
                // 缓存的策略名失效（改名/换配置）时重新探测一次
                var st2 = getState();
                if (!fromProfile && st2.tsPolicy) {
                    st2.tsPolicy = null;
                    saveState(st2);
                }
                runtimeError = err || "策略无 Tailscale 运行时数据";
                if (peerSet === null) {
                    applyPeerList((st2.peerNames || []).map(function (n) { return { name: n }; }));
                }
                callback();
                return;
            }
            runtime = data;
            runtimeError = null;
            var ts = data.tailscale || {};
            var peers = ts.peers || [];
            applyPeerList(peers);
            var st3 = getState();
            st3.tsPolicy = policy;
            st3.peerNames = peerOrder.slice(0);
            saveState(st3);
            callback();
        });
    });
}

function prepareBaseline() {
    var metrics = parseMetrics(metricsBody || "");
    var download = sumMetrics(metrics, "surge_interface_in_bytes_total");
    var upload = sumMetrics(metrics, "surge_interface_out_bytes_total");
    if (!isFiniteNumber(download) || !isFiniteNumber(upload)) {
        return;
    }
    var state = getState();
    var hasBaseline = typeof state.lastDownload === "number";
    var prevDownload = Number(state.lastDownload);
    var prevUpload = Number(state.lastUpload);
    // 引擎重启（reload/升级）后接口计数器归零，历史累计与游标全部作废；
    // 只在计数器明显回退时重置，避免偶发抖动误清累计
    var restarted = !hasBaseline || download < prevDownload * 0.5 || upload < prevUpload * 0.5;
    if (restarted) {
        state.devices = {};
        state.seen = {};
    }
    state.lastDownload = download;
    state.lastUpload = upload;
    saveState(state);
}

function nextSample() {
    if (finished) {
        return;
    }
    var more = IS_CRON ? Date.now() < RUN_DEADLINE : sampleIndex < SAMPLE_COUNT;
    if (!more) {
        render();
        return;
    }
    sampleIndex++;
    var needRuntime = peerSet === null || (IS_CRON && runtimeTicks >= RUNTIME_REFRESH_TICKS);
    runtimeTicks++;
    if (needRuntime) {
        refreshRuntime(function () {
            fetchRecent(function (list) {
                try {
                    absorbRequests(list);
                } catch (e) {}
                setTimeout(nextSample, GAP_MS);
            });
        });
        return;
    }
    fetchRecent(function (list) {
        try {
            absorbRequests(list);
        } catch (e) {}
        setTimeout(nextSample, GAP_MS);
    });
}

function tailscaleLines() {
    var lines = [];

    if (!runtime) {
        lines.push("Tailscale · " + (runtimeError ? "不可用" : "读取中"));
        if (runtimeError) {
            lines.push(runtimeError);
        }
        return lines;
    }

    var ts = runtime.tailscale || {};
    var peers = ts.peers || [];
    var online = [];
    var offline = [];
    var direct = 0;
    var relay = 0;

    for (var i = 0; i < peers.length; i++) {
        var p = peers[i];
        if (p.online) {
            online.push(p);
            if (p.status === "direct") {
                direct++;
            } else {
                relay++;
            }
        } else {
            offline.push(p);
        }
    }

    lines.push("Tailscale 状态 · " + (ts.state || "未知"));

    var stage = ts.controlStage ? "状态：" + ts.state + " · " + ts.controlStage : "状态：" + ts.state;
    lines.push(stage);

    var selfName = shortPeerName(ts.selfName || ts.hostname || "") || "—";
    lines.push("本机：" + (ts.selfIPv4 || "—") + " · " + selfName);

    var derpTotal = 0;
    var derpConnected = 0;
    var derpConnections = ts.derpConnections || [];
    for (var d = 0; d < derpConnections.length; d++) {
        derpTotal++;
        if (derpConnections[d].connected) {
            derpConnected++;
        }
    }
    var home = derpCity(ts.homeDERPRegionCode) + " #" + (ts.homeDERPRegionID === undefined ? "?" : ts.homeDERPRegionID);
    lines.push("DERP：" + home + " · " + derpConnected + "/" + derpTotal + " 连");

    var exit = ts.exitNode || {};
    var exitText = "未使用";
    if (exit.enabled && exit.status !== "disabled") {
        exitText = exit.selector && exit.selector !== "auto" ? exit.selector : "自动";
    } else if (exit.status && exit.status !== "disabled") {
        exitText = exit.status;
    }
    lines.push("出口：" + exitText);

    var stEarly = getState();
    var devEarly = stEarly.devices || {};
    var inboundInEarly = 0;
    var inboundOutEarly = 0;
    for (var ek in devEarly) {
        if (Object.prototype.hasOwnProperty.call(devEarly, ek)) {
            inboundInEarly += Number(devEarly[ek].in) || 0;
            inboundOutEarly += Number(devEarly[ek].out) || 0;
        }
    }
    lines.push("入站：↓ " + formatBytes(inboundInEarly) + " ↑ " + formatBytes(inboundOutEarly));

    lines.push(
        "设备：" + online.length + "/" + peers.length + " 在线 · 直连 " + direct + " / 中继 " + relay
    );

    var st = getState();
    var devicesState = st.devices || {};
    var shown = [];
    var listed = 0;

    function deviceLine(peer, isOnline) {
        var short = shortPeerName(peer.name);
        var entry = devicesState[peerKey(short)] || { in: 0, out: 0 };
        var pathText = "离线";
        if (isOnline) {
            pathText = peer.status === "direct" ? "直连" : "中继 " + derpCity(peer.derpRegionCode);
        }
        return (
            (isOnline ? "● " : "○ ") + short + " · " + pathText +
            " · ↓ " + formatBytes(entry.in) + " ↑ " + formatBytes(entry.out)
        );
    }

    online.sort(function (a, b) {
        var la = typeof a.lastActivityAgo === "number" ? a.lastActivityAgo : 1e9;
        var lb = typeof b.lastActivityAgo === "number" ? b.lastActivityAgo : 1e9;
        return la - lb;
    });

    for (var o = 0; o < online.length && listed < 6; o++) {
        shown.push(deviceLine(online[o], true));
        listed++;
    }
    // 离线但仍有累计流量的设备也列出来，避免历史数据看不到
    for (var f = 0; f < offline.length && listed < 6; f++) {
        var fe = devicesState[peerKey(offline[f].name)];
        if (fe && (fe.in > 0 || fe.out > 0 || fe.count > 0)) {
            shown.push(deviceLine(offline[f], false));
            listed++;
        }
    }

    for (var s = 0; s < shown.length; s++) {
        lines.push(shown[s]);
    }

    var wanted = online.length;
    for (var q = 0; q < offline.length; q++) {
        var qe = devicesState[peerKey(offline[q].name)];
        if (qe && (qe.in > 0 || qe.out > 0 || qe.count > 0)) {
            wanted++;
        }
    }
    if (wanted > listed) {
        lines.push("… 其余 " + (wanted - listed) + " 台设备未显示");
    }

    return lines;
}

function render() {
    if (finished) {
        return;
    }
    if (metricsFailed) {
        finishPanel(
            "内存和流量实时监控",
            "无法获取数据\n\n" + String(metricsFailed),
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

    var state = getState();
    saveState(state);
    var devicesState = state.devices || {};
    var inboundIn = 0;
    var inboundOut = 0;

    for (var key in devicesState) {
        if (Object.prototype.hasOwnProperty.call(devicesState, key)) {
            inboundIn += Number(devicesState[key].in) || 0;
            inboundOut += Number(devicesState[key].out) || 0;
        }
    }

    var localIn = Math.max(0, download - inboundIn);
    var localOut = Math.max(0, upload - inboundOut);

    var lines = [
        "内存占用： " + formatBytes(memory ? memory.value : NaN),
        "",
        "运行时间： " + formatUptime(uptime ? uptime.value : NaN),
        "",
        "流量： ↓ " + formatBytes(localIn) + " ↑ " + formatBytes(localOut),
        ""
    ];

    var tsLines = tailscaleLines();
    for (var i = 0; i < tsLines.length; i++) {
        lines.push(tsLines[i]);
    }

    lines.push("");
    lines.push("Surge " + version + " · Build " + build);

    finishPanel("内存和流量实时监控", lines.join("\n"), null, "chart.bar.xaxis", "#4A90E2");
}

function requestMetrics(key, callback) {
    $httpClient.get(
        {
            url: METRICS_URL,
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
                    try {
                        prepareBaseline();
                    } catch (e) {}
                } else {
                    metricsFailed = err2;
                }
                nextSample();
            });
            return;
        }
        if (err) {
            metricsFailed = err;
        } else {
            metricsBody = body;
            try {
                prepareBaseline();
            } catch (e) {}
        }
        nextSample();
    });
}

loadMetrics();
