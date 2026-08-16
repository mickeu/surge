console.log('[T6] start');
$httpAPI('GET', '/v1/profiles/current?sensitive=0', null, function(r) {
  console.log('[T6] keys: ' + Object.keys(r).join(','));
  var p = (r && r.profile) || '';
  console.log('[T6] profile len: ' + p.length + ' head: ' + p.substring(0, 100).replace(/\n/g, '\\n'));
  var m = p.match(/\[MTProto\]([\s\S]*?)(?=\n\[|\s*$)/);
  console.log('[T6] MTProto: ' + (m ? 'FOUND, ipv6=true? ' + /^ipv6\s*=\s*true/m.test(m[1]) : 'NOT FOUND'));
  console.log('[T6] done');
  $done();
});
