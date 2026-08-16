console.log('[T5] start');
var MODE = ($event && $event.name === 'network-changed') ? 'reconnect' : 'patrol';
console.log('[T5] MODE=' + MODE);
$done();
