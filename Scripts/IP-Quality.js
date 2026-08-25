// IP 纯净度检测脚本（支持策略组参数）
// 数据源：ip-api.com
// 参数：argument=group=策略组名（模块参数 GROUP 传入）
// 读取策略组当前选中节点用 $surge.selectGroupDetails()，指定出站用 $httpClient policy 参数

// ── 参数解析 ──
let groupName = "PROXY"; // 默认值
if (typeof $argument !== "undefined" && $argument) {
  const params = String($argument).split("&");
  for (const p of params) {
    const idx = p.indexOf("=");
    if (idx > 0) {
      const k = p.slice(0, idx).trim();
      if (k === "group") {
        groupName = p.slice(idx + 1).trim();
      }
    }
  }
}

const apiURL = "http://ip-api.com/json?fields=status,query,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile";

// ── 工具函数 ──
function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  const map = {
    CN: "🇨🇳", HK: "🇭🇰", TW: "🇹🇼", JP: "🇯🇵", SG: "🇸🇬", US: "🇺🇸",
    KR: "🇰🇷", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", CA: "🇨🇦", AU: "🇦🇺",
    IN: "🇮🇳", RU: "🇷🇺", BR: "🇧🇷", NL: "🇳🇱", TR: "🇹🇷", TH: "🇹🇭",
    VN: "🇻🇳", PH: "🇵🇭", MY: "🇲🇾", ID: "🇮🇩", AE: "🇦🇪", AR: "🇦🇷"
  };
  return map[code.toUpperCase()] || "🌐";
}

// ── 主流程 ──
function main() {
  const details = $surge.selectGroupDetails();
  const groups = details && details.groups;
  const decisions = details && details.decisions;

  if (!groups || !decisions || typeof groups[groupName] === "undefined") {
    $done({
      title: "策略组未找到",
      content: "找不到策略组「" + groupName + "」\n请检查模块参数是否正确（注意大小写）\n\n可用策略组：\n" + Object.keys(groups || {}).join("\n"),
      icon: "exclamationmark.triangle",
      "icon-color": "#FF9500"
    });
    return;
  }

  const selectedPolicy = decisions[groupName];
  if (!selectedPolicy) {
    $done({
      title: "无选中节点",
      content: "策略组「" + groupName + "」当前无选中节点",
      icon: "exclamationmark.triangle",
      "icon-color": "#FF9500"
    });
    return;
  }

  // 用选中节点作为出站策略发请求
  detectIP(selectedPolicy, groupName);
}

// ── 通过指定 policy 发请求检测 IP ──
function detectIP(policyName, groupName) {
  $httpClient.get(apiURL, { policy: policyName }, function (error, response, data) {
    if (error || !data) {
      $done({
        title: "IP 检测失败",
        content: "策略：" + policyName + "\n" + (error || "无数据"),
        icon: "exclamationmark.triangle",
        "icon-color": "#FF3B30"
      });
      return;
    }

    let d;
    try {
      d = JSON.parse(data);
    } catch (e) {
      $done({
        title: "解析失败",
        content: "无法解析 IP 数据：" + (data ? data.substring(0, 100) : "空"),
        icon: "exclamationmark.triangle",
        "icon-color": "#FF3B30"
      });
      return;
    }

    if (d.status && d.status !== "success") {
      $done({
        title: "API 返回异常",
        content: "状态：" + (d.status || "未知") + "\nIP：" + (d.query || "未知"),
        icon: "exclamationmark.triangle",
        "icon-color": "#FF3B30"
      });
      return;
    }

    renderResult(d, groupName, policyName);
  });
}

// ── 渲染结果 ──
function renderResult(d, groupName, policyName) {
  const flag = getFlag(d.countryCode);

  let ipType = "🏠 住宅 IP";
  if (d.hosting) ipType = "🏢 数据中心";
  else if (d.proxy) ipType = "🔀 代理/VPN";
  else if (d.mobile) ipType = "📱 移动网络";

  let risk = "✅ 低风险";
  if (d.hosting && d.proxy) risk = "🔴 高风险";
  else if (d.hosting || d.proxy) risk = "🟡 中等风险";

  let score = 100;
  if (d.proxy) score -= 40;
  if (d.hosting) score -= 30;
  if (d.mobile) score -= 5;

  const lines = [];
  lines.push("策略组：" + groupName);
  lines.push("节点：" + policyName);
  lines.push("IP：" + d.query);
  lines.push("归属：" + flag + d.country + " · " + (d.city || d.regionName || "未知"));
  lines.push("运营商：" + (d.isp || "未知"));
  lines.push("AS：" + (d.as || "未知"));
  lines.push("类型：" + ipType);
  lines.push("风险：" + risk);
  lines.push("纯净度：" + score + "/100");

  $done({
    title: flag + " " + d.query,
    content: lines.join("\n"),
    icon: score >= 70 ? "checkmark.shield.fill" : score >= 40 ? "exclamationmark.shield.fill" : "xmark.shield.fill",
    "icon-color": score >= 70 ? "#34C759" : score >= 40 ? "#FF9500" : "#FF3B30"
  });
}

main();