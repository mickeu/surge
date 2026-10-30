// 讯飞请求捕获（调试）：捕获讯飞 App 请求 URL + 头 + body，POST 到本机捕获服务器
// 纯 JS base64（不依赖 btoa/$utils），全程 try-catch 保证不影响正常网络
function b64(s) {
  if (!s) return '';
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '', i;
  for (i = 0; i + 2 < s.length; i += 3) {
    var n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  var rem = s.length - i;
  if (rem === 1) {
    var n1 = s.charCodeAt(i) << 16;
    out += chars[(n1 >> 18) & 63] + chars[(n1 >> 12) & 63] + '==';
  } else if (rem === 2) {
    var n2 = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8);
    out += chars[(n2 >> 18) & 63] + chars[(n2 >> 12) & 63] + chars[(n2 >> 6) & 63] + '=';
  }
  return out;
}
try {
  if ($request) {
    var url = $request.url || '';
    var headers = $request.headers || {};
    var ua = headers['User-Agent'] || headers['user-agent'] || '';
    var isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
    if (isIfly) {
      var body = $request.body || '';
      var payload = {
        type: 'request',
        url: url,
        time: Math.floor(Date.now() / 1000),
        reqHeaders: headers,
        reqBodyB64: b64(body)
      };
      $httpClient.post({
        url: 'http://127.0.0.1:8123/capture',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, function (err, resp, data) {});
      console.log('[iflyProbeReq] ' + url);
    }
  }
} catch (e) {
  console.log('[iflyProbeReq] err: ' + e);
}
$done({});