// 中国联通 App 每日签到（Surge）
// 抓 Cookie + 自动签到
// 修改者：mickeu（2026-08-15）

const KEY = "unicom_auth";

function read(key, def) {
  try { return JSON.parse($persistentStore.read(key) || "null") || def; } catch(e) { return def; }
}
function write(key, val) { $persistentStore.write(JSON.stringify(val), key); }

// ========== 捕获认证信息（http-request） ==========
function capture() {
  if (!$request) { $done({}); return; }
  const url = $request.url || "";
  const hd = $request.headers || {};
  const cookie = hd["Cookie"] || hd["cookie"] || "";
  const ua = hd["User-Agent"] || hd["user-agent"] || "";
  
  if (!url.match(/10010\.(com|cn)/)) { $done({}); return; }

  let data = read(KEY, {});
  if (cookie) { 
    data.cookie = cookie; 
    $notification.post("联通签到", "Cookie 已捕获", "url: " + url.replace(/https?:\/\//,"").slice(0, 40));
  } else {
    $notification.post("联通签到", "请求已捕获", "但未找到 Cookie，URL: " + url.replace(/https?:\/\//,"").slice(0, 40));
  }
  if (ua) { data.ua = ua; }
  write(KEY, data);
  $done({});
}

// ========== 每日签到（cron） ==========
function sign() {
  const data = read(KEY, {});
  const cookie = data.cookie || "";
  if (!cookie) {
    $notification.post("联通签到", "失败", "未捕获到 Cookie，请打开联通 App 后再试");
    $done();
    return;
  }

  const headers = {
    "Cookie": cookie,
    "User-Agent": data.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json, text/plain, */*"
  };

  // 签到接口 - 从抓包分析，m.client.10010.com 的通用接口格式
  const signUrl = "https://m.client.10010.com/mobileService/signin/sign.htm";
  const body = "mobile=18573908368&version=iphone_c@12.1400";

  $httpClient.post({ url: signUrl, headers: headers, body: body }, (err, resp, body) => {
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