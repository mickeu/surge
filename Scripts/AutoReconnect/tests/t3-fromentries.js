console.log('[T3] start');
var ARG = Object.fromEntries('a=1&b=2'.split('&').map(function(i) { var p = i.split('='); return [p[0], p[1]]; }));
console.log('[T3] fromEntries: ' + ARG.a + ',' + ARG.b);
$done();
