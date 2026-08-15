// Soul 抓包分析脚本：捕获 Soul API 请求，输出 URL 和关键认证信息
// 用法：配合 Surge MITM 使用，打开 Soul App 后查看脚本日志分析接口
// 分析阶段用，后续根据结果改写为签到脚本
// 修改者：mickeu（2026-08-15）

const STORE_KEY = "soul_capture_log";

function main() {
  const url = $request?.url || "";
  const headers = $request?.headers || {};
  
  // 提取关键认证信息（脱敏后输出）
  const authInfo = {
    url: url,
    // 常见认证头
    authorization: headers["Authorization"] || headers["authorization"] || "(无)",
    cookie: (headers["Cookie"] || headers["cookie"] || "").slice(0, 300),
    token: headers["x-token"] || headers["X-Token"] || headers["x-access-token"] || "(无)",
    ua: (headers["User-Agent"] || headers["user-agent"] || "").slice(0, 80)
  };
  
  $notification.post("Soul抓包", url.replace(/https?:\/\//, "").slice(0, 60), "查看控制台日志");
  
  // 输出到控制台 + 存持久化（供后续分析）
  console.log("===== Soul 请求 =====");
  console.log("URL: " + url);
  console.log("Authorization: " + (authInfo.authorization || "").slice(0, 200));
  console.log("Cookie: " + (authInfo.cookie || ""));
  console.log("Token头: " + authInfo.token);
  
  // 追加到持久化日志（保留最近 20 条）
  let log = $persistentStore.read(STORE_KEY) || "[]";
  try {
    const arr = JSON.parse(log);
    arr.push({ time: new Date().toISOString(), ...authInfo });
    while (arr.length > 20) arr.shift();
    $persistentStore.write(JSON.stringify(arr), STORE_KEY);
  } catch (e) {
    $persistentStore.write(JSON.stringify([authInfo]), STORE_KEY);
  }
  
  $done({});
}

main();