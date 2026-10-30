// 讯飞皮肤解锁：改写 resource/do 皮肤详情响应（gzip protobuf）
// 原理：等效于越狱 tweak 的 SkinInfo hook——把价格/IAP/付费状态字段改为免费，
//       让 App 认为皮肤已解锁，可自由下载使用
// 注意：当前为实验版，需实测确认字段有效性；field 88 为服务器签名（暂不改写）

// ---------- gzip stored 压缩（无压缩块，合法 gzip） ----------
var crcTable = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function gzipStored(plain) {
  var len = plain.length;
  var head = [0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x03];
  var block = [0x01, len & 0xff, (len >> 8) & 0xff, (~len) & 0xff, ((~len) >> 8) & 0xff];
  var crc = crc32(plain);
  var tail = [crc & 0xff, (crc >> 8) & 0xff, (crc >> 16) & 0xff, (crc >> 24) & 0xff,
              len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff];
  var total = head.length + block.length + len + tail.length;
  var out = new Uint8Array(total);
  var p = 0;
  for (var i = 0; i < head.length; i++) out[p++] = head[i];
  for (var i = 0; i < block.length; i++) out[p++] = block[i];
  for (var i = 0; i < len; i++) out[p++] = plain[i];
  for (var i = 0; i < tail.length; i++) out[p++] = tail[i];
  return out;
}

// ---------- protobuf 工具 ----------
function readVarint(bytes, i) {
  var r = 0, s = 0;
  while (true) {
    var b = bytes[i++];
    r |= (b & 0x7f) << s;
    if (!(b & 0x80)) break;
    s += 7;
  }
  return { value: r, next: i };
}

function encodeVarint(n) {
  var out = [];
  while (true) {
    var b = n & 0x7f;
    n >>>= 7;
    if (n) out.push(b | 0x80); else { out.push(b); break; }
  }
  return out;
}

function parseFields(bytes) {
  var fields = [];
  var i = 0;
  while (i < bytes.length) {
    var start = i;
    var tag = readVarint(bytes, i); i = tag.next;
    var fn = tag.value >>> 3;
    var wt = tag.value & 7;
    if (wt === 0) {
      var v = readVarint(bytes, i); i = v.next;
      fields.push({ fn: fn, wt: wt, val: v.value, start: start, end: i });
    } else if (wt === 2) {
      var ln = readVarint(bytes, i); i = ln.next;
      var val = bytes.slice(i, i + ln.value);
      i += ln.value;
      fields.push({ fn: fn, wt: wt, val: val, start: start, end: i });
    } else {
      break; // 不支持 wiretype，中断（保留原始后续）
    }
  }
  return fields;
}

function encodeField(fn, wt, val) {
  var out = encodeVarint((fn << 3) | wt);
  if (wt === 0) return new Uint8Array(out.concat([val]));
  var ln = encodeVarint(val.length);
  var bytes = new Uint8Array(out.length + ln.length + val.length);
  var p = 0;
  for (var i = 0; i < out.length; i++) bytes[p++] = out[i];
  for (var i = 0; i < ln.length; i++) bytes[p++] = ln[i];
  for (var i = 0; i < val.length; i++) bytes[p++] = val[i];
  return bytes;
}

function rewriteFields(bytes, fieldMap) {
  var fields = parseFields(bytes);
  var parts = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (fieldMap.hasOwnProperty(f.fn)) {
      var repl = fieldMap[f.fn];
      if (f.wt === 2) {
        var nv = repl(f.val);
        if (nv === null) continue;
        parts.push(encodeField(f.fn, 2, nv));
      } else if (f.wt === 0) {
        var nv2 = repl(f.val);
        if (nv2 === null) continue;
        parts.push(encodeField(f.fn, 0, nv2));
      } else {
        parts.push(bytes.slice(f.start, f.end));
      }
    } else {
      parts.push(bytes.slice(f.start, f.end));
    }
  }
  var total = 0;
  for (var i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total);
  var p = 0;
  for (var i = 0; i < parts.length; i++) {
    for (var j = 0; j < parts[i].length; j++) out[p++] = parts[i][j];
  }
  return out;
}

// ---------- 皮肤字段改写映射 ----------
// 把付费标记改为免费：价格清 0、IAP 产品 ID 清空、'1' 状态字段归 0、varint 1 归 0
function strBytes(s) {
  var u = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
var ZERO_STR = strBytes('0');
function freeSkin(val) {
  var toZero = function (v) { return ZERO_STR; };
  var toEmpty = function () { return null; }; // 删除字段
  var zeroVar = function () { return 0; };
  return rewriteFields(val, {
    24: toZero,   // 状态（已是 0，保险置 0）
    25: toZero,
    31: toZero,
    32: toZero,
    36: toZero,   // '1' -> '0'
    46: toZero,   // 原价 12.00 -> 0
    47: toZero,   // 现价 4.00 -> 0
    48: toZero,
    51: toZero,
    53: toZero,
    54: toZero,
    56: toZero,
    61: toEmpty,  // IAP 产品 ID 删除
    82: toZero,   // '1' -> '0'
    83: zeroVar,  // varint 1 -> 0
    84: zeroVar,
    85: zeroVar,
    87: zeroVar
  });
}

try {
  if ($response && $request) {
    var url = $request.url || '';
    if (/resource\/do\?/.test(url) && /c=100813/i.test(url) && $response.status == 200) {
      var raw = $response.body;
      if (raw && raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
        var plain = $utils.ungzip(raw);
        var top = parseFields(plain);
        var parts = [];
        var modified = false;
        for (var i = 0; i < top.length; i++) {
          var f = top[i];
          if (f.fn === 3 && f.wt === 2) {
            var newSkin = freeSkin(f.val);
            // 检查是否真的有改动（比对长度）
            if (newSkin.length !== f.val.length) modified = true;
            parts.push(encodeField(3, 2, newSkin));
          } else {
            parts.push(plain.slice(f.start, f.end));
          }
        }
        if (modified) {
          var total = 0;
          for (var i = 0; i < parts.length; i++) total += parts[i].length;
          var newPlain = new Uint8Array(total);
          var p = 0;
          for (var i = 0; i < parts.length; i++) {
            for (var j = 0; j < parts[i].length; j++) newPlain[p++] = parts[i][j];
          }
          var newBody = gzipStored(newPlain);
          console.log('[iflySkinUnlock] 已改写皮肤详情: ' + url);
          $done({ body: newBody });
        } else {
          console.log('[iflySkinUnlock] 无变化(可能已免费): ' + url);
          $done();
        }
      } else {
        $done();
      }
    } else {
      $done();
    }
  } else {
    $done();
  }
} catch (e) {
  console.log('[iflySkinUnlock] err: ' + e);
  $done();
}