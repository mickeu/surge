// IP 纯净度检测 - v7
// 版本标记: V7-MAP
// 测试 $httpAPI 返回结构：直接用 result[groupName] 取选中节点
// 然后用 setSelectGroupPolicy 临时切 PROXY + 默认规则出口测 IP + 切回

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
  finish({ title: "超时", content: "策略组: " + groupName + "\n9秒超时", icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
}, 12000);

function getFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  const map = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷" };
  return map[code.toUpperCase()] || "🌐";
}

// 用 $httpAPI 读策略组
$httpAPI("GET", "/v1/policy_groups", null, function (result) {
  if (!result) {
    finish({ title: "读取失败", content: "策略组: " + groupName + "\n$httpAPI 返回空", icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  // 尝试多种结构
  var selectedNode = null;
  var diag = [];

  if (Array.isArray(result)) {
    // 数组形式 {groups:[{name,selected}]}
    var found = result.find(function (g) { return g.name === groupName; });
    if (found) selectedNode = found.selected || found.now;
    diag.push("结构: 数组");
  } else if (result.groups && Array.isArray(result.groups)) {
    var f2 = result.groups.find(function (g) { return g.name === groupName; });
    if (f2) selectedNode = f2.selected || f2.now;
    diag.push("结构: {groups:[]}");
  } else if (result.decisions) {
    // {decisions:{groupName: selectedNode}}
    selectedNode = result.decisions[groupName];
    diag.push("结构: {decisions:{}}");
  } else {
    // 纯对象 {groupName: selectedNode 或 [子节点列表]}
    var val = result[groupName];
    if (typeof val === "string") selectedNode = val;
    diag.push("结构: 对象映射");
    diag.push("result[groupName]类型: " + typeof val);
    if (val) diag.push("result[groupName]值: " + JSON.stringify(val).substring(0, 60));
  }

  diag.push("选中节点: " + (selectedNode || "未找到"));
  diag.push("keys: " + Object.keys(result).slice(0, 8).join(","));

  if (!selectedNode) {
    // 输出完整结构帮助诊断
    diag.push("完整JSON: " + JSON.stringify(result).substring(0, 200));
    finish({ title: "未找到节点", content: "策略组: " + groupName + "\n" + diag.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  // 读到节点后，临时把 PROXY 切到这个节点，测完切回
  // 先读 PROXY 当前选中（用于恢复）
  var proxyOriginal = null;
  if (result.decisions) proxyOriginal = result.decisions["PROXY"];
  else if (typeof result["PROXY"] === "string") proxyOriginal = result["PROXY"];
  diag.push("PROXY原节点: " + (proxyOriginal || "未知"));

  // 临时切换 PROXY 到目标节点
  var switched = false;
  try { switched = $surge.setSelectGroupPolicy("PROXY", selectedNode); } catch (e) {
    diag.push("切换异常: " + String(e));
  }
  diag.push("切换PROXY: " + (switched ? "成功" : "失败"));

  if (!switched) {
    finish({ title: "切换失败", content: "策略组: " + groupName + "\n节点: " + selectedNode + "\n" + diag.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  // 用默认出口发请求（ip-api 走 FINAL→PROXY→目标节点）
  $httpClient.get(apiURL, {}, function (err, resp, data) {
    // 无论结果如何，先切回 PROXY 原节点
    if (proxyOriginal) {
      try { $surge.setSelectGroupPolicy("PROXY", proxyOriginal); } catch (e) {}
    }

    if (err || !data) {
      finish({ title: "请求失败", content: "策略组: " + groupName + "\n节点: " + selectedNode + "\n" + diag.join("\n") + "\nerr: " + JSON.stringify(err), icon: "exclamationmark.triangle", "icon-color": "#FF3B30" });
      return;
    }
    var d;
    try { d = JSON.parse(data); } catch (e) {
      finish({ title: "解析失败", content: "策略组: " + groupName + "\n" + diag.join("\n") + "\ndata: " + String(data).substring(0, 60), icon: "wrench", "icon-color": "#FF9500" });
      return;
    }
    if (d.status && d.status !== "success") {
      finish({ title: "API异常", content: "策略组: " + groupName + "\n" + diag.join("\n") + "\nstatus: " + d.status, icon: "wrench", "icon-color": "#FF9500" });
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
      content: ["策略组: " + groupName, "节点: " + selectedNode, "IP: " + d.query, "归属: " + flag + d.country + " · " + (d.city || d.regionName || "未知"), "运营商: " + (d.isp || "未知"), "类型: " + ipType, "风险: " + risk, "纯净度: " + score + "/100"].join("\n"),
      icon: score >= 70 ? "checkmark.shield.fill" : score >= 40 ? "exclamationmark.shield.fill" : "xmark.shield.fill",
      "icon-color": score >= 70 ? "#34C759" : score >= 40 ? "#FF9500" : "#FF3B30"
    });
  });
});