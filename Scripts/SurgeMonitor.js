/*
 * Surge Monitor
 *
 * Official metrics:
 *   surge_build_info{version,build,system}
 *   surge_uptime_seconds
 *   surge_memory_bytes
 *   surge_interface_in_bytes_total{interface}
 *   surge_interface_out_bytes_total{interface}
 *
 * API: GET /v1/metrics
 *
 * v17: 汇总行标签由"总流量"改为"流量统计"
 * v16: 流量区标题改为"流量明细"，避免与"总流量"行混淆
 * v15: DNS请求改回DNS缓存；请求行冒号后去空格，紧凑排布
 * v14: 恢复 HTTP请求/DNS请求/封禁 三指标布局（用户确认）
 * v13: 请求行只显示进行中请求与封禁，隐藏 DNS 缓存；两标签等宽值列对齐
 * v12: 请求行改为 HTTP请求/DNS请求/封禁 顺序，紧凑排布、流量区保持对齐
 * v11: 请求行三标签等宽（DNS缓存/请求中/封禁数），值列第8位对齐、无大段空格
 * v10: 请求行改为 DNS缓存/请求中/封禁 顺序，内部值列对齐
 * v9: 紧凑对齐——值列统一第10位，最大3空格；"请求中"标签替代"请求...进行中"
 * v8: 顶部三行数值列严格对齐；"流量统计"保持4字标题，纯文字无图标
 * v7: "WiFi流量"标签去空格，与其余流量标签宽度对齐
 * v6: "流量统计"作为流量区标题移到前面(去括号)；全部流量行标签对齐
 * v5: 新增 WiFi/蜂窝流量拆分；底部加（流量统计）；"请求"标签恢复并压缩空格
 * v4: 面板标签改为等宽对齐，去掉"请求"后的长空格
 * v3: 新增进行中请求/DNS缓存/活跃封禁/直连-代理流量详情
 * v2: 流量统计排除 lo0 回环接口；请求加显式 timeout(8s)
 */

const API_KEY = "surgetest";
const METRICS_URL = "http://127.0.0.1:6171/v1/metrics";
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

function sumMetricsByLabel(metrics, metricName, labelName, labelValue) {
    let total = 0;
    let found = false;

    for (let i = 0; i < metrics.length; i++) {
        if (
            metrics[i].name === metricName &&
            isFiniteNumber(metrics[i].value)
        ) {
            if (metrics[i].labels[labelName] !== labelValue) {
                continue;
            }
            total += Number(metrics[i].value);
            found = true;
        }
    }

    return found ? total : NaN;
}

function sumMetricsByInterfacePrefix(metrics, metricName, prefix) {
    let total = 0;
    let found = false;

    for (let i = 0; i < metrics.length; i++) {
        if (
            metrics[i].name === metricName &&
            isFiniteNumber(metrics[i].value)
        ) {
            const iface = metrics[i].labels.interface || "";
            if (!iface.startsWith(prefix)) {
                continue;
            }
            total += Number(metrics[i].value);
            found = true;
        }
    }

    return found ? total : NaN;
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
        "Surge Monitor",
        "请求超时",
        "error",
        "exclamationmark.triangle.fill",
        "#FF3B30"
    );
}, 9000);

$httpClient.get(
    {
        url: METRICS_URL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            Accept: "text/plain",
            "X-Key": API_KEY
        }
    },
    function (error, response, body) {
        if (error) {
            finishPanel(
                "Surge Monitor",
                "无法获取 Metrics\n\n" + String(error),
                "error",
                "exclamationmark.triangle.fill",
                "#FF3B30"
            );
            return;
        }

        if (
            response &&
            response.status &&
            (response.status < 200 || response.status >= 300)
        ) {
            finishPanel(
                "Surge Monitor",
                "Metrics 请求失败\n\nHTTP " + response.status,
                "error",
                "exclamationmark.triangle.fill",
                "#FF3B30"
            );
            return;
        }

        if (!body) {
            finishPanel(
                "Surge Monitor",
                "Metrics 返回为空",
                "error",
                "exclamationmark.triangle.fill",
                "#FF3B30"
            );
            return;
        }

        const metrics = parseMetrics(body);
        const buildInfo = getMetric(metrics, "surge_build_info");
        const uptime = getMetric(metrics, "surge_uptime_seconds");
        const memory = getMetric(metrics, "surge_memory_bytes");

        const version = buildInfo && buildInfo.labels.version
            ? buildInfo.labels.version
            : "未知";
        const build = buildInfo && buildInfo.labels.build
            ? buildInfo.labels.build
            : "未知";
        const system = buildInfo && buildInfo.labels.system
            ? buildInfo.labels.system
            : "未知";

        const download = sumMetrics(
            metrics,
            "surge_interface_in_bytes_total"
        );
        const upload = sumMetrics(
            metrics,
            "surge_interface_out_bytes_total"
        );

        const activeRequests = getMetric(metrics, "surge_active_requests");
        const dnsCache = getMetric(metrics, "surge_dns_cache_entries");
        const activeBans = getMetric(metrics, "surge_active_bans");

        const directIn = sumMetricsByLabel(
            metrics,
            "surge_policy_in_bytes_total",
            "policy",
            "DIRECT"
        );
        const directOut = sumMetricsByLabel(
            metrics,
            "surge_policy_out_bytes_total",
            "policy",
            "DIRECT"
        );
        const proxyIn = download - directIn;
        const proxyOut = upload - directOut;

        const wifiIn = sumMetricsByInterfacePrefix(
            metrics,
            "surge_interface_in_bytes_total",
            "en"
        );
        const wifiOut = sumMetricsByInterfacePrefix(
            metrics,
            "surge_interface_out_bytes_total",
            "en"
        );
        const cellularIn = sumMetricsByInterfacePrefix(
            metrics,
            "surge_interface_in_bytes_total",
            "pdp_ip"
        );
        const cellularOut = sumMetricsByInterfacePrefix(
            metrics,
            "surge_interface_out_bytes_total",
            "pdp_ip"
        );

        const content = [
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
            "流量明细",
            "直连流量： ↓ " +
                formatBytes(directIn) +
                " ↑ " +
                formatBytes(directOut),
            "代理流量： ↓ " +
                formatBytes(proxyIn) +
                " ↑ " +
                formatBytes(proxyOut),
            "WiFi流量： ↓ " +
                formatBytes(wifiIn) +
                " ↑ " +
                formatBytes(wifiOut),
            "蜂窝流量： ↓ " +
                formatBytes(cellularIn) +
                " ↑ " +
                formatBytes(cellularOut),
            "流量统计： ↓ " +
                formatBytes(download) +
                " ↑ " +
                formatBytes(upload),
            "",
            "Surge " + version + " · Build " + build + " · " + system
        ].join("\n");

        finishPanel(
            "Surge Monitor",
            content,
            null,
            "chart.bar.xaxis",
            "#4A90E2"
        );
    }
);
