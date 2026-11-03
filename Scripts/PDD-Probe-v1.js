/* 更新时间：2026.11.03 09:40。只记录接口路径和响应字段名，不保存内容。 */
(function () {
  var url = ($request && $request.url) || '';
  var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  var host = (url.match(/^https?:\/\/([^/]+)/) || [,''])[1];
  var headers = ($response && $response.headers) || {};
  var type = String(headers['Content-Type'] || headers['content-type'] || '').split(';')[0];
  var body = ($response && $response.body) || '';
  var parts = ['PDD_PROBE', host + path, 'status=' + ($response.status || 0), 'type=' + type, 'bytes=' + body.length];
  if (body && body.length < 524288 && /^[\s]*[\[{]/.test(body)) {
    try {
      var data = JSON.parse(body);
      var keys = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).slice(0, 35).join('|') : '-'; };
      parts.push('root=' + keys(data));
      parts.push('result=' + keys(data.result));
      parts.push('data=' + keys(data.data));
      if (data.result && data.result.dy_module) parts.push('dy_module=' + keys(data.result.dy_module));
      if (data.result && Array.isArray(data.result.bottom_tabs)) parts.push('tabs=' + data.result.bottom_tabs.map(function(x){return Object.keys(x || {}).join('|');}).slice(0, 5).join(';'));
    } catch (e) { parts.push('json=invalid'); }
  }
  console.log(parts.join(' '));
  $done({});
})();
