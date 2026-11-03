/* 更新时间：2026.11.03 09:21。仅处理已知页面字段，异常原样返回。 */
'use strict';
(function () {
  try {
    if (!$response || typeof $response.body !== 'string') return $done({});
    var url = ($request && $request.url) || '';
    var data = JSON.parse($response.body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return $done({});
    var changed = false;
    function remove(obj, keys) {
      if (!obj || typeof obj !== 'object') return;
      keys.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          delete obj[key]; changed = true;
        }
      });
    }
    if (/\/api\/alexa\/homepage\/hub\?/.test(url)) {
      var root = data.result;
      if (root && typeof root === 'object') {
        remove(root, ['icon_set', 'search_bar_hot_query']);
        remove(root.dy_module, ['irregular_banner_dy']);
        ['bottom_tabs', 'buffer_bottom_tabs'].forEach(function (key) {
          if (!Array.isArray(root[key])) return;
          var before = root[key].length;
          root[key] = root[key].filter(function (tab) {
            return tab && ['index.html', 'chat_list.html', 'personal.html'].indexOf(tab.link) !== -1;
          });
          if (root[key].length !== before) changed = true;
        });
        if (Array.isArray(root.all_top_opts)) root.all_top_opts.forEach(function (item) {
          remove(item, ['selected_image', 'image', 'height', 'width']);
        });
      }
    } else if (/\/api\/philo\/personal\/hub\?/.test(url)) {
      remove(data, ['monthly_card_entrance', 'personal_center_style_v2_vo']);
      remove(data.icon_set, ['icons', 'top_personal_icons']);
    } else if (/\/api\/oak\/integration\/render\?/.test(url)) {
      remove(data, ['bottom_section_list']);
      remove(data.ui, ['bottom_section']);
      remove(data.ui && data.ui.live_section, ['float_info']);
    } else if (/\/search\?/.test(url)) {
      remove(data, ['expansion']);
    } else if (/\/api\/caterham\/v3\/query\/order_detail_group\?/.test(url)) {
      remove(data.data, ['goods_list']);
    } else if (/\/order\//.test(url)) {
      remove(data, ['marketing_banner_vo']);
      remove(data.shipping, ['banner_above_recommend']);
    } else if (/\/api\/aristotle\/order_list_v4\?/.test(url) && Array.isArray(data.orders)) {
      data.orders.forEach(function (order) {
        if (Array.isArray(order.order_buttons)) order.order_buttons.forEach(function (button) {
          remove(button, ['order_growth_tip']);
        });
      });
    }
    $done(changed ? {body: JSON.stringify(data)} : {});
  } catch (error) {
    $done({});
  }
})();
