// spotify-extract.js
// 从 Spotify App 的 Connect API 响应中提取曲目信息，存入 $persistentStore
// 触发: type=http-response, pattern=^https://[a-z0-9-]*spclient\.spotify\.com/.*/player

const body = $response.body;
try {
  const data = JSON.parse(body);
  
  // Connect API 响应格式可能包含 track 信息
  // 尝试多种可能的字段路径
  const track = data.track || data.item || data.player_state?.track || data;
  
  if (track) {
    const title = track.name || track.title || "";
    const artist = track.artists?.[0]?.name || track.artist || "";
    const duration_ms = track.duration_ms || track.duration || 0;
    const uri = track.uri || "";
    const progress_ms = data.progress_ms || data.position_ms || data.position || 0;
    const is_playing = data.is_playing !== undefined ? data.is_playing : 
                       (data.playback_state ? data.playback_state === "playing" : true);
    
    if (title) {
      const trackInfo = {
        title: title,
        artist: artist,
        duration_ms: duration_ms,
        progress_ms: progress_ms,
        is_playing: is_playing,
        uri: uri,
        timestamp: Date.now()
      };
      
      $persistentStore.write(JSON.stringify(trackInfo), "spotify_current_track");
      console.log(`[Spotify Bypass] 提取曲目: ${title} - ${artist}`);
    }
  }
} catch (e) {
  // 非 JSON 响应，忽略
}

$done({});
