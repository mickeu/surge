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
  if (!$request) return;
  const url = $request.url || "";
  const hd = $request.headers || {};
  const cookie = hd["Cookie"] || hd["cookie"] || "";
  const ua = hd["User-Agent"] || hd["user-agent"] || "";
  if (!url.match(/10010\.(com|cn)/)) return;

  let data = read(KEY, {});
  if (cookie) { data.cookie = cookie; console.log("Cookie: OK"); }
  if (ua) { data.ua = ua; }
  write(KEY, data);
  $done();
}

// ========== 每日签到（cron） ==========
function sign() {
  const data = read(KEY, {});
  const cookie = data.cookie || "";
  if (!cookie) {
    $notification.post("联通签到", "失败", "未捕获到 Cookie，请打开联通 App 后再试");
    return $done();
  }

  const headers = {
    "Cookie": cookie,
    "User-Agent": data.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json, text/plain, */*"
  };

  // 签到接口（从抓包 + JS 分析推断）
  const signUrl = "https://m.client.10010.com/mobileService/signin/sign.htm";
  const body = "mobile=18573908368&version=iphone_c@12.1400";

  $httpClient.post({ url: signUrl, headers: headers, body: body }, (err, resp, body) => {
    if (err) {
      $notification.post("联通签到", "请求失败", err);
      return $done();
    }
    console.log("签到响应: " + (body || "").slice(0, 300));
    try {
      const j = JSON.parse(body);
      if (j.code === "0000" || j.status === "0000" || j.returnCode === "0000") {
        $notification.post("联通签到", "成功", j.msg || j.message || "签到成功");
      } else {
        // 接口不对，告诉用户实际响应
        $notification.post("联通签到", "签到结果", (j.msg || j.message || body || "").slice(0, 120));
      }
    } catch(e) {
      $notification.post("联通签到", "响应原始", (body || "").slice(0, 120));
    }
    $done();
  });
}

// ========== 入口 ==========
const t = ($script && $script.type) || "";
if (t === "http-request") capture();
else if (t === "cron") sign();
else { if (typeof $done === "function") $done(); }