/*********************************
百度贴吧签到 - 面板版
点面板刷新即执行签到，结果直接显示在面板
基于 TieBa.js 完整签到逻辑
*********************************/

const ckKey = 'CookieTB';

// 读取 Cookie
var cookieVal = $persistentStore.read(ckKey);

function noDataDone(msg) {
  $done({ title: "🀄 贴吧签到", content: msg || "未获取到Cookie\n请打开贴吧App点\"我的\"抓取", icon: "tortoise", "icon-color": "#FF9500" });
}

if (!cookieVal) {
  console.log('❌ 未获取到cookie');
  noDataDone();
  setTimeout(function(){}, 100);
  return;
}

// 收集签到结果
var notifyMsgs = [];

function buildUA(baseUA, seed) {
  const IOS_VERSIONS = ['17.5.1','17.6.1','17.4.1','17.2.1','16.7.8','17.6','17.3.1','18.0.1','17.1.2','16.6.1'];
  const IOS_SCALES = ['2.00','3.00','3.00','2.00','3.00'];
  const IPHONE_MODELS = ['iPhone14,3','iPhone13,3','iPhone15,3','iPhone16,1','iPhone14,7','iPhone13,2','iPhone15,2','iPhone12,1'];
  const CFN_VERS = ['1410.0.3','1494.0.7','1568.100.1','1209.1','1474.0.4','1568.200.2'];
  const DARWIN_VERS = ['22.6.0','23.5.0','23.6.0','24.0.0','22.4.0'];
  const iosVer = IOS_VERSIONS[seed % IOS_VERSIONS.length];
  const scale = IOS_SCALES[(seed + 1) % IOS_SCALES.length];
  const model = IPHONE_MODELS[(seed + 2) % IPHONE_MODELS.length];
  const cfn = CFN_VERS[(seed + 3) % CFN_VERS.length];
  const darwin = DARWIN_VERS[(seed + 4) % DARWIN_VERS.length];
  if (baseUA && typeof baseUA === 'string') {
    let ua = baseUA; let changed = false;
    if (/iOS \d+(\.\d+){0,2}/.test(ua)) { ua = ua.replace(/iOS \d+(\.\d+){0,2}/, `iOS ${iosVer}`); changed = true; }
    if (/Scale\/\d+(\.\d+)?/.test(ua)) { ua = ua.replace(/Scale\/\d+(\.\d+)?/, `Scale/${scale}`); changed = true; }
    if (/iPhone\d+,\d+/.test(ua)) { ua = ua.replace(/iPhone\d+,\d+/, model); changed = true; }
    if (/CFNetwork\/[\d.]+/.test(ua)) { ua = ua.replace(/CFNetwork\/[\d.]+/, `CFNetwork/${cfn}`); changed = true; }
    if (/Darwin\/[\d.]+/.test(ua)) { ua = ua.replace(/Darwin\/[\d.]+/, `Darwin/${darwin}`); changed = true; }
    if (changed) return ua;
  }
  return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVer} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/16A366`;
}

function getUA() {
  return buildUA('', Math.floor(Math.random() * 10000));
}

function signBar(bar, tbs) {
  return new Promise(function(resolve) {
    if (bar.is_sign === 1) {
      resolve({ bar: bar.forum_name, level: bar.user_level, exp: bar.user_exp, errorCode: 9999, errorMsg: '已签到' });
      return;
    }
    $httpClient.post({
      url: 'https://tieba.baidu.com/sign/add',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieVal, 'User-Agent': getUA() },
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
        headers: { 'Content-Type': 'application/octet-stream', Referer: 'https://tieba.baidu.com/index/tbwise/forum', Cookie: cookieVal, 'User-Agent': getUA() }
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

    var successCount = 0, lines = [];
    for (var k = 0; k < results.length; k++) {
      var r = results[k];
      if (r.errorCode === 0 || r.errorCode === 9999) successCount++;
      if (r.errorCode === 9999) {
        lines.push('【' + r.bar + '】已签到·Lv' + r.level);
      } else if (r.errorCode === 0) {
        lines.push('【' + r.bar + '】签到成功，' + r.errorMsg);
      } else {
        lines.push('【' + r.bar + '】签到失败，原因：' + r.errorMsg);
      }
    }

    var content = "✅ 签到" + results.length + "个,成功" + successCount + "个\n" + lines.join("\n");
    console.log('📬 签到完成: ' + content);

    // 弹通知
    try { $notification.post('贴吧签到', '', content, { url: undefined }); } catch(e) {}
    // 面板显示
    $done({ title: "🀄 贴吧签到", content: content, icon: successCount > 0 ? "checkmark.circle" : "exclamationmark.triangle", "icon-color": successCount > 0 ? "#34C759" : "#FF3B30" });

  } catch (e) {
    console.log('❌ 签到异常: ' + e);
    noDataDone('签到异常: ' + e);
  }
}

run();