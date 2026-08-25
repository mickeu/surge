// ============================================
// IP 纯净度 - $httpAPI 版 v3
// 版本标记: HTTPAPI-V3-20260825
// 读取策略组用 $httpAPI，出站用 policy 参数
// ============================================

const LINES = [];
LINES.push("版本: HTTPAPI-V3");

let groupName = "PROXY";
if (typeof $argument !== "undefined" && $argument) {
  const params = String($argument).split("&");
  for (const p of params) {
    const idx = p.indexOf("=");
    if (idx > 0 && p.slice(0, idx).trim() === "group") groupName = p.slice(idx + 1).trim();
  }
}
LINES.push("参数group: " + groupName);

const apiURL = "http://ip-api.com/json?fields=status,query,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile";

function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  const map = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷" };
  return map[code.toUpperCase()] || "🌐";
}

function render(d, policyName, groupName) {
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
  lines.push("策略组: " + groupName);
  lines.push("节点: " + policyName);
  lines.push("IP: " + d.query);
  lines.push("归属: " + flag + d.country + " · " + (d.city || d.regionName || "未知"));
  lines.push("运营商: " + (d.isp || "未知"));
  lines.push("类型: " + ipType);
  lines.push("风险: " + risk);
  lines.push("纯净度: " + score + "/100");

  $done({
    title: flag + " " + d.query,
    content: lines.join("\n"),
    icon: score >= 70 ? "checkmark.shield.fill" : score >= 40 ? "exclamationmark.shield.fill" : "xmark.shield.fill",
    "icon-color": score >= 70 ? "#34C759" : score >= 40 ? "#FF9500" : "#FF3B30"
  });
}

// 用 $httpAPI 读策略组
$httpAPI("GET", "/v1/policy_groups", null, function (result) {
  if (!result) {
    $done({ title: "读取失败", content: LINES.concat(["$httpAPI 返回空"]).join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }
  let raw = JSON.stringify(result);
  LINES.push("返回类型: " + typeof result);
  LINES.push("原始JSON: " + raw.substring(0, 400));
  let groups = Array.isArray(result) ? result : (result.groups || result);
  if (!Array.isArray(groups)) {
    $done({ title: "读取失败", content: LINES.concat(["groups非数组"]).join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }
  LINES.push("总组数: " + groups.length);
  const target = groups.find(function (g) { return g.name === groupName; });
  if (!target) {
    LINES.push("⚠️没找到「" + groupName + "」");
    LINES.push("可用组: " + groups.map(function(g){return g.name;}).slice(0,12).join(", "));
    $done({ title: "策略组未找到", content: LINES.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }
  const sel = target.selected || target.now;
  LINES.push("组: " + target.name);
  LINES.push("选中节点: " + (sel || "无"));
  if (!sel || sel === "None") {
    LINES.push("该组无选中节点");
    $done({ title: "无选中", content: LINES.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }
  // policy 指定出站请求
  $httpClient.get(apiURL, { policy: sel }, function (err, resp, data) {
    if (err || !data) {
      LINES.push("请求失败: " + JSON.stringify(err));
      $done({ title: "请求失败", content: LINES.join("\n"), icon: "wrench", "icon-color": "#FF3B30" });
      return;
    }
    try {
      var d = JSON.parse(data);
      if (d.status && d.status !== "success") { LINES.push("API异常: " + d.status); $done({ title:"API异常", content:LINES.join("\n"), icon:"wrench", "icon-color":"#FF9500" }); return; }
      render(d, sel, groupName);
    } catch (e) {
      LINES.push("解析失败: " + (data || "").substring(0, 60));
      $done({ title: "解析失败", content: LINES.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    }
  });
});