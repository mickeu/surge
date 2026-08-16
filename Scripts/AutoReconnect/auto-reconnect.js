// auto-reconnect.js
// 断线自动重连：network-changed 事件触发时，探测代理连通性
// 不通 → 刷新 DNS + 强制重连(kill 技巧) + 切换备用节点
// 借鉴 kill-active-requests 模块 (xream/scripts) 的 $httpAPI 机制
// 挂载: type=event,event-name=network-changed

// ===== 可配置参数 =====
var FALLBACK_POLICY = '🇸🇬新加坡';   // 主节点断线时切换到的备用节点
var GROUP_NAME = 'PROXY';              // 要操作的策略组
var PROBE_URL = 'http://connectivitycheck.gstatic.com/generate_204'; // 探测地址(走代理)
var PROBE_TIMEOUT = 5000;              // 探测超时 ms
var SETTLE_MS = 3000;                  // 网络稳定等待时间 ms

(function() {
  var log = function(msg) { console.log('[auto-reconnect] ' + msg); };
  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  function httpAPI(path, method, body) {
    return new Promise(function(resolve) {
      $httpAPI(method || 'POST', path, body || null, function(result) {
        resolve(result || {});
      });
    });
  }

  // 探测代理连通性：请求走规则(google 走 PROXY)，成功=代理通
  function probe() {
    return new Promise(function(resolve) {
      $httpClient.get({ url: PROBE_URL, timeout: PROBE_TIMEOUT / 1000 }, function(err, resp, data) {
        if (err) { log('探测失败: ' + err); resolve(false); return; }
        log('探测成功, status=' + resp.status);
        resolve(resp.status >= 200 && resp.status < 400);
      });
    });
  }

  // 借鉴 kill-active-requests: 切模式强制所有活跃连接断掉重走规则
  function forceReconnect() {
    return (async function() {
      await httpAPI('/v1/dns/flush', 'POST');
      var before = (await httpAPI('/v1/outbound', 'GET')).mode;
      log('当前模式: ' + before);
      var map = { direct: 'proxy', proxy: 'direct', rule: 'proxy' };
      var to = map[before] || 'rule';
      log('切换到: ' + to + ' (制造连接断开)');
      await httpAPI('/v1/outbound', 'POST', { mode: to });
      await httpAPI('/v1/outbound', 'POST', { mode: before }); // 切回
      log('切回: ' + before);
    })();
  }

  (async function() {
    // 网络刚变化，等网络稳定
    log('network-changed 事件触发, 等待 ' + SETTLE_MS + 'ms 网络稳定');
    await delay(SETTLE_MS);

    // 先探测一次
    var ok = await probe();
    if (ok) {
      log('代理正常, 无需处理');
      $done();
      return;
    }

    log('代理不通! 执行强制重连 + 切换备用节点');
    await forceReconnect();

    // 切换策略组到备用节点
    await httpAPI('/v1/policy_groups/select', 'POST', {
      group_name: GROUP_NAME,
      policy: FALLBACK_POLICY
    });
    log('已切换到备用节点: ' + FALLBACK_POLICY);

    // 等 3 秒再探测确认
    await delay(3000);
    var ok2 = await probe();
    if (ok2) {
      $notification.post('断线自动重连', '✅ 已恢复', '已切换到 ' + FALLBACK_POLICY);
      log('恢复成功: ' + FALLBACK_POLICY);
    } else {
      $notification.post('断线自动重连', '❌ 备用节点也不通', FALLBACK_POLICY);
      log('备用节点也不通');
    }
    $done();
  })().catch(function(e) {
    log('异常: ' + (e.message || e));
    $done();
  });
})();