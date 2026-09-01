// 微信广告嗅探 — 请求版
// 类型：generic，由 HTTPS-REQUEST rewrite 触发
// 目的：记录疑似广告 API 的 URL，通过通知弹出

var AD_KEYWORDS = [
  "ad", "advertisement", "banner", "promo", "promotion",
  "campaign", "material", "creative", "suggestion",
  "recommend", "adsdk", "adver", "adv",
  "aditem", "adslot", "ad_unit", "ad_unit_id",
  "adinfo", "ad_id", "adid", "advertise",
  "finderad", "finderyz", "finderaly", "findera4", "findermp",
  "stat", "report", "click", "impression",
  "feed", "flow", "timeline", "home_timeline",
  "comment", "reply",
  "openapp", "openlist"
];

var media_ext = /\.(jpg|jpeg|png|gif|webp|mp4|mp3|flac|ogg|wasm|woff|woff2|ttf|otf|swf|ico)(\?|$)/i;

var url = $request.url || "";
var method = $request.method || "GET";
var hostname = url.split("/")[2] || "";
var headers = $request.headers || {};
var ct = headers["Content-Type"] || headers["content-type"] || "";
var ua = headers["User-Agent"] || headers["user-agent"] || "";
var query = url.indexOf("?") >= 0 ? url.substring(url.indexOf("?")) : "";

// 跳过媒体资源
if (media_ext.test(url)) { $done(); return; }

// 计算广告关键词命中
var hits = [];
var lowerUrl = url.toLowerCase();
for (var i = 0; i < AD_KEYWORDS.length; i++) {
  var kw = AD_KEYWORDS[i];
  if (lowerUrl.indexOf(kw) >= 0) hits.push(kw);
}

// 命中至少 1 个关键词才弹通知
if (hits.length > 0) {
  // 隐藏敏感参数
  var displayUrl = url.replace(/(access_token=)[^&]+/, "$1[隐藏]").replace(/(openid=)[^&]+/, "$1[隐藏]").replace(/(token=)[^&]+/, "$1[隐藏]");
  var ctInfo = ct ? " | " + ct.split(";")[0] : "";
  var msg = hostname + "\n" + displayUrl.substring(0, 300) + "\n关键词: " + hits.join(", ") + "\n" + method + ctInfo;
  $notification.post("🔍 微信广告嗅探", hostname + " (" + hits.length + "关键词)", msg);
}

$done();
