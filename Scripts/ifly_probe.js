// 讯飞响应捕获（调试）：捕获讯飞 App 请求的响应（含 body），POST 到本机捕获服务器
function b64(s) {
  if (s == null) return '';
  try { return btoa(s); } catch (e) { return $utils.base64Encode(s); }
}
if ($response && $request) {
  let url = $request.url || '';
  let headers = $request.headers || {};
  let ua = headers['User-Agent'] || headers['user-agent'] || '';
  let isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
  if (isIfly) {
    let rheaders = $response.headers || {};
    let payload = {
      type: 'response',
      url: url,
      time: Math.floor(Date.now() / 1000),
      reqHeaders: headers,
      status: $response.status || 0,
      respHeaders: rheaders,
      respBodyB64: b64($response.body || '')
    };
    try {
      $httpClient.post({
        url: 'http://127.0.0.1:8123/capture',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, function (err, resp, data) {});
    } catch (e) {
      console.log('[iflyProbe] post err: ' + e);
    }
    console.log('[iflyProbe] ' + ($response.status || 0) + ' ' + url);
  }
}
$done();