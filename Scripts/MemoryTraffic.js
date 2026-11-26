/*
 * 内存和流量实时监控（Memory Traffic）v14
 *
 * 本机流量 + Tailscale 入站设备累计流量监控面板
 * 独立于原「内存」模块（SurgeMonitor），互不影响。
 *
 * 累计说明：入站设备流量为自模块启用以来的累计值（持久化保存）。
 * 每轮内部高频采样 /v1/requests/recent 与 /v1/requests/active，
 * 按请求 id 记录已计入字节、只累加增量，避免重复统计。
 * 本机流量 = Surge 接口总流量 - 所有入站设备累计流量；
 * 总计流量 = 本机流量 + 所有入站设备流量 = Surge 接口总流量。
 *
 * v7 修复：增量游标改为按设备记录 startDate（lastStartByDevice）。
 * 旧版用全局最大请求 id 做增量，recent 中本机出站请求 id 增长更快，
 * 会把游标推高，导致入站设备请求被误判为旧请求、累计长期卡住；
 * 且 recent 内 id 与时间顺序不一致会漏统计。现改用请求开始时间做游标，
 * 先取窗口内各设备最大 startDate 再累加新请求，乱序不丢、同请求不重。
 *
 * v8 修复：检测 Surge 引擎重启（升级/reload 使接口总流量归零）。当总流量小于上次
 * 保存的基准时，自动重置入站设备累计与增量游标，避免「本机流量 = 接口总流量 - 入站累计」
 * 在引擎重启后出现负数被 clamp 成 0.00 B。
 *
 * 配置方式（Surge App → 模块 → 编辑本模块 → 脚本参数 argument 中修改）：
 *   每个设备对应一个参数口：dev1=设备名1,dev2=设备名2,...
 *   设备名为 Tailscale 中显示的设备名称（deviceName）。
 *   例如：argument=dev1=iphone-xr,dev2=iphone-15-pro
 *   以后新增设备只需在参数里追加 ,devN=新设备名。
 *
 *   API 配置（可选，默认使用本机 HTTP API）：
 *   api_host=HTTP API 地址（默认 127.0.0.1）
 *   api_port=HTTP API 端口（默认 6171）
 *   api_key=HTTP API 密码（默认 surgetest）
 *   例如：argument=dev1=iphone-xr&api_host=127.0.0.1&api_port=6171&api_key=surgetest
 *
 * 数据来源：
 *   GET /v1/metrics            —— 内存、运行时间、请求/DNS/封禁、本机总流量
 *   GET /v1/requests/recent     —— 按设备名统计 Tailscale 入站设备的连接数与流量
 *
 * ⚠️ 注意事项：Tailscale 入站设备访问被 MITM 的域名需安装 CA 证书
 *   入站设备（如 iphone-xr）通过本机转发流量时，若访问本机 [MITM] hostname
 *   列表中的域名（如 weatherkit.apple.com 苹果天气），会命中本机 HTTPS 解密。
 *   因为入站设备不信任 Surge 的 MITM CA（surge-ca），TLS 握手会失败，
 *   典型现象：入站设备的天气 App 打不开，连接详情里策略/规则/远端 IP 全是 N/A。
 *   解决：在入站设备上安装并完全信任【接受入站的那台 Surge（本机）】的 MITM CA 证书，
 *   不能是其他设备导出的证书——本机 Surge App → 设置 → MITM → 导出描述文件（.mobileconfig），
 *   装到入站设备后，到「设置 → 通用 → 关于本机 → 证书信任设置」开启该证书的完全信任。
 *   注意：iOS 的文件 App 识别描述文件只看扩展名，传输后需确保 .mobileconfig 后缀存在。
 */

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "6171";
const DEFAULT_API_KEY = "surgetest";
const REQUEST_TIMEOUT = 3;

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

    let bytes = Math.max(0, Number(value));
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;

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

    let seconds = Math.max(0, Math.floor(Number(value)));
    const days = Math.floor(seconds / 86400);
    seconds -= days * 86400;

    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;

    const minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;

    const parts = [];
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
    const metrics = [];
    const lines = String(text).split(/\r?\n/);
    const metricPattern =
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/;
    const labelPattern =
        /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.charAt(0) === "#") {
            continue;
        }

        const match = line.match(metricPattern);
        if (!match) {
            continue;
        }

        const labels = {};
        const labelText = match[2] || "";
        let labelMatch;

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
    for (let i = 0; i < metrics.length; i++) {
        if (metrics[i].name === metricName) {
            return metrics[i];
        }
    }
    return null;
}

