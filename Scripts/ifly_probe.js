// 讯飞响应捕获（调试）：捕获讯飞 App 请求的响应（含 body），POST 到本机捕获服务器
// b64 兼容 string 与 Uint8Array；关键接口弹通知便于确认触发
function b64(input) {
  if (input == null) return '';
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var get = typeof input === 'string' ? function (i) { return input.charCodeAt(i); } : function (i) { return input[i]; };
  var len = input.length;
  var out = '', i;
  for (i = 0; i + 2 < len; i += 3) {
    var n = (get(i) << 16) | (get(i + 1) << 8) | get(i + 2);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  var rem = len - i;
  if (rem === 1) {
    var n1 = get(i) << 16;
    out += chars[(n1 >> 18) & 63] + chars[(n1 >> 12) & 63] + '==';
  } else if (rem === 2) {
    var n2 = (get(i) << 16) | (get(i + 1) << 8);
    out += chars[(n2 >> 18) & 63] + chars[(n2 >> 12) & 63] + chars[(n2 >> 6) & 63] + '=';
  }
  return out;
}
var finished = false;
function finish() {
  if (!finished) { finished = true; $done(); }
}
try {
  if ($response && $request) {
    var url = $request.url || '';
    var headers = $request.headers || {};
    var ua = headers['User-Agent'] || headers['user-agent'] || '';
    var isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
    if (isIfly) {
      var rheaders = $response.headers || {};
      var payload = {
        type: 'response',
        url: url,
        time: Math.floor(Date.now() / 1000),
        reqHeaders: headers,
        status: $response.status || 0,
        respHeaders: rheaders,
        respBodyB64: b64($response.body)
      };
      var posted = false;
      $httpClient.post({
        url: 'http://127.0.0.1:8123/capture',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, function (err, resp, data) {
        posted = true;
        if (err) {
          console.log('[iflyProbe] POST FAIL ' + url + ' err=' + err);
          if (/(resEnableCheck|queryUserVips|vip|order\/submit)/i.test(url)) {
            $notification.post('讯飞探针-回传失败', url.slice(0, 120), 'err=' + err);
          }
        }
        finish();
      });
      setTimeout(function () { if (!posted) { console.log('[iflyProbe] POST TIMEOUT ' + url); } finish(); }, 3000);
      // 关键接口弹通知确认触发（每 URL 一次）
      if (/(resEnableCheck|queryUserVips|\/vip\/|order\/submit)/i.test(url)) {
        var seenKey = 'ifly_note_r_' + url.slice(0, 160);
        if (!$persistentStore.read(seenKey)) {
          $persistentStore.write('1', seenKey);
          $notification.post('讯飞探针响应', url.slice(0, 180), 'HTTP ' + ($response.status || 0) + ' ' + (rheaders['Content-Type'] || rheaders['content-type'] || ''));
        }
      }
    } else {
      finish();
    }
  } else {
    finish();
  }
} catch (e) {
  console.log('[iflyProbe] err: ' + e);
  finish();
}