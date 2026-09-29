// Spotify OAuth 伪造脚本 - 调试版
console.log('=== OAuth 拦截 ===');
console.log('URL:', request.url);

if(request.url.includes('/authorize')){
    console.log('=== Authorize 请求 ===');
    var m=request.url.match(/redirect_uri=([^&]+)/);
    var r=m?decodeURIComponent(m[1]):'spotify-lyrics://spotify-login-callback';
    console.log('Redirect URI:', r);
    
    var loc=r+'?code=fake_'+Date.now();
    console.log('Location:', loc);
    
    $done({
        status:302,
        headers:{'Location':loc},
        body:''
    });
}else if(request.url.includes('/token')){
    console.log('=== Token 请求 ===');
    $done({
        status:200,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({access_token:'fake_'+Date.now(),token_type:'Bearer',expires_in:3600})
    });
}else{
    console.log('=== 其他请求 ===');
    $done({status:200,body:'{"status":"ok"}'});
}