function sumMetrics(metrics, metricName) {
    let total = 0;
    let found = false;

    for (let i = 0; i < metrics.length; i++) {
        if (
            metrics[i].name === metricName &&
            isFiniteNumber(metrics[i].value)
        ) {
            // 排除本机回环(lo0)接口，避免统计到 Surge 自身流量
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
    const result = {};
    if (typeof arg === "string") {
        // 支持 &（query-string 风格）和逗号/分号分隔的 key=value
        arg.split(/[&,;]/).forEach(function (part) {
            const idx = part.indexOf("=");
            if (idx > 0) {
                result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
            }
        });
    } else if (arg && typeof arg === "object") {
        for (const key in arg) {
            result[key] = arg[key];
        }
    }
    return result;
}

function aggregateDeviceRequests(requests, deviceName) {
    let count = 0;
    let inBytes = 0;
    let outBytes = 0;
    const target = String(deviceName).toLowerCase();

    for (let i = 0; i < requests.length; i++) {
        const r = requests[i];
        if (String(r.deviceName || "").toLowerCase() !== target) {
            continue;
        }
        count++;
        inBytes += Number(r.inBytes) || 0;
        outBytes += Number(r.outBytes) || 0;
    }

    return { count: count, inBytes: inBytes, outBytes: outBytes };
}

function collectDevices(arg) {
    const devices = [];
    const keys = [];

    for (const key in arg) {
        if (arg.hasOwnProperty(key) && /^dev\d+$/.test(key)) {
            keys.push(key);
        }
    }

    keys.sort(function (a, b) {
        const na = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
        const nb = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
        return na - nb;
    });

    for (let i = 0; i < keys.length; i++) {
        const value = String(arg[keys[i]] || "").trim();
        // 过滤空值和「选填」占位符（未填写的参数口不显示在面板）
        if (value.length > 0 && value !== "选填") {
            devices.push(value);
        }
    }

    return devices;
}

const STATE_KEY = "MemoryTrafficAccum";

function loadState() {
    try {
        const raw = $persistentStore.read(STATE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                return parsed;
            }
        }
    } catch (e) {
        // 忽略损坏的状态
    }
    return { lastMaxId: 0, devices: {} };
}

function saveState(state) {
    try {
        $persistentStore.write(JSON.stringify(state), STATE_KEY);
    } catch (e) {
        // 忽略写入失败
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

    const result = {
        title: title,
        content: content
    };

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

const argument = parseArgument($argument);
const apiHost = String(argument.api_host || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST;
const apiPort = String(argument.api_port || DEFAULT_API_PORT).trim() || DEFAULT_API_PORT;
const apiKey = String(argument.api_key || DEFAULT_API_KEY).trim() || DEFAULT_API_KEY;
const apiBase = "http://" + apiHost + ":" + apiPort;
const METRICS_URL = apiBase + "/v1/metrics";
const RECENT_URL = apiBase + "/v1/requests/recent";
const ACTIVE_URL = apiBase + "/v1/requests/active";
const devices = collectDevices(argument);

// v12: 面板脚本只在面板可见时才被调度，没人盯着面板就等于不统计。
// 增加 cron 模式：由 cron 脚本常驻采样（默认 5 分钟一轮、跑 280 秒），
// 不依赖面板可见；两种模式共用同一 state，按请求 id 增量累加，天然去重。
const MODE = String(argument.mode || "panel").trim().toLowerCase();
const IS_CRON = MODE === "cron";
const RUN_MS = Math.max(3000, Number(argument.run_ms) || (IS_CRON ? 300000 : 0));
const GAP_MS = Math.max(2000, Number(argument.gap_ms) || 4000);
const SAMPLE_COUNT = IS_CRON ? 0 : 2;
const RUN_DEADLINE = IS_CRON ? Date.now() + RUN_MS : 0;
if (IS_CRON) {
    clearTimeout(sgFallbackTimer);
    setTimeout(function () {
        render();
    }, RUN_MS + 8000);
}

// v10: /v1/requests/recent 固定只回 50 条且整机共用，入站设备的请求会被本机请求挤出窗口；
// 单次 10 秒采样大量漏计。改为每轮内部高频采样（SAMPLE_COUNT 次，间隔 SAMPLE_GAP ms），
// 并按请求 id 记录已计入的字节数（seen），只累加增量，长连接后续流量也能补上。
const SEEN_MAX = 600;

let metricsBody = null;
let metricsFailed = null;
let sampleIndex = 0;
let stateCache = null;

function getState() {
    if (!stateCache) {
        stateCache = loadState();
    }
    return stateCache;
}

function trimSeen(seen) {
    const ids = [];
    for (const id in seen) {
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
    for (let i = SEEN_MAX; i < ids.length; i++) {
        delete seen[ids[i]];
    }
}

function absorbRequests(list) {
    const st = getState();
    if (!st.devices) {
        st.devices = {};
    }
    if (!st.seen) {
        st.seen = {};
    }
    const devicesState = st.devices;
    const seen = st.seen;
    const now = Date.now() / 1000;

    for (let i = 0; i < list.length; i++) {
        const r = list[i] || {};
        const name = String(r.deviceName || "");
        if (devices.indexOf(name) === -1) {
            continue;
        }
        const id = String(r.id || "");
        if (!id) {
            continue;
        }
        const inBytes = Number(r.inBytes) || 0;
        const outBytes = Number(r.outBytes) || 0;
        const key = name + "#" + id;
        let entry = devicesState[name];
        if (!entry) {
            entry = { in: 0, out: 0, count: 0 };
            devicesState[name] = entry;
        }
        const prev = seen[key];
        if (!prev) {
            entry.in += inBytes;
            entry.out += outBytes;
            entry.count += 1;
            seen[key] = [inBytes, outBytes, now];
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
        const parsed = JSON.parse(body);
        return Array.isArray(parsed) ? parsed : (parsed.requests || []);
    } catch (e) {
        return [];
    }
}

function getJson(url, callback) {
    $httpClient.get(
        {
            url: url,
            timeout: REQUEST_TIMEOUT,
            headers: {
                Accept: "application/json",
                "X-Key": apiKey
            }
        },
        function (error, response, body) {
            let failed = null;
            if (error) {
                failed = String(error);
            } else if (
                response &&
                response.status &&
                (response.status < 200 || response.status >= 300)
            ) {
                failed = "HTTP " + response.status;
            }
            callback(failed, failed ? [] : parseRequestList(body));
        }
    );
}

// 官方 API：$httpAPI 直连 Surge 引擎，不经真实网络，因此不会占用「最近请求」的 50 条窗口。
// 之前用 $httpClient 打 127.0.0.1:6171，每次采样都变成一条可记录请求，把窗口刷满、
// 把自己的统计对象挤出去——这是入站流量长期偏小的根本原因。
function apiGet(path, callback) {
    try {
        $httpAPI("GET", path, null, function (result) {
            callback(null, result);
        });
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

function fetchPair(callback) {
    // recent 已包含在飞请求，不再额外请求 active
    apiGet("/v1/requests/recent", function (err, result) {
        callback(err ? [] : requestList(result));
    });
}

function prepareBaseline() {
    const metrics = parseMetrics(metricsBody || "");
    const download = sumMetrics(metrics, "surge_interface_in_bytes_total");
    const upload = sumMetrics(metrics, "surge_interface_out_bytes_total");
    if (!isFiniteNumber(download) || !isFiniteNumber(upload)) {
        return;
    }
    const state = getState();
    const hasBaseline = typeof state.lastDownload === "number";
    const prevDownload = Number(state.lastDownload);
    const prevUpload = Number(state.lastUpload);
    // 引擎重启（reload/升级）后接口计数器归零，历史累计与游标全部作废
    // 只有计数器明显回退（引擎重启/reload 归零）才重置，避免偶发抖动误清累计
    const restarted = !hasBaseline || download < prevDownload * 0.5 || upload < prevUpload * 0.5;
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
    const more = IS_CRON ? Date.now() < RUN_DEADLINE : sampleIndex < SAMPLE_COUNT;
    if (!more) {
        render();
        return;
    }
    sampleIndex++;
    fetchPair(function (list) {
        try {
            absorbRequests(list);
        } catch (e) {
            // 单轮统计异常不影响面板
        }
        setTimeout(nextSample, GAP_MS);
    });
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

    const metrics = parseMetrics(metricsBody || "");
    const buildInfo = getMetric(metrics, "surge_build_info");
    const uptime = getMetric(metrics, "surge_uptime_seconds");
    const memory = getMetric(metrics, "surge_memory_bytes");
    const activeRequests = getMetric(metrics, "surge_active_requests");
    const dnsCache = getMetric(metrics, "surge_dns_cache_entries");
    const activeBans = getMetric(metrics, "surge_active_bans");

    const version = buildInfo && buildInfo.labels.version ? buildInfo.labels.version : "未知";
    const build = buildInfo && buildInfo.labels.build ? buildInfo.labels.build : "未知";

    const download = sumMetrics(metrics, "surge_interface_in_bytes_total");
    const upload = sumMetrics(metrics, "surge_interface_out_bytes_total");

    const state = getState();
    saveState(state);
    const devicesState = state.devices || {};
    let inboundTotalIn = 0;
    let inboundTotalOut = 0;
    const deviceLines = [];

    for (let i = 0; i < devices.length; i++) {
        const entry = devicesState[devices[i]] || { in: 0, out: 0, count: 0 };
        inboundTotalIn += entry.in;
        inboundTotalOut += entry.out;
        deviceLines.push(
            devices[i] + "： ↓ " + formatBytes(entry.in) + " ↑ " + formatBytes(entry.out)
        );
    }

    const localIn = Math.max(0, download - inboundTotalIn);
    const localOut = Math.max(0, upload - inboundTotalOut);

    const lines = [
        "内存占用： " + formatBytes(memory ? memory.value : NaN),
        "",
        "运行时间： " + formatUptime(uptime ? uptime.value : NaN),
        "",
        "HTTP请求：" +
            formatNumber(activeRequests ? activeRequests.value : NaN) +
            " · DNS缓存：" +
            formatNumber(dnsCache ? dnsCache.value : NaN) +
            " · 封禁：" +
            formatNumber(activeBans ? activeBans.value : NaN),
        "",
        "本机流量： ↓ " + formatBytes(localIn) + " ↑ " + formatBytes(localOut),
        "",
        "Tailscale 入站流量"
    ];

    if (devices.length === 0) {
        lines.push("（未配置设备）");
        lines.push("编辑脚本参数添加设备名");
    } else {
        for (let i = 0; i < deviceLines.length; i++) {
            lines.push(deviceLines[i]);
        }
    }

    lines.push("");
    lines.push("总计流量： ↓ " + formatBytes(download) + " ↑ " + formatBytes(upload));
    lines.push("");
    lines.push("Surge " + version + " · Build " + build);

    finishPanel("内存和流量实时监控", lines.join("\n"), null, "chart.bar.xaxis", "#4A90E2");
}

function requestMetrics(key, callback) {
    $httpClient.get(
        {
            url: METRICS_URL,
            timeout: REQUEST_TIMEOUT,
            headers: {
                Accept: "text/plain",
                "X-Key": key
            }
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

// api_key 有大小写误填（surgeTest）会 401，而 Surge iOS 默认口令就是小写 surgetest，自动降级重试
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
