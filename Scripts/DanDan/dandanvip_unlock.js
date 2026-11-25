/****************************** 
脚本功能：蛋蛋不语 - 解锁会员
Version  : v1.1.0
更新时间：2026-06-01
作者：Curtinp118
Platform : Quantumult X / Loon / Surge

使用说明：
添加到重写 解锁蛋蛋不语VIP会员功能。

[rewrite_local]
^http:\/\/38\.76\.202\.248:8000\/.*profiles.* url script-response-body https://raw.githubusercontent.com/curtinp118/Scripthub/main/scripts/dandanvip/dandanvip_unlock.js

[MITM]
hostname = 38.76.202.248
*******************************/

// ========== 三端适配层 ==========
var isQX = typeof $task !== "undefined";
var isLoon = typeof $loon !== "undefined";
var isSurge = typeof $httpClient !== "undefined" && !isLoon;

var $http = {
  fetch: function (opts) {
    if (isQX) return $task.fetch(opts);
    return new Promise(function (resolve, reject) {
      var method = (opts.method || "GET").toUpperCase();
      var handler = function (err, resp, data) {
        if (err) reject(err);
        else resolve({ statusCode: resp.statusCode, headers: resp.headers, body: data });
      };
      if (method === "POST") $httpClient.post(opts, handler);
      else $httpClient.get(opts, handler);
    });
  }
};

var $store = {
  read: function (key) { return isQX ? $prefs.valueForKey(key) : $persistentStore.read(key); },
  write: function (val, key) { return isQX ? $prefs.setValueForKey(val, key) : $persistentStore.write(val, key); }
};

var notifyFn = isQX
  ? function (t, s, b) { $notify(t, s, b); }
  : function (t, s, b) { $notification.post(t, s, b); };

// ========== Logger：每请求十几行 console.log 会把 Surge 日志簿撑爆，只留一行 ==========
var logOnce = function (msg) { console.log("[蛋蛋] " + msg); };

// 只解锁会员字段。原版这里还硬改 username 和 avatar_url 成作者的 TG 号与图床，
// 会员功能用不到，删掉以免动用户的昵称和头像
var VIP_PATCH = {
  vip_status: true,
  vip_level: 3,
  vip_expire_at: "2099-09-19T22:21:06.147807+00:00"
};

function patch(obj) {
  if (!obj || typeof obj !== "object") return obj;
  return Object.assign(obj, VIP_PATCH);
}

function done(body) {
  $done({ body: typeof body === "string" ? body : JSON.stringify(body) });
}

function run() {
  var raw = ($response && $response.body) ? $response.body : "";
  // 空 body 不能 done("")：那会把响应替换成空串。$done({}) 表示不修改响应
  if (!raw) return $done({});

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return done(raw);
  }

  data = Array.isArray(data) ? data.map(patch) : patch(data);
  logOnce("unlocked");
  done(data);
}

try {
  run();
} catch (e) {
  console.log("[蛋蛋] fatal: " + (e && e.message ? e.message : e));
  $done({});
}
