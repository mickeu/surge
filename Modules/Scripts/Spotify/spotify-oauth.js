// Spotify OAuth 伪造脚本 - HTML响应
$done({
    status: 200,
    headers: {'Content-Type': 'text/html'},
    body: '<html><head><meta http-equiv="refresh" content="0;url=spotify-lyrics://spotify-login-callback?code=fake_'+Date.now()+'"></head><body><h1>MITM 成功!</h1></body></html>'
});
