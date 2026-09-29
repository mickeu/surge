// spotify-fake.js
// 拦截 api.spotify.com/v1/me/player 的响应
// 403 时用 $persistentStore 缓存的曲目数据返回 200
// 触发: type=http-response, pattern=^https://api\.spotify\.com/v1/me/player

const status = $response.status;

if (status === 200) {
  // 正常响应，直接放行
  $done({});
} else {
  // 403 或其他错误，返回缓存的曲目数据
  const cached = $persistentStore.read("spotify_current_track");
  
  if (cached) {
    const track = JSON.parse(cached);
    const now = Date.now();
    // 估算当前进度（缓存时间到现在经过的秒数）
    const elapsed = track.is_playing ? Math.floor((now - track.timestamp) / 1000) * 1000 : 0;
    const progress = (track.progress_ms || 0) + elapsed;
    
    const fakeResponse = {
      "timestamp": now,
      "device": {
        "id": "proxy",
        "is_active": true,
        "is_private_session": false,
        "is_restricted": false,
        "name": "iPhone",
        "type": "Smartphone",
        "volume_percent": 100
      },
      "progress_ms": progress,
      "is_playing": track.is_playing,
      "item": {
        "album": {
          "album_type": "album",
          "artists": [{"id": "0", "name": track.artist, "type": "artist", "uri": "spotify:artist:0"}],
          "id": "0",
          "images": [],
          "name": "",
          "type": "album",
          "uri": "spotify:album:0"
        },
        "artists": [{"id": "0", "name": track.artist, "type": "artist", "uri": "spotify:artist:0"}],
        "duration_ms": track.duration_ms,
        "explicit": false,
        "id": "0",
        "is_local": false,
        "name": track.title,
        "popularity": 0,
        "track_number": 1,
        "type": "track",
        "uri": track.uri || "spotify:track:0"
      },
      "currently_playing_type": "track",
      "actions": {"disallows": {}}
    };
    
    $done({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(fakeResponse)
    });
  } else {
    // 没有缓存数据，返回 204（无播放）
    $done({ status: 204 });
  }
}
