// Spotify OAuth 伪造脚本 - 最简版
$done({
    status: 200,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({access_token: 'fake_' + Date.now(), token_type: 'Bearer', expires_in: 3600})
});
