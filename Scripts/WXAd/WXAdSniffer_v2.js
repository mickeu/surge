// 微信广告嗅探 v2 — HTTPS-RESPONSE
// 只看请求 URL + 响应体里的明确广告关键词
// 避免 "ad" 这类通用短词在响应体里误报

var URL_ADS = [
  "ad", "advertisement", "banner", "promo", "promotion",
  "campaign", "material", "creative", "suggestion",
  "recommend", "adsdk", "adver", "adv",
  "aditem", "adslot", "ad_unit", "ad_unit_id",
  "adinfo", "ad_id", "adid", "advertise",
  "finderad", "finderyz", "finderaly", "findera4", "findermp",
  "stat_url", "report_url", "impression_url", "click_url",
  "exposure", "ad_tag", "ad_style", "ad_desc", "ad_info"
];

var BODY_ADS = [
  // 明确广告字段，>= 5 字符避免误报
  "advertisement", "promotion", "banner_ad",
  "ad_id", "ad_info", "ad_content", "ad_desc", "ad_type",
  "ad_creatives", "ad_position", "ad_flag", "is_ad",
  "isAd", "adFlag", "adCount", "adCount",
  "finderaly", "finderad", "finderyz", "findera4",
  "kwai_ad", "reward_ad", "video_ad", "splash_ad",
  "comment_ad", "reply_ad", "footer_ad",
  "exposure_url", "click_url", "report_url", "impression_url",
  "advertising", "advertise"
];

var MAX_BODY = 1024 * 100;

var url = $request.url || "";
var hostname = url.split("/")[2] || "";
var response = $response;

if (!response) { $done(); return; }

var body = response.body;
var headers = response.headers || {};
var ct = headers["Content-Type"] || headers["content-type"] || "";
var bodyLen = body ? body.length : 0;

if (bodyLen > MAX_BODY) { $done(); return; }
if (ct.indexOf("image") >= 0 || ct.indexOf("video") >= 0 || ct.indexOf("audio") >= 0) {
  $done(); return;
}

var hits = [];

// URL 关键词（含短词）
var lowerUrl = url.toLowerCase();
for (var i = 0; i < URL_ADS.length; i++) {
  var kw = URL_ADS[i];
  if (lowerUrl.indexOf(kw) >= 0 && hits.indexOf(kw) < 0) {
    hits.push(kw);
  }
}

// 响应体关键词（仅长词，避免误报）
if (body && bodyLen > 0 && bodyLen < MAX_BODY) {
  var lowerBody = body.toLowerCase();
  for (var j = 0; j < BODY_ADS.length; j++) {
    var kw2 = BODY_ADS[j];
    if (lowerBody.indexOf(kw2) >= 0 && hits.indexOf(kw2) < 0) {
      hits.push(kw2);
    }
  }
}

if (hits.length > 0) {
  var bodyPreview = "";
  if (body && bodyLen > 0) {
    try {
      var parsed = JSON.parse(body);
      bodyPreview = JSON.stringify(parsed).substring(0, 400);
    } catch(e) {
      bodyPreview = body.substring(0, 400);
    }
  }

  var displayUrl = url
    .replace(/(access_token=)[^&]+/, "$1[隐藏]")
    .replace(/(openid=)[^&]+/, "$1[隐藏]")
    .replace(/(token=)[^&]+/, "$1[隐藏]");

  var ctStr = ct ? " | " + ct.split(";")[0] : "";
  var msg = hostname + "\n" + displayUrl.substring(0, 250) + "\n关键词: " + hits.join(", ") + "\n大小: " + bodyLen + "B" + ctStr + "\n--- 响应体预览 ---\n" + bodyPreview;
  $notification.post("🔍 微信广告嗅探", hostname + " (" + hits.length + "关键词)", msg);
}

$done();
