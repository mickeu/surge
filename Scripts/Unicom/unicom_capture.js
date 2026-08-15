// 中国联通 App 抓包分析脚本：捕获联通 API 请求，输出 URL 和关键认证信息
// 分析阶段用，后续根据结果改写为签到脚本
// 修改者：mickeu（2026-08-15）

const STORE_KEY = "unicom_capture_log";

function main() {
  const url = $request ? ($request.url || "") : "";
  const headers = $request ? ($request.headers || {}) : {};
  
  // 提取关键认证信息
  const authInfo = {
    url: url,
    authorization: headers["Authorization"] || headers["authorization"] || "(无)",
    cookie: (headers["Cookie"] || headers["cookie"] || "").slice(0, 300),
    token: headers["x-token"] || headers["X-Token"] || headers["x-access-token"] || headers["token"] || "(无)",
    ua: (headers["User-Agent"] || headers["user-agent"] || "").slice(0, 80)
  };
  
  $notification.post("联通抓包", url.replace(/https?:\/\//, "").slice(0, 60), "查看控制台日志");
  
  console.log("===== 联通请求 =====");
  console.log("URL: " + url);
  console.log("Authorization: " + (authInfo.authorization || "").slice(0, 200));
  console.log("Cookie: " + (authInfo.cookie || ""));
  console.log("Token: " + authInfo.token);
  
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