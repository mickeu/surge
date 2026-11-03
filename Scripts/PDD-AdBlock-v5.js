/* 更新时间：2026.11.03 13:22。递归清理推广卡片，商品流和未知结构保持原样。 */
'use strict';
(function () {
  try {
    if (!$request || !$response || typeof $response.body !== 'string') return $done({});
    var host = String($request.url || '');
    if (!/^https:\/\/[^/]*pinduoduo\.com\//.test(host)) return $done({});
    var root = JSON.parse($response.body), changed = 0;
    var badText = /(答题活动|现金打款|现金大转盘|大促优惠|限时发放|立即领取|再送\d+元券|双11|11\.11|省钱月卡|9块9特卖|多多视频|点我领券)/i;
    var badKey = /^(ad|ads|advert|advertisement|banner|banners|carousel|activity|activities|marketing|promotion|promotions|coupon|coupons|monthly_?card|live_?section|short_?video)$/i;
    function textOf(x) {
      if (!x || typeof x !== 'object') return '';
      return ['title','name','text','desc','sub_title','subtitle','opt_name','content','link','link_url','url'].map(function (k) { return typeof x[k] === 'string' ? x[k] : ''; }).join(' ');
    }
    function drop(x, key) {
      if (!x || typeof x !== 'object') return false;
      if (badKey.test(String(key || ''))) return true;
      if (x.id === 256 || x.id === 267 || x.id === 207) return true;
      return badText.test(textOf(x));
    }
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 10) return node;
      if (Array.isArray(node)) {
        var out = [];
        node.forEach(function (v) { if (drop(v, '')) { changed++; } else out.push(walk(v, depth + 1)); });
        return out;
      }
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (drop(v, k)) { delete node[k]; changed++; return; }
        if (Array.isArray(v)) {
          var out = [];
          v.forEach(function (item) { if (drop(item, k)) { changed++; } else out.push(walk(item, depth + 1)); });
          node[k] = out;
        } else if (v && typeof v === 'object') node[k] = walk(v, depth + 1);
      });
      return node;
    }
    walk(root, 0);
    if (!changed) return $done({});
    console.log('PDD_ADBLOCK_V5 removed=' + changed);
    $done({ body: JSON.stringify(root) });
  } catch (e) { console.log('PDD_ADBLOCK_V5 parse_error'); $done({}); }
})();
