/* 更新时间：2026.11.03 13:18。只处理首页与个人页已确认的推广字段，未知结构原样放行。 */
'use strict';
(function () {
  try {
    if (!$request || !$response || typeof $request.url !== 'string' || typeof $response.body !== 'string') return $done({});
    var url = $request.url.split('?')[0];
    if (!/^https:\/\/api\.pinduoduo\.com\/api\/(alexa\/homepage\/hub|philo\/personal\/hub)$/.test(url)) return $done({});
    var body = JSON.parse($response.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return $done({});
    var root = body.result && typeof body.result === 'object' && !Array.isArray(body.result) ? body.result : body;
    var changed = false;
    function text(v) { return typeof v === 'string' ? v : ''; }
    function removeArray(key, match) {
      if (!Array.isArray(root[key])) return;
      var before = root[key].length;
      root[key] = root[key].filter(function (item) { return !match(item || {}); });
      if (root[key].length !== before) changed = true;
    }
    if (url.indexOf('/api/alexa/homepage/hub') !== -1) {
      removeArray('icon_set', function (x) {
        var title = text(x.title), link = (text(x.link) || text(x.link_url)).toLowerCase();
        return x.id === 256 || x.id === 267 || title === '9块9特卖' || title === '省钱月卡' ||
          link.indexOf('sjs_special_nine') !== -1 || link.indexOf('hub_monthly_card') !== -1;
      });
      removeArray('all_top_opts', function (x) {
        var title = text(x.opt_name) || text(x.title);
        return title.indexOf('11.11') !== -1 && (title.indexOf('大促') !== -1 || title.indexOf('领券') !== -1);
      });
      ['bottom_tabs', 'buffer_bottom_tabs'].forEach(function (key) {
        removeArray(key, function (x) {
          var title = text(x.title), link = (text(x.link) || text(x.link_url)).toLowerCase();
          return x.id === 207 || title === '多多视频' || title === '点我领券' ||
            link.indexOf('pdd_live_tab_list') !== -1 || link.indexOf('attendance.html') !== -1;
        });
      });
    } else if (Object.prototype.hasOwnProperty.call(root, 'monthly_card_entrance')) {
      delete root.monthly_card_entrance;
      changed = true;
    }
    if (!changed) return $done({});
    console.log('PDD_ADBLOCK_V4 changed ' + url);
    $done({ body: JSON.stringify(body) });
  } catch (e) {
    console.log('PDD_ADBLOCK_V4 parse_error');
    $done({});
  }
})();
