/*
 * 内存和流量实时监控（Memory Traffic）v7
 *
 * 本机流量 + Tailscale 入站设备累计流量监控面板
 * 独立于原「内存」模块（SurgeMonitor），互不影响。
 *
 * 累计说明：入站设备流量为自模块启用以来的累计值（持久化保存），
 * 每 10 秒轮询 /v1/requests/recent 并只累加新请求，避免重复统计。
 * 本机流量 = Surge 接口总流量 - 所有入站设备累计流量；
 * 总计流量 = 本机流量 + 所有入站设备流量 = Surge 接口总流量。
 *
 * v7 修复：增量游标改为按设备记录 startDate（lastStartByDevice）。
 * 旧版用全局最大请求 id 做增量，recent 中本机出站请求 id 增长更快，
 * 会把游标推高，导致入站设备请求被误判为旧请求、累计长期卡住；
 * 且 recent 内 id 与时间顺序不一致会漏统计。现改用请求开始时间做游标，
 * 先取窗口内各设备最大 startDate 再累加新请求，乱序不丢、同请求不重。
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
 */

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "6171";
const DEFAULT_API_KEY = "surgetest";
const REQUEST_TIMEOUT = 8000;

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

setTimeout(function () {
    finishPanel(
        "内存和流量实时监控",
        "请求超时",
        "error",
        "exclamationmark.triangle.fill",
        "#FF3B30"
    );
}, 9000);

const argument = parseArgument($argument);
const apiHost = String(argument.api_host || DEFAULT_API_HOST).trim() || DEFAULT_API_HOST;
const apiPort = String(argument.api_port || DEFAULT_API_PORT).trim() || DEFAULT_API_PORT;
const apiKey = String(argument.api_key || DEFAULT_API_KEY).trim() || DEFAULT_API_KEY;
const apiBase = "http://" + apiHost + ":" + apiPort;
const METRICS_URL = apiBase + "/v1/metrics";
const REQUESTS_URL = apiBase + "/v1/requests/recent";
const devices = collectDevices(argument);

let metricsBody = null;
let requestsBody = null;
let metricsFailed = null;
let requestsFailed = null;
let pending = 2;

function maybeFinish() {
    pending--;
    if (pending > 0) {
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

    const version = buildInfo && buildInfo.labels.version
        ? buildInfo.labels.version
        : "未知";
    const build = buildInfo && buildInfo.labels.build
        ? buildInfo.labels.build
        : "未知";

    const download = sumMetrics(
        metrics,
        "surge_interface_in_bytes_total"
    );
    const upload = sumMetrics(
        metrics,
        "surge_interface_out_bytes_total"
    );

    let requests = [];
    if (!requestsFailed && requestsBody) {
        try {
            const parsed = JSON.parse(requestsBody);
            requests = Array.isArray(parsed) ? parsed : (parsed.requests || []);
        } catch (e) {
            requests = [];
        }
    }

    // 持久化累计各设备的入站流量（只累加新请求，避免重复）
    // 注意：必须按设备分开记录增量游标。/v1/requests/recent 只返回最近一批请求，
    // 且混有大量本机出站请求。若用全局最大 id 作增量，本机请求会把游标快速推高，
    // 导致入站设备请求永远被误判为旧请求、累计长期卡住（面板不涨）。
    // 另外 recent 内请求 id 与时间顺序并不严格一致（长连接 id 大但开始早），
    // 用 id 做增量会漏统计。故改用 startDate（请求开始时间）做增量游标：
    // 先取窗口内各设备最大 startDate 作为新游标，再累加所有 startDate 大于
    // 上一轮游标的请求，乱序窗口也不会漏。
    const state = loadState();
    const devicesState = state.devices || {};
    const lastStartByDev = state.lastStartByDevice || {};

    // 本轮窗口内各配置设备的最大 startDate（作为新的增量游标）
    const newLastStart = {};
    for (let i = 0; i < requests.length; i++) {
        const r = requests[i] || {};
        const devName = String(r.deviceName || "");
        if (devices.indexOf(devName) === -1) {
            continue;
        }
        const sd = Number(r.startDate) || 0;
        if (!(devName in newLastStart) || sd > newLastStart[devName]) {
            newLastStart[devName] = sd;
        }
    }

    // 旧版本升级首次运行：仅初始化游标到窗口内最大 startDate，不累加历史，
    // 避免把窗口内既有请求重复计入导致数值跳变。
    if (state.lastStartByDevice) {
        const seen = {};
        for (let i = 0; i < requests.length; i++) {
            const r = requests[i] || {};
            const devName = String(r.deviceName || "");
            if (devices.indexOf(devName) === -1) {
                continue;
            }
            const rid = String(r.id || "");
            if (seen[rid]) {
                continue; // 同一请求在窗口内重复出现，只累加一次
            }
            const sd = Number(r.startDate) || 0;
            const prev = Number(lastStartByDev[devName]) || 0;
            if (sd <= prev) {
                continue;
            }
            seen[rid] = true;
            const entry = devicesState[devName] || { in: 0, out: 0, count: 0 };
            entry.in += Number(r.inBytes) || 0;
            entry.out += Number(r.outBytes) || 0;
            entry.count += 1;
            devicesState[devName] = entry;
        }
    }

    // 用窗口内最大 startDate 推进游标；窗口内未出现的设备游标保持不变
    for (const devName in newLastStart) {
        lastStartByDev[devName] = newLastStart[devName];
    }
    state.lastStartByDevice = lastStartByDev;
    state.devices = devicesState;
    saveState(state);

    // 各设备累计流量（面板直接显示累计数值，不写「累计/总计」标签）
    let inboundTotalIn = 0;
    let inboundTotalOut = 0;
    const deviceLines = [];

    for (let i = 0; i < devices.length; i++) {
        const entry = devicesState[devices[i]] || { in: 0, out: 0, count: 0 };
        inboundTotalIn += entry.in;
        inboundTotalOut += entry.out;
        deviceLines.push(
            devices[i] +
                "： ↓ " +
                formatBytes(entry.in) +
                " ↑ " +
                formatBytes(entry.out)
        );
    }

    // 本机流量 = 接口总流量 - 入站总流量（扣除所有入站设备）
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
        "本机流量： ↓ " + formatBytes(localIn) + " ↑ " + formatBytes(localOut)
    ];

    lines.push("");
    lines.push("Tailscale 入站流量");
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

    finishPanel(
        "内存和流量实时监控",
        lines.join("\n"),
        null,
        "chart.bar.xaxis",
        "#4A90E2"
    );
}

$httpClient.get(
    {
        url: METRICS_URL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            Accept: "text/plain",
            "X-Key": apiKey
        }
    },
    function (error, response, body) {
        if (error) {
            metricsFailed = String(error);
        } else if (
            response &&
            response.status &&
            (response.status < 200 || response.status >= 300)
        ) {
            metricsFailed = "Metrics HTTP " + response.status;
        } else if (!body) {
            metricsFailed = "Metrics 返回为空";
        } else {
            metricsBody = body;
        }
        maybeFinish();
    }
);

$httpClient.get(
    {
        url: REQUESTS_URL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            Accept: "application/json",
            "X-Key": apiKey
        }
    },
    function (error, response, body) {
        if (error) {
            requestsFailed = String(error);
        } else if (
            response &&
            response.status &&
            (response.status < 200 || response.status >= 300)
        ) {
            requestsFailed = "Requests HTTP " + response.status;
        } else {
            requestsBody = body;
        }
        maybeFinish();
    }
);