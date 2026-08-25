// ============================================
// IP 纯净度检测 - v8
// 版本标记: V8-RULE
// 不用 policy 参数，靠模块 [Rule] 段让 ip-api.com 走指定策略组
// 脚本只负责发请求 + 显示结果
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

let doneFlag = false;
function finish(obj) {
  if (doneFlag) return;
  doneFlag = true;
  try { $done(obj); } catch (e) {}
}
setTimeout(function () {
  finish({ title: "超时", content: "策略组: " + groupName + "\nip-api 请求超时", icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
}, 10000);

function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  const map = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷" };
  return map[code.toUpperCase()] || "🌐";
}

// 不指定 policy，靠 [Rule] 段的 DOMAIN-SUFFIX,ip-api.com,{{{GROUP}}} 走指定策略组
$httpClient.get(apiURL, function (error, response, data) {
  if (error || !data) {
    finish({ title: "请求失败", content: "策略组: " + groupName + "\n" + (error || "无数据"), icon: "exclamationmark.triangle", "icon-color": "#FF3B30" });
    return;
  }

  var d;
  try { d = JSON.parse(data); } catch (e) {
    finish({ title: "解析失败", content: "data: " + String(data).substring(0, 80), icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
    return;
  }

  if (d.status && d.status !== "success") {
    finish({ title: "API异常", content: "status: " + d.status, icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
    return;
  }

  var flag = getFlag(d.countryCode);
  var ipType = "🏠 住宅 IP";
  if (d.hosting) ipType = "🏢 数据中心";
  else if (d.proxy) ipType = "🔀 代理/VPN";
  else if (d.mobile) ipType = "📱 移动网络";
  var risk = "✅ 低风险";
  if (d.hosting && d.proxy) risk = "🔴 高风险";
  else if (d.hosting || d.proxy) risk = "🟡 中等风险";
  var score = 100;
  if (d.proxy) score -= 40;
  if (d.hosting) score -= 30;
  if (d.mobile) score -= 5;

  finish({
    title: flag + " " + d.query,
    content: ["策略组: " + groupName, "IP: " + d.query, "归属: " + flag + d.country + " · " + (d.city || d.regionName || "未知"), "运营商: " + (d.isp || "未知"), "AS: " + (d.as || "未知"), "类型: " + ipType, "风险: " + risk, "纯净度: " + score + "/100"].join("\n"),
    icon: score >= 70 ? "checkmark.shield.fill" : score >= 40 ? "exclamationmark.shield.fill" : "xmark.shield.fill",
    "icon-color": score >= 70 ? "#34C759" : score >= 40 ? "#FF9500" : "#FF3B30"
  });
});