console.log('[T2] start');
$httpAPI('GET', '/v1/policy_groups/select?group_name=Telegram', null, function(r) {
  console.log('[T2] httpAPI done: ' + JSON.stringify(r));
  $done();
});
