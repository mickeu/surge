console.log('[T1] async IIFE start');
(async function() {
  await new Promise(function(r) { setTimeout(r, 100); });
  console.log('[T1] async IIFE done');
  $done();
})();
