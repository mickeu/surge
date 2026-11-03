/* 更新时间：2026.11.03 10:36。只删除越狱机 8.29.0 缓存确认的推广入口，结构未知时原样放行。 */
'use strict';
(function () {
  try {
    if (!$response || typeof $response.body !== 'string' || !$request || !$request.url) return $done({});
    var path = $request.url.split('?')[0];
    if (!/^https:\/\/api\.pinduoduo\.com\/(api\/alexa\/homepage\/hub|api\/philo\/personal\/hub)$/.test(path)) return $done({});
    var response = JSON.parse($response.body);
    if (!response || typeof response !== 'object' || Array.isArray(response)) return $done({});
    var root = response.result && typeof response.result === 'object' ? response.result : response;
    if (!root || typeof root !== 'object' || Array.isArray(root)) return $done({});
    var changed = false;
    function filter(key, check) {
      if (!Array.isArray(root[key])) return;
      var old = root[key].length;
      root[key] = root[key].filter(function (item) { return !check(item); });
      if (root[key].length !== old) changed = true;
    }
    if (path.endsWith('/api/alexa/homepage/hub')) {
      filter('icon_set', function (x) { return x && [256, 267].indexOf(x.id) >= 0 && ['9块9特卖', '省钱月卡'].indexOf(x.title) >= 0; });
      filter('all_top_opts', function (x) { return x && x.opt_name === '11.11大促'; });
      ['bottom_tabs', 'buffer_bottom_tabs'].forEach(function (key) {
        filter(key, function (x) {
          return x && ((x.id === 207 && x.title === '多多视频') || x.title === '点我领券');
        });
      });
    } else if (path.endsWith('/api/philo/personal/hub')) {
      if (Object.prototype.hasOwnProperty.call(root, 'monthly_card_entrance')) {
        delete root.monthly_card_entrance; changed = true;
      }
    }
    if (changed) {
      console.log('PDD_CLEAN_V3 path=' + path.split('/').slice(3).join('/') + ' changed=1');
      return $done({body: JSON.stringify(response)});
    }
    $done({});
  } catch (e) {
    console.log('PDD_CLEAN_V3 unchanged parse_error');
    $done({});
  }
})();
