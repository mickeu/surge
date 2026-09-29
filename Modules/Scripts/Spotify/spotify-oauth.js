// Spotify OAuth 伪造脚本 - 302重定向
if(request.url.includes('/authorize')){
    var m = request.url.match(/redirect_uri=([^&]+)/);
    var r = m ? decodeURIComponent(m[1]) : 'spotify-lyrics://spotify-login-callback';
    
    $done({
        status: 302,
        headers: {
            'Location': r + '?code=fake_' + Date.now()
        },
        body: ''
    });
}else{
    $done({
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            access_token: 'fake_' + Date.now(),
            refresh_token: 'fake_' + Date.now(),
            token_type: 'Bearer',
            expires_in: 3600
        })
    });
}
