/*********************************
百度贴吧签到脚本 - Surge 专用版
原作者: @sazs34
修改: mickeu (适配 Surge API)
更新日期: 2026/07/30

获取Cookie说明：
打开百度贴吧App后，点击"我的"，即可自动获取Cookie（静默保存，不弹通知）。

签到说明：
定时自动签到，结果通过通知汇总。
*********************************/

const ckKey = 'CookieTB';

// 判断模式：http_request 还是 schedule
if (typeof $request !== 'undefined') {
  // —— Cookie 获取模式 ——
  // 检查开关
  var cookieEnabled = 'true';
  if ($argument) {
    var argStr = String($argument);
    if (argStr.includes('=')) {
      cookieEnabled = argStr.split('=')[1];
    } else {
      cookieEnabled = argStr;
    }
  }
  if (cookieEnabled === 'false') {
    console.log('⏸ 百度贴吧Cookie已关闭，跳过');
    $done();
  } else {
    mainCookie();
  }
} else {
  // —— 签到模式 ——
  mainSign().then(function() {
    $done();
  }).catch(function(err) {
    console.log('❌ 签到异常: ' + err);
    $notification.post('贴吧签到', '', '签到异常：' + err);
    $done();
  });
}

function mainCookie() {
  var headerCookie = $request.headers['Cookie'] || $request.headers['cookie'];
  if (headerCookie && headerCookie.includes('BDUSS=')) {
    $persistentStore.write(headerCookie, ckKey);
    console.log('✅ 百度贴吧Cookie保存成功');
    $notification.post('✅ 百度贴吧', '', 'Cookie获取成功', { url: undefined });
  } else {
    console.log('❌ 写入Cookie失败, BDUSS值缺失.');
  }
  $done();
}

async function mainSign() {
  console.log('🔔 百度贴吧签到开始');
  var cookieVal = $persistentStore.read(ckKey);
  var useParallel = parseInt($persistentStore.read('BDTB_DailyBonus_Mode') || '0', 10);
  var singleNotifyCount = parseInt($persistentStore.read('BDTB_DailyBonus_notify') || '20', 10);

  if (!cookieVal) {
    console.log('❌ 未获取到cookie');
    $notification.post('贴吧签到', '', '签到失败：未获取到cookie');
    return;
  }

  try {
    // 获取贴吧列表
    console.log('📋 获取贴吧列表...');
    var signResp = await new Promise(function(resolve, reject) {
      $httpClient.get({
        url: 'https://tieba.baidu.com/mo/q/newmoindex',
        headers: {
          'Content-Type': 'application/octet-stream',
          Referer: 'https://tieba.baidu.com/index/tbwise/forum',
          Cookie: cookieVal,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/16A366'
        }
      }, function(err, resp, data) {
        if (err) reject(err);
        else resolve(JSON.parse(data));
      });
    });

    var isSuccess = signResp && signResp.no === 0 && signResp.error === 'success' && signResp.data && signResp.data.tbs;

    if (!isSuccess) {
      console.log('❌ 签到失败: ' + ((signResp && signResp.error) ? signResp.error : '接口数据获取失败'));
      $notification.post('贴吧签到', '', '签到失败：' + ((signResp && signResp.error) ? signResp.error : '接口数据获取失败'));
      $done();
      return;
    }

    var forums = signResp.data.like_forum;
    var tbs = signResp.data.tbs;
    var total = forums.length;
    var results = [];

    console.log('📋 共 ' + total + ' 个贴吧');

    if (!forums || forums.length === 0) {
      console.log('❌ 没有关注的贴吧');
      $notification.post('贴吧签到', '', '签到失败：请确认您有关注的贴吧');
      $done();
      return;
    }

    // 决定并行还是串行
    var isParallel = useParallel === 2 || (useParallel === 0 && forums.length < 30);

    if (isParallel) {
      console.log('🔄 并行签到模式');
      var promises = forums.map(function(bar) {
        return signBar(bar, tbs, cookieVal);
      });
      results = await Promise.all(promises);
    } else {
      console.log('🔄 串行签到模式');
      for (var i = 0; i < forums.length; i++) {
        var bar = forums[i];
        console.log('  📝 签到: ' + bar.forum_name + ' (' + (i + 1) + '/' + total + ')');
        var result = await signBar(bar, tbs, cookieVal);
        results.push(result);
      }
    }

    console.log('✅ 签到完成，共 ' + total + ' 个贴吧');

    // 分批次发送通知
    for (var i = 0; i < Math.ceil(total / singleNotifyCount); i++) {
      var batch = results.splice(0, singleNotifyCount);
      var successCount = 0;
      var notifyText = '';

      for (var j = 0; j < batch.length; j++) {
        var res = batch[j];
        if (res.errorCode === 0 || res.errorCode === 9999) {
          successCount++;
        }
        if (res.errorCode === 9999) {
          notifyText += '【' + res.bar + '】已经签到，当前等级' + res.level + ',经验' + res.exp + '\n';
        } else {
          notifyText += '【' + res.bar + '】' + (res.errorCode === 0 ? '签到成功' : '签到失败') + '，' +
            (res.errorCode === 0 ? res.errorMsg : '原因：' + res.errorMsg) + '\n';
        }
      }

      var title = '贴吧签到';
      var body = '签到' + batch.length + '个,成功' + successCount + '个\n' + notifyText;
      console.log('📬 通知: ' + body);
      $notification.post(title, '', body);
    }

  } catch (e) {
    console.log('❌ 网络请求异常: ' + e);
    $notification.post('贴吧签到', '', '签到失败：网络请求异常');
  }

  $done();
}

function signBar(bar, tbs, cookieVal) {
  return new Promise(function(resolve) {
    if (bar.is_sign === 1) {
      resolve({
        bar: bar.forum_name,
        level: bar.user_level,
        exp: bar.user_exp,
        errorCode: 9999,
        errorMsg: '已签到'
      });
      return;
    }

    $httpClient.post({
      url: 'https://tieba.baidu.com/sign/add',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieVal,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_1_1 like Mac OS X; zh-CN) AppleWebKit/537.51.1 (KHTML, like Gecko) Mobile/14B100 UCBrowser/10.7.5.650 Mobile'
      },
      body: 'tbs=' + encodeURIComponent(tbs) + '&kw=' + encodeURIComponent(bar.forum_name) + '&ie=utf-8'
    }, function(err, resp, data) {
      if (err) {
        resolve({
          bar: bar.forum_name,
          errorCode: 999,
          errorMsg: '接口错误'
        });
      } else {
        try {
          var addResult = JSON.parse(data);
          if (addResult.no === 0) {
            resolve({
              bar: bar.forum_name,
              errorCode: 0,
              errorMsg: '获得' + addResult.data.uinfo.cont_sign_num + '积分,第' + addResult.data.uinfo.user_sign_rank + '个签到'
            });
          } else {
            resolve({
              bar: bar.forum_name,
              errorCode: addResult.no,
              errorMsg: addResult.error
            });
          }
        } catch (e) {
          resolve({
            bar: bar.forum_name,
            errorCode: 999,
            errorMsg: '解析错误'
          });
        }
      }
    });
  });
}