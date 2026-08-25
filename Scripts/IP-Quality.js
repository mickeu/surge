// IP 纯净度检测 - 诊断版
// 把所有关键中间结果输出到面板，一眼看出卡在哪一环

let groupName = "PROXY";
if (typeof $argument !== "undefined" && $argument) {
  const params = String($argument).split("&");
  for (const p of params) {
    const idx = p.indexOf("=");
    if (idx > 0) {
      const k = p.slice(0, idx).trim();
      if (k === "group") groupName = p.slice(idx + 1).trim();
    }
  }
}

const lines = [];
lines.push("【诊断】");
lines.push("参数 group: " + groupName);

// 1. 用 selectGroupDetails 读策略组
let details;
try {
  details = $surge.selectGroupDetails();
  lines.push("selectGroupDetails: " + (details ? "成功" : "返回空"));
} catch (e) {
  lines.push("selectGroupDetails 异常: " + String(e));
}

if (details) {
  const groups = details.groups;
  const decisions = details.decisions;
  lines.push("总策略组数: " + Object.keys(groups || {}).length);

  lines.push("包含 AIGC: " + (groups && groupName in groups));
  lines.push("包含 AlGC: " + (groups && "AlGC" in groups));
  lines.push("包含 PROXY: " + (groups && "PROXY" in groups));

  if (groups && groups[groupName]) {
    const sel = decisions[groupName];
    lines.push("「" + groupName + "」选中: " + (sel || "无"));
    lines.push("子策略数: " + (groups[groupName] ? groups[groupName].length : "?"));

    if (sel) {
      // 2. 尝试用 policy 发请求
      lines.push("→ 用 policy=" + sel + " 请求 ip-api");
      $httpClient.get("http://ip-api.com/json?fields=status,query,country,isp,proxy,hosting", { policy: sel }, function(err, resp, data) {
        if (err) {
          lines.push("请求失败: " + JSON.stringify(err));
          lines.push("响应状态: " + (resp && resp.status));
          $done({ title: "诊断 - " + groupName, content: lines.join("\n"), icon: "wrench.and.screwdriver", "icon-color": "#FF9500" });
          return;
        }
        try {
          const d = JSON.parse(data);
          lines.push("结果IP: " + (d.query || "?"));
          lines.push("归属: " + (d.country || "?"));
          lines.push("proxy: " + d.proxy + " | hosting: " + d.hosting);
        } catch(e) {
          lines.push("解析失败: " + (data || "").substring(0, 60));
        }
        $done({ title: "诊断 - " + groupName, content: lines.join("\n"), icon: "wrench.and.screwdriver", "icon-color": "#FF9500" });
      });
      return; // 异步等待回调
    } else {
      lines.push("该组无选中节点");
    }
  } else {
    lines.push("⚠️ 找不到策略组「" + groupName + "」");
    if (groups) {
      lines.push("可用组(前15): " + Object.keys(groups).slice(0, 15).join(", "));
    }
  }
}

$done({ title: "诊断 - " + groupName, content: lines.join("\n"), icon: "wrench.and.screwdriver", "icon-color": "#FF9500" });