// spotify-me.js
// 拦截 api.spotify.com/v1/me 响应，把 product 改成 premium
// 触发: type=http-response, pattern=^https://api\.spotify\.com/v1/me$

const body = $response.body;

if ($response.status === 200 && body) {
  try {
    const data = JSON.parse(body);
    data.product = "premium";
    
    $done({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(data)
    });
  } catch (e) {
    $done({});
  }
} else if ($response.status === 403) {
  // 403 时返回假用户数据
  const fakeUser = {
    "display_name": "User",
    "email": "",
    "external_urls": {"spotify": "https://open.spotify.com/user/0"},
    "href": "https://api.spotify.com/v1/users/0",
    "id": "0",
    "product": "premium",
    "type": "user",
    "uri": "spotify:user:0"
  };
  
  $done({
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(fakeUser)
  });
} else {
  $done({});
}
