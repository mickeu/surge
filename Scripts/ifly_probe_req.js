// 讯飞请求捕获（调试）：捕获讯飞 App 请求 URL + 头 + body，POST 到本机捕获服务器
function b64(s) {
  if (s == null) return '';
  try { return btoa(s); } catch (e) { return $utils.base64Encode(s); }
}
if ($request) {
  let url = $request.url || '';
  let headers = $request.headers || {};
  let ua = headers['User-Agent'] || headers['user-agent'] || '';
  let isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
  if (isIfly) {
    let body = $request.body || '';
    let payload = {
      type: 'request',
      url: url,
      time: Math.floor(Date.now() / 1000),
      reqHeaders: headers,
      reqBodyB64: b64(body)
    };
    try {
      $httpClient.post({
        url: 'http://127.0.0.1:8123/capture',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, function (err, resp, data) {});
    } catch (e) {
      console.log('[iflyProbeReq] post err: ' + e);
    }
    console.log('[iflyProbeReq] ' + url);
  }
}
$done({});