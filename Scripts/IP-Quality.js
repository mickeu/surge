// IP 纯净度检测脚本（支持策略组参数）
// 数据源：ip-api.com（含 proxy/hosting/mobile 检测）
// 参数：通过模块 $argument 传入，格式 group=策略组名
// 用法：在模块 [Script] 行写 argument=group=PROXY

// ── 参数解析 ──
let groupName = "PROXY"; // 默认值
if (typeof $argument !== "undefined" && $argument) {
  const params = $argument.split("&");
  for (const p of params) {
    const [k, ...v] = p.split("=");
    if (k.trim() === "group") {
      groupName = v.join("=").trim();
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
  // 第一步：获取指定策略组当前选中的节点名
  $httpAPI("GET", "/v1/policy_groups", null, function (error, response, data) {
    if (error || !data) {
      // 降级：直接检测当前出口 IP
      detectIP(null, "无法读取策略组，检测当前出口");
      return;
    }

    // 兼容数组或对象格式
    let groups = data;
    if (!Array.isArray(groups) && data.groups) {
      groups = data.groups;
    }

    if (!Array.isArray(groups)) {
      detectIP(null, "策略组数据格式异常，检测当前出口");
      return;
    }

    // 查找目标策略组
    const targetGroup = groups.find((g) => g.name === groupName);
    if (!targetGroup) {
      $done({
        title: "策略组未找到",
        content: "找不到策略组「" + groupName + "」\n请检查模块参数是否正确（注意大小写）\n\n可用策略组：\n" + groups.map((g) => g.name).join("\n"),
        icon: "exclamationmark.triangle",
        "icon-color": "#FF9500"
      });
      return;
    }

    const selectedPolicy = targetGroup.selected;
    if (!selectedPolicy) {
      detectIP(null, "策略组「" + groupName + "」无选中节点");
      return;
    }

    // 第二步：用选中节点作为出站策略发请求
    detectIP(selectedPolicy, null);
  });
}

// ── 通过指定策略发请求检测 IP ──
function detectIP(policyName, fallbackMsg) {
  const options = {};
  if (policyName) {
    // Surge $httpClient 支持 policy 指定出站策略
    options.policy = policyName;
  }

  $httpClient.get(apiURL, options, function (error, response, data) {
    if (error || !data) {
      $done({
        title: "IP 检测失败",
        content: (policyName ? "策略：" + policyName + "\n" : "") + (error || "无数据"),
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

    renderResult(d, policyName, fallbackMsg);
  });
}

// ── 渲染结果 ──
function renderResult(d, policyName, fallbackMsg) {
  const flag = getFlag(d.countryCode);

  // 类型判断
  let ipType = "🏠 住宅 IP";
  if (d.hosting) ipType = "🏢 数据中心";
  else if (d.proxy) ipType = "🔀 代理/VPN";
  else if (d.mobile) ipType = "📱 移动网络";

  // 风险评级
  let risk = "✅ 低风险";
  if (d.hosting && d.proxy) risk = "🔴 高风险";
  else if (d.hosting || d.proxy) risk = "🟡 中等风险";

  // 纯净度评分
  let score = 100;
  if (d.proxy) score -= 40;
  if (d.hosting) score -= 30;
  if (d.mobile) score -= 5;

  const lines = [];
  if (policyName) {
    lines.push("策略：" + policyName);
  }
  if (fallbackMsg) {
    lines.push("⚠️ " + fallbackMsg);
  }
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
