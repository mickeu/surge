/* 更新时间：2026.11.03 10:20。只记录首页入口的字段名和数组形状，不修改响应、不记录正文。 */
'use strict';
(function () {
  try {
    var u = ($request && $request.url) || '';
    if (!/^https:\/\/api\.pinduoduo\.com\/api\/alexa\/homepage\/hub(?:\?|$)/.test(u)) return $done({});
    var body = $response && $response.body;
    if (typeof body !== 'string' || body.length > 2097152) return $done({});
    var d = JSON.parse(body);
    var r = d && (d.result || d.data);
    function shape(x) { return Array.isArray(x) ? 'array(' + x.length + ')' : x && typeof x === 'object' ? Object.keys(x).slice(0,35).join('|') : typeof x; }
    var out = ['PDD_OBSERVE_V2', 'status=' + (($response && $response.status) || ''), 'root=' + shape(d), 'result=' + shape(r)];
    if (r && typeof r === 'object') ['bottom_tabs','buffer_bottom_tabs','all_top_opts','icon_set','dy_module'].forEach(function(k){
      if (!(k in r)) return;
      var v=r[k];out.push(k + '=' + shape(v));
      if (Array.isArray(v)) out.push(k + '_fields=' + v.slice(0,8).map(function(e){return e && typeof e === 'object' ? Object.keys(e).slice(0,15).join('|') : typeof e;}).join(';'));
      if (k === 'dy_module' && v && typeof v === 'object') Object.keys(v).slice(0,15).forEach(function(t){out.push('dy.'+t+'='+shape(v[t]));});
    });
    console.log(out.join(' '));
  } catch(e) { console.log('PDD_OBSERVE_V2 parse_error=' + (e && e.name || 'unknown')); }
  $done({});
})();
