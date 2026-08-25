// IP 纯净度检测 - $httpAPI 版本
let groupName = "PROXY";
if (typeof $argument !== "undefined" && $argument) {
  const params = String($argument).split("&");
  for (const p of params) {
    const idx = p.indexOf("=");
    if (idx > 0 && p.slice(0, idx).trim() === "group") groupName = p.slice(idx + 1).trim();
  }
}

// 用 $httpAPI 读策略组
$httpAPI("GET", "/v1/policy_groups", null, function (result) {
  const lines = [];
  lines.push("参数: " + groupName);

  if (!result) {
    lines.push("$httpAPI 返回空");
    $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  // 兼容 {groups:[...]} 或直接数组
  let groups = result.groups ? result.groups : result;
  if (!Array.isArray(groups)) {
    lines.push("返回格式: " + JSON.stringify(result).substring(0, 100));
    $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  lines.push("总组数: " + groups.length);
  lines.push("含AIGC: " + groups.some((g) => g.name === "AIGC"));
  lines.push("含PROXY: " + groups.some((g) => g.name === "PROXY"));

  const target = groups.find((g) => g.name === groupName);
  if (!target) {
    lines.push("找不到「" + groupName + "」");
    lines.push("可用: " + groups.map((g) => g.name).slice(0, 10).join(", "));
    $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    return;
  }

  lines.push("组: " + target.name + " | type: " + target.type);
  const sel = target.selected || target.now || "?";
  lines.push("选中: " + sel);

  if (sel && sel !== "?" && sel !== "None") {
    lines.push("→ policy 请求…");
    $httpClient.get("http://ip-api.com/json?fields=status,query,country", { policy: sel }, function (err, resp, data) {
      if (err) { lines.push("请求失败: " + JSON.stringify(err)); $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" }); return; }
      try {
        const d = JSON.parse(data);
        lines.push("结果IP: " + d.query);
        lines.push("归属: " + d.country);
      } catch (e) { lines.push("解析失败: " + data); }
      $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
    });
  } else {
    $done({ title: "诊断", content: lines.join("\n"), icon: "wrench", "icon-color": "#FF9500" });
  }
});