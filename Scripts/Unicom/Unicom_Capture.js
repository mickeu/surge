/**
 * 中国联通 Cookie / 手机号 自动抓取（Surge MITM http-request 脚本）
 *
 * 由模块 [Script] 的 http-request 段挂载，匹配 m.client.10010.com。
 * 仅在模块参数 cookie_enabled='true' 时写入，关闭后不再更新持久化登录信息。
 *
 * 注意：本脚本只负责「捕获并写入 $persistentStore」，必须放行请求（$done({})），
 * 面板刷新与数据查询由 unicom_panel.js 完成。
 */

const API_HOST = 'm.client.10010.com';

function getHeader(headers, name) {
  if (!headers) return '';
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === String(name).toLowerCase()) {
      return headers[k] || '';
    }
  }
  return '';
}

function extractPhone(url) {
  if (!url) return '';
  const m = String(url).match(/[?&]desmobiel=([^&]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return '';
}

function main() {
  // 解析 argument="K=V;..." 字符串
  const args = {};
  const s = ($argument && typeof $argument === 'string') ? $argument : '';
  s.split(';').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) args[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });

  // 关闭抓取开关则不处理
  if (args.cookie_enabled !== 'true') {
    $done({});
    return;
  }

  const req = ($request && ($request.url || $request.path)) ? $request : null;
  if (!req) { $done({}); return; }

  const url = String(req.url || '');
  if (url && url.indexOf(API_HOST) === -1) {
    // 没有 url 字段时（Surge 部分触发）退而检查 headers Host
    const host = getHeader(req.headers, 'host');
    if (host.indexOf(API_HOST) === -1) { $done({}); return; }
  }

  const cookie = getHeader(req.headers, 'cookie').trim();
  const phone = extractPhone(url);

  let changed = false;
  if (cookie) {
    const old = $persistentStore.read('unicom_cookie') || '';
    if (cookie !== old) { $persistentStore.write(cookie, 'unicom_cookie'); changed = true; }
  }
  if (phone) {
    const old = $persistentStore.read('unicom_phone') || '';
    if (phone !== old) { $persistentStore.write(phone, 'unicom_phone'); changed = true; }
  }

  if (changed && cookie && phone) {
    $notification.post('中国联通', '', '已自动获取登录信息，面板将自动更新');
  }

  $done({});
}

main();
