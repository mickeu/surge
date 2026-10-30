// 讯飞协议探针（调试用）：捕获讯飞 App 商店/广告相关请求
// 输出 URL + Content-Type + body 摘要到通知，帮助确定 App 内真实协议
const KEY_HINT = /(getres|skin|theme|font|shop|classify|detail|list|rank|bought|valid|mine|diy|topic|search|download|ad|splash|reward|/resource)/i;
const HOST_HINT = /(imeclient\.openspeech\.cn|ime\.voicecloud\.cn|\.voicecloud\.cn|xfinfr\.com|openspeech\.cn|xfyun\.cn)/i;

function bytesOf(s) {
  // Surge 中 $response.body 为 Latin1 字符串，逐字符取字节码
  const out = [];
  for (let i = 0; i < s.length && i < 64; i++) out.push(s.charCodeAt(i));
  return out;
}

if ($response && $request) {
  let url = $request.url || '';
  let status = $response.status || 0;
  let headers = $response.headers || {};
  let ct = headers['Content-Type'] || headers['content-type'] || '';
  let body = $response.body || '';
  let isJSON = ct.indexOf('json') >= 0 || (/^\s*[{\[]/.test(body));
  let isProto = ct.indexOf('protobuf') >= 0 || ct.indexOf('octet-stream') >= 0 || ct.indexOf('binary') >= 0;
  let snippet = '';
  if (isJSON) {
    snippet = body.length > 180 ? body.slice(0, 180) + '...' : body;
  } else {
    const b = bytesOf(body);
    snippet = 'hex[' + b.length + ']: ' + b.map(x => x.toString(16).padStart(2, '0')).join(' ');
    if (/^[ -~]+$/.test(body.slice(0, 80))) snippet += ' | ascii: ' + body.slice(0, 80);
  }
  // 只通知关键 URL，且每个 URL 只通知一次
  let hit = KEY_HINT.test(url);
  let seenKey = 'ifly_probe_' + url.slice(0, 180);
  let seen = $persistentStore.read(seenKey);
  if (hit && !seen) {
    $persistentStore.write('1', seenKey);
    let shortUrl = url.length > 220 ? url.slice(0, 220) + '...' : url;
    let msg = 'HTTP ' + status + ' | ' + ct + (isJSON ? ' | JSON' : isProto ? ' | PROTO/BIN' : ' | other') + '\n' + snippet;
    $notification.post('讯飞探针', shortUrl, msg);
  }
  // 始终记录到脚本日志
  console.log('[iflyProbe] ' + status + ' ' + ct + ' ' + url);
  if (isJSON) console.log('[iflyProbe] body: ' + snippet);
  else console.log('[iflyProbe] body: ' + snippet);
}
$done();