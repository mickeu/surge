// Spotify OAuth 伪造脚本 - 调试版
var msg = "=== OAuth 拦截 ===\nURL: " + request.url;

if(request.url.includes('/authorize')){
    var m = request.url.match(/redirect_uri=([^&]+)/);
    var r = m ? decodeURIComponent(m[1]) : 'spotify-lyrics://spotify-login-callback';
    
    // 返回 200，body 包含重定向指令
    $done({
        status: 200,
        headers: {'Content-Type': 'text/html'},
        body: '<html><head><meta http-equiv="refresh" content="0;url='+r+'?code=fake_'+Date.now()+'"></head><body>MITM 成功!</body></html>'
    });
}else{
    $done({
        status: 200,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({access_token: 'fake_' + Date.now(), token_type: 'Bearer', expires_in: 3600})
    });
}
