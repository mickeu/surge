// ============================================
// IP 纯净度检测 - 最终版 v4
// 版本标记: FINAL-V4
// 直接用 $httpClient policy 传策略组名出站
// 不依赖 $httpAPI / $surge API
// ============================================

let groupName = "PROXY";
if (typeof $argument !== "undefined" && $argument) {
  const params = String($argument).split("&");
  for (const p of params) {
    const idx = p.indexOf("=");
    if (idx > 0 && p.slice(0, idx).trim() === "group") groupName = p.slice(idx + 1).trim();
  }
}

const apiURL = "http://ip-api.com/json?fields=status,query,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile";

function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  const map = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷" };
  return map[code.toUpperCase()] || "🌐";
}

// 直接指定策略组发请求
$httpClient.get(apiURL, { policy: groupName }, function (error, response, data) {
  if (error || !data) {
    $done({ title: "请求失败", content: "策略组: " + groupName + "\n" + (error || "无数据"), icon: "exclamationmark.triangle", "icon-color": "#FF3B30" });
    return;
  }

  let d;
  try { d = JSON.parse(data); } catch (e) {
    $done({ title: "解析失败", content: "无法解析数据: " + String(data).substring(0, 80), icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
    return;
  }

  if (d.status && d.status !== "success") {
    $done({ title: "API 异常", content: "状态: " + d.status + "\nIP: " + (d.query || "?"), icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
    return;
  }

  // 渲染结果
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
  lines.push("IP: " + d.query);
  lines.push("归属: " + flag + d.country + " · " + (d.city || d.regionName || "未知"));
  lines.push("运营商: " + (d.isp || "未知"));
  lines.push("AS: " + (d.as || "未知"));
  lines.push("类型: " + ipType);
  lines.push("风险: " + risk);
  lines.push("纯净度: " + score + "/100");

  $done({
    title: flag + " " + d.query,
    content: lines.join("\n"),
    icon: score >= 70 ? "checkmark.shield.fill" : score >= 40 ? "exclamationmark.shield.fill" : "xmark.shield.fill",
    "icon-color": score >= 70 ? "#34C759" : score >= 40 ? "#FF9500" : "#FF3B30"
  });
});