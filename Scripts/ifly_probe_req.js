// 讯飞请求探针（调试用）：捕获讯飞 App 的所有 HTTPS 请求 URL
// 不依赖 hostname 列表：匹配所有 https 请求，按 UA/域名过滤讯飞相关
if ($request) {
  let url = $request.url || '';
  let headers = $request.headers || {};
  let ua = headers['User-Agent'] || headers['user-agent'] || '';
  // 讯飞 App 的 UA 通常含 iflytek/iFlytekIME；域名兜底
  let isIfly = /iflytek/i.test(ua) || /(openspeech|voicecloud|xfinfr|xfyun|iflytek)\./i.test(url);
  if (isIfly) {
    let seenKey = 'ifly_req_' + url.slice(0, 180);
    if (!$persistentStore.read(seenKey)) {
      $persistentStore.write('1', seenKey);
      let shortUrl = url.length > 240 ? url.slice(0, 240) + '...' : url;
      $notification.post('讯飞请求', shortUrl, 'UA: ' + ua.slice(0, 100));
    }
    console.log('[iflyProbeReq] ' + url + ' | UA: ' + ua);
  }
}
$done({});