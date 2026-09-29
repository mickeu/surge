// Spotify OAuth 伪造脚本
// 拦截 OAuth 请求，返回假授权

var redirectUri = 'spotify-lyrics://spotify-login-callback';

if (request.url.includes('/authorize')) {
    // 拦截 OAuth 授权请求
    var match = request.url.match(/redirect_uri=([^&]+)/);
    if (match) {
        redirectUri = decodeURIComponent(match[1]);
    }
    var fakeCode = 'fake_' + Date.now();
    $done({
        status: 302,
        headers: { 'Location': redirectUri + '?code=' + fakeCode },
        body: ''
    });
} else if (request.url.includes('/token')) {
    // 拦截 token 请求
    $done({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            access_token: 'fake_access_token_abc123',
            refresh_token: 'fake_refresh_token_xyz',
            token_type: 'Bearer',
            expires_in: 3600
        })
    });
} else {
    $done({ status: 200, body: '{"status":"ok"}' });
}
