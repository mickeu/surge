// 中国联通 App 每日签到（Surge）
// 抓取 URL 认证参数（unikey/deviceId/mobile）+ 自动签到
// 修改者：mickeu（2026-08-15）

const KEY = "unicom_auth";

function read(key, def) {
  try { return JSON.parse($persistentStore.read(key) || "null") || def; } catch(e) { return def; }
}
function write(key, val) { $persistentStore.write(JSON.stringify(val), key); }

function parseQuery(url) {
  const q = {};
  const m = url.split("?")[1];
  if (!m) return q;
  m.split("&").forEach(p => {
    const kv = p.split("=");
    if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || "");
  });
  return q;
}

// ========== 捕获认证信息（http-request） ==========
function capture() {
  if (!$request) { $done({}); return; }
  const url = $request.url || "";
  const hd = $request.headers || {};
  
  if (!url.match(/10010\.(com|cn)/)) { $done({}); return; }

  const cookie = hd["Cookie"] || hd["cookie"] || "";
  const params = parseQuery(url);
  
  let data = read(KEY, {});
  let captured = [];
  
  if (cookie) { data.cookie = cookie; captured.push("Cookie"); }
  if (params["unikey"]) { data.unikey = params["unikey"]; captured.push("unikey"); }
  if (params["deviceId"]) { data.deviceId = params["deviceId"]; captured.push("deviceId"); }
  if (params["mobile"]) { data.mobile = params["mobile"]; captured.push("mobile"); }
  if (params["appId"]) { data.appId = params["appId"]; captured.push("appId"); }
  if (hd["User-Agent"] || hd["user-agent"]) { data.ua = hd["User-Agent"] || hd["user-agent"]; }
  
  if (captured.length > 0) {
    write(KEY, data);
    $notification.post("联通签到", "认证信息已捕获", captured.join(" + ") + "，URL: " + url.replace(/https?:\/\//,"").slice(0, 30));
  } else {
    $notification.post("联通签到", "请求已捕获", "未提取到认证参数，URL: " + url.replace(/https?:\/\//,"").slice(0, 40));
  }
  $done({});
}

// ========== 每日签到（cron） ==========
function sign() {
  const data = read(KEY, {});
  const unikey = data.unikey || "";
  const mobile = data.mobile || "18573908368";
  
  if (!unikey && !data.cookie) {
    $notification.post("联通签到", "失败", "未捕获到认证信息，请打开联通 App 后再试");
    $done();
    return;
  }

  const headers = {
    "User-Agent": data.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json, text/plain, */*"
  };
  if (data.cookie) headers["Cookie"] = data.cookie;

  // 签到接口（用 URL 参数认证）
  const params = [];
  if (unikey) params.push("unikey=" + encodeURIComponent(unikey));
  if (data.deviceId) params.push("deviceId=" + encodeURIComponent(data.deviceId));
  if (data.appId) params.push("appId=" + encodeURIComponent(data.appId));
  params.push("mobile=" + encodeURIComponent(mobile));
  params.push("version=iphone_c@12.1400");

  const signUrl = "https://m.client.10010.com/mobileService/signin/sign.htm?" + params.join("&");
  console.log("签到 URL: " + signUrl);

  $httpClient.get({ url: signUrl, headers: headers, timeout: 20 }, (err, resp, body) => {
    if (err) {
      $notification.post("联通签到", "请求失败", err);
      $done();
      return;
    }
    console.log("签到响应: " + (body || "").slice(0, 500));
    $notification.post("联通签到", "响应结果", (body || "").slice(0, 200));
    $done();
  });
}

// ========== 入口 ==========
const t = ($script && $script.type) || "";
if (t === "http-request") capture();
else if (t === "cron") sign();
else { $done({}); }