// 中国联通 抓参脚本（参照贴吧写法）
// 修改者：mickeu（2026-08-15）

const COOKIE_KEY = 'Unicom_Cookie';

// —— http-request 模式：抓 Cookie ——
if (typeof $request !== 'undefined') {
  var cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
  var auth = $request.headers['Authorization'] || $request.headers['authorization'] || '';
  var ua = $request.headers['User-Agent'] || $request.headers['user-agent'] || '';
  
  // 也尝试从响应拿 Set-Cookie
  var setCookie = '';
  if ($response) {
    setCookie = $response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '';
  }
  
  var saved = $persistentStore.read(COOKIE_KEY) || '';
  var newCookie = cookie || setCookie || '';
  
  if (newCookie) {
    // 合并 Cookie
    if (saved && cookie) {
      saved = saved + '; ' + cookie;
    } else if (newCookie) {
      saved = newCookie;
    }
    $persistentStore.write(saved, COOKIE_KEY);
    if (auth) {
      $persistentStore.write(auth, 'Unicom_Auth');
    }
    $notification.post('联通签到', 'Cookie 已捕获', '已保存到本地');
    console.log('联通 Cookie 保存成功');
  } else {
    $notification.post('联通签到', '请求已触发', '但未找到 Cookie');
    console.log('联通请求触发，无 Cookie');
  }
  $done({});
  return;
}

// —— cron 模式：签到（待完善） ——
$done({});