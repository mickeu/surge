// 讯飞协议探针（调试用）：捕获讯飞 App 请求的响应，通知 URL + Content-Type + body 摘要
// 匹配所有 https 响应，按 UA/域名过滤讯飞相关（不依赖具体 hostname）
function bytesOf(s) {
  const out = [];
  for (let i = 0; i < s.length && i < 64; i++) out.push(s.charCodeAt(i));
  return out;
}

if ($response && $request) {
  let url = $request.url || '';
  let headers = $request.headers || {};
  let ua = headers['User-Agent'] || headers['user-agent'] || '';
  let isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
  if (isIfly) {
    let status = $response.status || 0;
    let rheaders = $response.headers || {};
    let ct = rheaders['Content-Type'] || rheaders['content-type'] || '';
    let body = $response.body || '';
    let isJSON = ct.indexOf('json') >= 0 || (/^\s*[{\[]/.test(body));
    let isProto = ct.indexOf('protobuf') >= 0 || ct.indexOf('octet-stream') >= 0 || ct.indexOf('binary') >= 0;
    let snippet = '';
    if (isJSON) {
      snippet = body.length > 180 ? body.slice(0, 180) + '...' : body;
    } else {
      const b = bytesOf(body);
      snippet = 'hex[' + b.length + ']: ' + b.map(x => x.toString(16).padStart(2, '0')).join(' ');
    }
    let seenKey = 'ifly_probe_' + url.slice(0, 180);
    if (!$persistentStore.read(seenKey)) {
      $persistentStore.write('1', seenKey);
      let shortUrl = url.length > 200 ? url.slice(0, 200) + '...' : url;
      let msg = 'HTTP ' + status + ' | ' + ct + (isJSON ? ' | JSON' : isProto ? ' | PROTO/BIN' : ' | other') + '\n' + snippet;
      $notification.post('讯飞探针', shortUrl, msg);
    }
    console.log('[iflyProbe] ' + status + ' ' + ct + ' ' + url);
    console.log('[iflyProbe] body: ' + snippet);
  }
}
$done();