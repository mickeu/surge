// PingMe 签到面板 v3
// 功能：点面板 = 触发 PingMe 签到（拉取 PingMeSignin.js 源码 → evaluate 执行），同时面板显示 P 图标
// 签到结果由 PingMeSignin.js 弹通知

// 立即返回 P 图标
$done({
  title: "🔄 PingMe 签到",
  content: "运行签到",
  icon: "p.circle",
  "icon-color": "#007AFF"
});

// 异步触发 PingMe 签到
setTimeout(function() {
  $httpClient.get("https://raw.githubusercontent.com/mickeu/surge/main/Scripts/PingMe/PingMeSignin.js", function(error, response, body) {
    if (error || !body) {
      console.log('PingMe 面板: 拉取签到脚本失败 ' + (error || ''));
      return;
    }
    try {
      var b64 = btoa(unescape(encodeURIComponent(body)));
      $httpAPI("POST", "/v1/scripting/evaluate", {
        script_text: b64,
        mock_type: "cron",
        timeout: 300
      }, function() {
        console.log('PingMe 面板: 已触发签到');
      });
    } catch(e) {
      console.log('PingMe 面板: 触发异常 ' + e);
    }
  });
}, 100);