// observe-notifications.js
// 观察 Surge 发的所有通知内容，写入 Logbook，用于设计断线自动重连逻辑
// 挂载: type=event,event-name=notification
(function() {
  var data = $event.data || {};
  var title = data.title || '';
  var subtitle = data.subtitle || '';
  var body = data.body || '';
  var identifier = data.identifier || '';
  console.log('[OBSERVE] notification event -> ' + JSON.stringify({
    title: title,
    subtitle: subtitle,
    body: body,
    identifier: identifier
  }));
  $done();
})();