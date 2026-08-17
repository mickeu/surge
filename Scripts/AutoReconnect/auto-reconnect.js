// auto-reconnect.js v8
// 断线自动重连 + 定时巡检（同一份脚本，双挂载点，完全自适应任意策略组配置）
//   断线重连 = type=event,event-name=network-changed,script-path=...
//   定时巡检 = type=cron,cronexp="0 */30 * * *",script-path=...
// 触发源区分：$event 必须先 typeof 防护再引用（cron 环境未声明会 ReferenceError 静默崩溃）
//
// 通用性设计（不写死任何组名/数量）：
//   1. 动态找出所有 select 组（GET /v1/policies/detail 判断类型），只看"叶子"组：
//      selected 是具体节点（非组、非 DIRECT/REJECT）；选中"组"的组自动跟随被引用组
//   2. 串行 POST /v1/policy_groups/test 测速（Surge 只支持单测速任务的并发限制）
//   3. 当前选中不在可用列表 → 切换：优先选测速确认可用的候选，其次组内顺序候选 + 通知
//   4. 测速无结果（超时/并发冲突）→ 跳过该组，绝不盲目切换
//   5. v6 约束自动判定：
//      - 读 [MTProto] 段：无该段或 ipv6 != true → V6_ONLY_GROUPS 自动失效（不锁 v6）
//      - 需锁 v6 且未显式指定 V6_NODES → 用 $httpClient 直连 IPv6 地址实测各候选节点，
//        自动识别支持 v6 出口的节点（探索目标 https://[2606:4700:4700::1111]/）
//   6. $argument 显式覆盖：V6_ONLY_GROUPS / V6_NODES（逗号分隔）传入后跳过自动逻辑
//      例: argument="V6_ONLY_GROUPS=Telegram&V6_NODES=🇯🇵日本,🇸🇬新加坡"
// 设计要点：
//   - 用 /v1/policy_groups/test 而不是 /v1/policies/test（后者对 Trojan/H2 返回空，不可靠）
//   - 组测速必须串行（Surge 并发限制，并行会导致部分组返回空）
//   - 只在"当前选中不可用"时才切，手动选择的节点不会被定时任务无故更改
//
// 配置示例：带账号密码的脚本挂载（以网上国网签到为例）
//   网上国网[定时] = type=cron,cronexp=0 9 * * *,wake-system=1,timeout=120,\
//     script-path=https://raw.githubusercontent.com/mickeu/surge/main/Scripts/95598/95598.js,\
//     argument=username=your_phone&password=your_password&debug=true&show_recent_usage=true&notify_all_accounts=true,script-update-interval=0
//   —— 参数中文说明（实际配置为完整一行）——
//     type=cron              定时触发类型
//     cronexp=0 9 * * *      执行时间：每天上午 9 点
//     wake-system=1          到点唤醒系统后台执行
//     timeout=120            脚本最长运行 120 秒
//     script-path=<URL>      脚本文件地址（须可公开访问，或本地文件）
//     argument=              传给脚本的参数，多个 key=value 用 & 连接：
//       username=<手机号>     网上国网 App 登录账号（必填）
//       password=<密码>       网上国网 App 登录密码（必填）
//       debug=<true/false>    是否输出调试日志（可选）
//       show_recent_usage=<true/false>  是否展示近期用电账单（可选）
//       notify_all_accounts=<true/false> 是否推送全部绑定户号（可选）
//     script-update-interval=0  远程脚本自动更新间隔秒数（0=不自动更新）

// ===== 可配置（$argument 可覆盖） =====
var SETTLE_MS = 3000;        // 断线模式：网络稳定等待（巡检模式自动置 0）
var DISMISS = 5;             // 通知自动消除秒数
var TEST_TIMEOUT = 20000;    // 单组测速超时 ms
// v6 约束（默认不限制任何组/节点；有需求的用户通过 $argument 传入）
var V6_NODES = [];           // 支持 IPv6 的节点名列表，如: ['🇯🇵日本','🇸🇬新加坡']
var V6_ONLY_GROUPS = [];     // 必须使用 v6 节点的组名列表，如: ['Telegram']

// ===== 触发源判定 =====
// 实测（2026-08-17，Surge 5.102.0 3819）：
//   - cron / script run 环境：直接引用 $event 会抛 ReferenceError（变量未声明）！
//     必须先用 typeof 防护，否则整个脚本静默崩溃、无任何输出
//   - CLI script run 手动触发特定环境可能注入 mock $event(name=network-changed)，此时误走 reconnect（调试观察用，无实际影响）
//   - 真实 network-changed event 触发：$event.name='network-changed' → 走 reconnect
var MODE = (typeof $event !== 'undefined' && $event && $event.name === 'network-changed') ? 'reconnect' : 'patrol';
if (MODE === 'patrol') SETTLE_MS = 0; // 巡检时网络早已稳定，无需等待

