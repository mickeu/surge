/*********************************
百度贴吧签到 - 面板版 v4
点面板刷新即执行签到，结果直接显示在面板
面板精简版（贴吧名+Lv等级），通知和日志完整版（含经验）
v4.1 (2026/10/01):
- 移除多余 setTimeout(100)
- 新增 120s 超时兜底 + safeClearTimeout 防护
- UA 每次运行只随机一次（同 Cookie 多 UA 易触发风控）
*********************************/

const ckKey = 'CookieTB';

var cookieVal = $persistentStore.read(ckKey);

// 超时兜底：网络请求挂起时强制结束面板，避免转圈到 timeout=600
var panelTimer = setTimeout(function() {
  console.log('⏰ 贴吧面板签到超时，强制结束');
  try { $notification.post('贴吧签到', '', '签到超时，请重试'); } catch(e) {}
  $done({ title: "百度贴吧签到", content: "签到超时", icon: "t.square.fill", "icon-color": "#FF3B30" });
}, 120000);

function safeClearTimeout(t) {
  if (typeof clearTimeout === 'function') clearTimeout(t);
}

function noDataDone(msg) {
  safeClearTimeout(panelTimer);
  $done({ title: "百度贴吧签到", content: msg || "点击签到", icon: "t.square.fill", "icon-color": "#34C759" });
}

if (!cookieVal) {
  console.log('❌ 未获取到cookie');
  noDataDone();
  return;
}

// 每次运行固定生成一个 UA，本次所有请求复用（同 Cookie 多 UA 易触发风控）
var UA = (function() {
  const IOS_VERSIONS = ['17.5.1','17.6.1','17.4.1','17.2.1','16.7.8','17.6','17.3.1','18.0.1','17.1.2','16.6.1'];
  const IOS_SCALES = ['2.00','3.00','3.00','2.00','3.00'];
  const IPHONE_MODELS = ['iPhone14,3','iPhone13,3','iPhone15,3','iPhone16,1','iPhone14,7','iPhone13,2','iPhone15,2','iPhone12,1'];
  const CFN_VERS = ['1410.0.3','1494.0.7','1568.100.1','1209.1','1474.0.4','1568.200.2'];
  const DARWIN_VERS = ['22.6.0','23.5.0','23.6.0','24.0.0','22.4.0'];
  var seed = Math.floor(Math.random() * 10000);
  return 'Mozilla/5.0 (iPhone; CPU iPhone OS ' + IOS_VERSIONS[seed % IOS_VERSIONS.length] + ' like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/16A366';
})();

function signBar(bar, tbs) {
  return new Promise(function(resolve) {
    if (bar.is_sign === 1) {
      resolve({ bar: bar.forum_name, level: bar.user_level, exp: bar.user_exp, errorCode: 9999, errorMsg: '已签到' });
      return;
    }
    $httpClient.post({
      url: 'https://tieba.baidu.com/sign/add',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieVal, 'User-Agent': UA },
      body: 'tbs=' + encodeURIComponent(tbs) + '&kw=' + encodeURIComponent(bar.forum_name) + '&ie=utf-8'
    }, function(err, resp, data) {
      if (err) resolve({ bar: bar.forum_name, errorCode: 999, errorMsg: '接口错误' });
      else {
        try {
          var addResult = JSON.parse(data);
          if (addResult.no === 0) resolve({ bar: bar.forum_name, errorCode: 0, errorMsg: '获得' + addResult.data.uinfo.cont_sign_num + '积分,第' + addResult.data.uinfo.user_sign_rank + '个签到' });
          else resolve({ bar: bar.forum_name, errorCode: addResult.no, errorMsg: addResult.error });
        } catch (e) { resolve({ bar: bar.forum_name, errorCode: 999, errorMsg: '解析错误' }); }
      }
    });
  });
}

async function run() {
  console.log('🔔 贴吧面板签到开始');
  try {
    var signResp = await new Promise(function(resolve, reject) {
      $httpClient.get({
        url: 'https://tieba.baidu.com/mo/q/newmoindex',
        headers: { 'Content-Type': 'application/octet-stream', Referer: 'https://tieba.baidu.com/index/tbwise/forum', Cookie: cookieVal, 'User-Agent': UA }
      }, function(err, resp, data) {
        if (err) reject(err); else resolve(JSON.parse(data));
      });
    });

    var isSuccess = signResp && signResp.no === 0 && signResp.error === 'success' && signResp.data && signResp.data.tbs;
    if (!isSuccess) {
      noDataDone('数据获取失败: ' + ((signResp && signResp.error) || '接口错误'));
      return;
    }

    var forums = signResp.data.like_forum;
    var tbs = signResp.data.tbs;
    if (!forums || forums.length === 0) { noDataDone('没有关注的贴吧'); return; }

    console.log('📋 共 ' + forums.length + ' 个贴吧');
    var results;
    if (forums.length < 30) {
      results = await Promise.all(forums.map(function(bar) { return signBar(bar, tbs); }));
    } else {
      results = [];
      for (var i = 0; i < forums.length; i++) { results.push(await signBar(forums[i], tbs)); }
    }

    var successCount = 0, lines = [], notifyLines = [], loginFailed = false;
    for (var k = 0; k < results.length; k++) {
      var r = results[k];
      if (r.errorCode === 0 || r.errorCode === 9999) successCount++;
      if (r.errorCode === 9999) {
        // 面板：省略"经验"，保留"已经签到，当前等级"
        lines.push('【' + r.bar + '】已经签到，当前等级' + r.level);
        notifyLines.push('【' + r.bar + '】已经签到，当前等级' + r.level + ',经验' + r.exp);
      } else if (r.errorCode === 0) {
        lines.push('【' + r.bar + '】签到成功，' + r.errorMsg);
        notifyLines.push('【' + r.bar + '】签到成功，' + r.errorMsg);
      } else {
        lines.push('【' + r.bar + '】签到失败，原因：' + r.errorMsg);
        notifyLines.push('【' + r.bar + '】签到失败，原因：' + r.errorMsg);
        if (/login|登录|未登录/i.test(r.errorMsg || '')) loginFailed = true;
      }
    }

    var notifyContent = "✅ 签到" + results.length + "个,成功" + successCount + "个\n" + notifyLines.join("\n");
    if (loginFailed) notifyContent += "⚠️ Cookie可能已失效，请重新抓取\n";
    console.log('📬 签到完成: ' + notifyContent);

    try { $notification.post('百度贴吧签到', '', notifyContent); } catch(e) {}
    // 面板固定显示（不显示签到详情，详情走通知）
    safeClearTimeout(panelTimer);
    $done({ title: "百度贴吧签到", content: "点击签到", icon: "t.square.fill", "icon-color": "#34C759" });

  } catch (e) {
    console.log('❌ 签到异常: ' + e);
    noDataDone('签到异常: ' + e);
  }
}

run();