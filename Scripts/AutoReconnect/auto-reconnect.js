// auto-reconnect.js v6
// 断线自动重连 + 定时巡检（同一份脚本，双挂载点）
//   断线重连 = type=event,event-name=network-changed,script-path=...
//   定时巡检 = type=cron,cronexp="0 */30 * * *",script-path=...
// 触发源区分：event 触发时 $event.name 存在；cron 触发时无 $event（实测 $cronexp 不注入）
//
// 逻辑（两种触发共用）：
//   1. 找出所有 select 组（GET /v1/policies/detail 判断类型）
//   2. 只处理"叶子" select 组：selected 是具体节点（非组、非 DIRECT/REJECT）
//      —— 选中"组"的组（如 Spotify→PROXY）自动跟随被引用组，不用管
//   3. 串行 POST /v1/policy_groups/test 测速（Surge 只支持单测速任务的并发限制）
//   4. 当前选中不在可用列表 → 切换：优先选测速确认可用的候选，其次组内顺序候选 + 通知
// 设计要点：
//   - 用 /v1/policy_groups/test 而不是 /v1/policies/test（后者对 Trojan/H2 返回空，不可靠）
//   - 组测速必须串行（Surge 并发限制，并行会导致部分组返回空）
//   - 只在"当前选中不可用"时才切，手动选择的节点不会被定时任务无故更改

// ===== 可配置（$argument 可覆盖） =====
var PROBE_URL = 'http://connectivitycheck.gstatic.com/generate_204';
var SETTLE_MS = 3000;        // 断线模式：网络稳定等待（巡检模式自动置 0）
var DISMISS = 5;             // 通知自动消除秒数
var TEST_TIMEOUT = 20000;    // 单组测速超时 ms
// v6 白名单：以下节点支持 IPv6，特定组(如 Telegram)切换时只允许用它们
var V6_NODES = ['🇯🇵日本', '🇸🇬新加坡'];
// 必须使用 v6 节点的组
var V6_ONLY_GROUPS = ['Telegram'];

// ===== 触发源判定 =====
// 实测：cron 触发环境下 $cronexp 并不注入（Surge 文档与实机行为不一致）
// 改用 $event：event 触发时必有 $event.name='network-changed'；cron/手动触发时无 $event
var MODE = ($event && $event.name === 'network-changed') ? 'reconnect' : 'patrol';
if (MODE === 'patrol') SETTLE_MS = 0; // 巡检时网络早已稳定，无需等待

(function() {
  var ARG = {};
  if (typeof $argument != 'undefined' && $argument) {
    try { ARG = Object.fromEntries($argument.split('&').map(function(i) { var p = i.split('='); return [p[0], p[1]]; })); } catch (e) {}
  }
  if (ARG.PROBE_URL) PROBE_URL = ARG.PROBE_URL;
  if (ARG.SETTLE_MS && /^\d+$/.test(ARG.SETTLE_MS)) SETTLE_MS = parseInt(ARG.SETTLE_MS, 10);

  var log = function(m) { console.log('[auto-reconnect/' + MODE + '] ' + m); };
  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  var enc = encodeURIComponent;

  function httpAPI(path, method, body, timeoutMs) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { if (!done) { done = true; resolve({}); } }, timeoutMs || 8000);
      $httpAPI(method || 'POST', path, body || null, function(r) {
        if (!done) { done = true; clearTimeout(timer); resolve(r || {}); }
      });
    });
  }

  async function getGroupType(name) {
    var r = await httpAPI('/v1/policies/detail?policy_name=' + enc(name), 'GET');
    var line = r[name] || '';
    var types = ['select', 'smart', 'url-test', 'fallback', 'load-balance'];
    for (var i = 0; i < types.length; i++) {
      if (line.indexOf('= ' + types[i]) >= 0) return types[i];
    }
    return 'unknown';
  }

  async function getSelected(name) {
    var r = await httpAPI('/v1/policy_groups/select?group_name=' + enc(name), 'GET');
    return r.policy || '';
  }

  async function getAvailable(name) {
    // POST /v1/policy_groups/test 触发整组测速
    var r = await httpAPI('/v1/policy_groups/test', 'POST', { group_name: name }, TEST_TIMEOUT);
    return r.available || [];
  }

  function pickCandidate(options, available, t) {
    // 返回切换候选节点名；无候选返回 null
    // 优先用测速确认可用的（available），其次组内顺序（options）
    var v6Only = V6_ONLY_GROUPS.indexOf(t.name) >= 0;
    function ok(o) {
      if (!o.enabled || o.isGroup || o.name === t.selected) return false;
      if (o.name === 'DIRECT' || o.name === 'REJECT') return false;
      if (v6Only && V6_NODES.indexOf(o.name) < 0) return false; // 该组只允许 v6 节点
      return true;
    }
    // pass 1: available（测速通过）优先
    for (var i = 0; i < available.length; i++) {
      var a = available[i];
      if (ok({ name: a, enabled: true, isGroup: false })) return a;
    }
    // pass 2: 组内顺序兜底
    for (var m = 0; m < options.length; m++) {
      if (ok(options[m])) return options[m].name;
    }
    return null;
  }

  (async function() {
    if (MODE === 'patrol') {
      log('定时巡检触发（cron）');
    } else {
      log('network-changed 触发, 等待 ' + SETTLE_MS + 'ms');
    }
    await delay(SETTLE_MS);

    var groupsRes = await httpAPI('/v1/policy_groups', 'GET');
    var groupNames = Object.keys(groupsRes);
    log('总组数: ' + groupNames.length);

    // 叶子 select 组：type=select && selected 是具体节点（groupsRes 里不存在=节点）
    var targets = [];
    for (var i = 0; i < groupNames.length; i++) {
      var n = groupNames[i];
      var type = await getGroupType(n);
      if (type !== 'select') continue;
      var sel = await getSelected(n);
      if (!sel || sel === 'DIRECT' || sel === 'REJECT') continue;
      var isGroupRef = !!groupsRes[sel]; // selected 是另一个组 → 跟随该组, 跳过
      if (isGroupRef) continue;
      targets.push({ name: n, selected: sel });
    }
    log('叶子 select 组: ' + targets.length + ' 个');
    targets.forEach(function(t) { log('  - ' + t.name + ' 选中: ' + t.selected); });
    if (!targets.length) { log('无需要处理的组'); $done(); return; }

    // 串行组测速 + 判断 + 切换
    var switched = [];
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      var available = await getAvailable(t.name);
      log('  ' + t.name + ' 可用: ' + (available.length ? available.join(', ') : '(无)'));
      if (available.indexOf(t.selected) >= 0) continue; // 当前选中可用，不动（保持手动选择）
      // 当前选中不可用 → 切换
      var options = groupsRes[t.name] || [];
      var candidate = pickCandidate(options, available, t);
      if (candidate) {
        await httpAPI('/v1/policy_groups/select', 'POST', { group_name: t.name, policy: candidate });
        log('✅ ' + t.name + ': ' + t.selected + ' → ' + candidate);
        switched.push(t.name + ': ' + t.selected + ' → ' + candidate);
      } else {
        log('❌ ' + t.name + ' 无候选节点, 保持现状');
        switched.push(t.name + ': 无可用候选');
      }
    }

    if (switched.length) {
      var title = (MODE === 'patrol') ? '节点定时巡检' : '断线自动重连';
      $notification.post(title, '已处理 ' + switched.length + ' 个策略组', switched.join('\n'), { 'auto-dismiss': DISMISS });
    }
    $done();
  })().catch(function(e) {
    log('异常: ' + (e.message || e));
    $done();
  });
})();