(function() {
  var ARG = {};
  if (typeof $argument != 'undefined' && $argument) {
    try { ARG = Object.fromEntries($argument.split('&').map(function(i) { var p = i.split('='); return [p[0], p[1]]; })); } catch (e) {}
  }
  if (ARG.SETTLE_MS && /^\d+$/.test(ARG.SETTLE_MS)) SETTLE_MS = parseInt(ARG.SETTLE_MS, 10);
  if (ARG.DISMISS && /^\d+$/.test(ARG.DISMISS)) DISMISS = parseInt(ARG.DISMISS, 10);
  if (ARG.TEST_TIMEOUT && /^\d+$/.test(ARG.TEST_TIMEOUT)) TEST_TIMEOUT = parseInt(ARG.TEST_TIMEOUT, 10);
  if (ARG.V6_NODES) V6_NODES = ARG.V6_NODES.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if (ARG.V6_ONLY_GROUPS) V6_ONLY_GROUPS = ARG.V6_ONLY_GROUPS.split(',').map(function(s){ return s.trim(); }).filter(Boolean);

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
    // 返回可用节点数组；测速无结果（超时/并发冲突导致 Surge 未返回 available 字段）→ 返回 null
    var r = await httpAPI('/v1/policy_groups/test', 'POST', { group_name: name }, TEST_TIMEOUT);
    return (r && Array.isArray(r.available)) ? r.available : null;
  }

  // v8: MTProto IPv6 自动判定 —— 没有 MTProto 模块或未开 ipv6，则不需要 v6 节点
  async function mtprotoIPv6Enabled() {
    var r = await httpAPI('/v1/profiles/current?sensitive=0', 'GET');
    var txt = r.profile || '';
    var m = txt.match(/\[MTProto\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (!m) return false;                         // 无 MTProto 模块
    return /^ipv6\s*=\s*true/m.test(m[1]);        // 开了 ipv6 才需要 v6 节点
  }

  // v8: 节点 v6 能力自动检测 —— 让节点直连 IPv6 地址(Cloudflare Anycast 443)，
  // 能握手=支持 v6 出口；失败/超时=不支持
  // 注意 $httpClient 签名: get(options对象含url/policy/timeout, callback)；timeout 单位秒
  function probeV6(name) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { if (!done) { done = true; resolve(false); } }, 7000);
      try {
        $httpClient.get({ url: 'https://[2606:4700:4700::1111]/', policy: name, timeout: 5 }, function(err, resp) {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve(!err && resp && resp.status && resp.status >= 200 && resp.status < 500);
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); resolve(false); }
      }
    });
  }

  async function detectV6Nodes(names) {
    var uniq = names.filter(function(v, i, a) { return a.indexOf(v) === i; });
    var results = await Promise.all(uniq.map(function(n) {
      return probeV6(n).then(function(ok) { return { name: n, ok: ok }; });
    }));
    return results.filter(function(x) { return x.ok; }).map(function(x) { return x.name; });
  }

  var v6Active = false; // v8: 运行时由 MTProto 判定赋值（pickCandidate 同步引用）

  function pickCandidate(options, available, t) {
    // 返回切换候选节点名；无候选返回 null
    // 优先用测速确认可用的（available），其次组内顺序（options）
    function ok(o) {
      if (!o.enabled || o.isGroup || o.name === t.selected) return false;
      if (o.name === 'DIRECT' || o.name === 'REJECT') return false;
      // v6 锁定仅在"MTProto ipv6 生效"时启用（v8 动态判定）
      if (v6Active && V6_ONLY_GROUPS.indexOf(t.name) >= 0 && V6_NODES.indexOf(o.name) < 0) return false;
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

    // v8: v6 约束自动判定
    //   1. 未配置 V6_ONLY_GROUPS 或 MTProto 未启用/未开 ipv6 → 不锁 v6（候选不过滤）
    //   2. 需要锁 v6 且未显式指定 V6_NODES → 自动实测各候选节点的 v6 能力
    v6Active = V6_ONLY_GROUPS.length > 0 && await mtprotoIPv6Enabled();
    log('v6 约束: ' + (v6Active ? '生效(' + V6_ONLY_GROUPS.join(',') + ' 锁定 v6 节点)' : '不生效(未配置锁定组或 MTProto 无 ipv6)'));
    if (v6Active && !ARG.V6_NODES && V6_NODES.length === 0) {
      var allCandidates = [];
      targets.forEach(function(t) {
        (groupsRes[t.name] || []).forEach(function(o) {
          if (!o.isGroup && o.name !== 'DIRECT' && o.name !== 'REJECT') allCandidates.push(o.name);
        });
      });
      V6_NODES = await detectV6Nodes(allCandidates);
      log('v6 节点自动检测: ' + (V6_NODES.length ? V6_NODES.join(', ') : '(候选均不支持 v6)'));
    }

    // 串行组测速 + 判断 + 切换
    var switched = [];
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      var available = await getAvailable(t.name);
      if (available === null) { log('  ' + t.name + ' ⚠️ 测速无结果(超时/冲突), 跳过不动'); continue; }
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