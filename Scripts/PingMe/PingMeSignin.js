/*
@Name: PingMe 自动化签到+视频奖励 (Surge专用版)
@Author: mickeu
@Date: 2026-07-30
@Fix: 每运行一次生成随机设备ID，整次运行所有视频用同一个设备ID
@Fix: 移除 duration 参数，解决通知不显示在通知中心的问题
*/

const ckKey = 'pingme_capture_v3';
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const MAX_VIDEO = 5;
const VIDEO_DELAY = 10000;

const NOTIFY_ICON = 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/apps/PingMe.png';

// 从模块参数读取策略设置和capture开关（cron脚本 $argument 正常有效）
const args = $argument || '';
let policy = 'DIRECT';
let captureValue = 'true';

// 解析 argument="policy=xxx&capture=yyy" 格式
if (typeof args === 'string') {
    args.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k === 'policy' && v) policy = v;
        if (k === 'capture' && v) captureValue = v;
    });
}

// 同步 capture 开关到 $persistentStore，供抓参脚本运行时读取
$persistentStore.write(captureValue, 'pingme_capture_switch');
console.log('📋 同步capture开关: ' + captureValue + ' | 策略: ' + policy);

// 每运行一次重新生成一个固定的伪造设备ID，整次运行所有视频都用同一个设备ID
const fakeDeviceId = genFakeDeviceId();

(async () => {
    const logs = [];
    const notify = (msg) => logs.push(msg);

    try {
        // 1. 读取存储的凭证
        const raw = $persistentStore.read(ckKey);
        if (!raw) {
            $notification.post('❌ PingMe签到', '', '请先获取PingMe签到参数，打开PingMe触发一次');
            $done();
            return;
        }

        let capture;
        try {
            capture = JSON.parse(raw);
        } catch (e) {
            $notification.post('❌ PingMe签到', '', '参数损坏，请重新打开PingMe抓参');
            $done();
            return;
        }

        console.log('PingMe签到, 开始!');
        console.log('PingMe 本次运行设备ID:' + fakeDeviceId);
        notify('开始运行签到');
        const headers = buildHeaders(capture);

        function fetchApi(path, useFakeId) {
            return new Promise((resolve, reject) => {
                const overrideId = useFakeId ? fakeDeviceId : null;
                const url = buildUrl(path, capture, overrideId);
                const options = { url: url, headers: headers, timeout: 15000 };
                if (policy) {
                    options.policy = policy;
                }
                $httpClient.get(options, (err, resp, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            });
        }

        // 2. 查询余额
        try {
            const d = await fetchApi('queryBalanceAndBonus');
            if (d.retcode === 0) {
                console.log('💰 运行前余额：' + d.result.balance + ' Coins');
                notify('💰 运行前余额：' + d.result.balance + ' Coins');
            } else {
                console.log('⚠️ 查询：' + d.retmsg);
                notify('⚠️ 查询：' + d.retmsg);
            }
        } catch (e) {
            notify('❌ 查询余额失败');
        }

        // 3. 签到
        try {
            const d = await fetchApi('checkIn');
            if (d.retcode === 0) {
                const hint = (d.result?.bonusHint || d.retmsg || '').replace(/\n/g, ' ');
                console.log('✅ 签到：' + hint);
                notify('✅ 签到：' + hint);
            } else {
                console.log('⚠️ 签到：' + d.retmsg);
                notify('⚠️ 签到：' + d.retmsg);
                if (d.retmsg && d.retmsg.includes('今天已经签过到')) {
                    notify('💡 提示：如果连续几天都显示"已签到"但余额没变，说明参数过期了');
                    notify('💡 请打开PingMe App重新触发抓参');
                }
            }
        } catch (e) {
            notify('❌ 签到失败');
        }

        // 4. 视频奖励循环
        for (let i = 1; i <= MAX_VIDEO; i++) {
            await sleep(i === 1 ? 3000 : VIDEO_DELAY);

            try {
                const d = await fetchApi('videoBonus', true);
                if (d.retcode === 0) {
                    notify('🎬 视频' + i + '：+' + (d.result?.bonus || '?') + ' Coins');
                } else {
                    notify('⏸ 视频' + i + '：' + d.retmsg + ' (code:' + d.retcode + ')');
                    if (i === 1) break;
                }
            } catch (e) {
                notify('❌ 视频' + i + '：请求失败');
                break;
            }
        }

        // 5. 查询最终余额
        try {
            const d = await fetchApi('queryBalanceAndBonus');
            if (d.retcode === 0) {
                logs.unshift('💰 最新余额：' + d.result.balance + ' Coins');
            }
        } catch (e) {
            // ignore
        }

        // 6. 发送通知（消息放body）
        $notification.post('🎉 PingMe签到完成', '', logs.join('\n'));

    } catch (err) {
        $notification.post('❌ PingMe签到失败', '', logs.join('\n') + '\n' + (err.message || String(err)));
    }

    $done();
})();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randHex(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.toUpperCase();
}

function genFakeDeviceId() {
    return randHex(8) + '-' + randHex(4) + '-' + randHex(4) + '-' + randHex(4) + '-' + randHex(12) + 'PingMeIOS';
}

function buildSignedParamsRaw(capture, overrideDeviceId) {
    const params = {};
    Object.keys(capture.paramsRaw || {}).forEach(k => {
        if (k !== 'sign' && k !== 'signDate') params[k] = capture.paramsRaw[k];
    });
    if (overrideDeviceId && params.uniquedeviceid) {
        params.uniquedeviceid = overrideDeviceId;
    }
    params.signDate = getUTCSignDate();
    const signBase = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
    params.sign = MD5(signBase + SECRET);
    return params;
}

function buildUrl(path, capture, overrideDeviceId) {
    const params = buildSignedParamsRaw(capture, overrideDeviceId);
    const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    return 'https://api.pingmeapp.net/app/' + path + '?' + qs;
}

function buildHeaders(capture) {
    const headers = {};
    Object.keys(capture.headers || {}).forEach(k => {
        if (!['content-length', 'Content-Length', ':authority', ':method', ':path', ':scheme'].includes(k)) {
            headers[k] = capture.headers[k];
        }
    });
    headers['Host'] = 'api.pingmeapp.net';
    headers['Accept'] = headers['Accept'] || 'application/json';
    return headers;
}

function getUTCSignDate() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate()) + ' ' + pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());
}

function MD5(string) {
    function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function AddUnsigned(lX, lY) {
        const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
        const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
        if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        return lResult ^ lX8 ^ lY8;
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return x ^ y ^ z; }
    function I(x, y, z) { return y ^ (x | (~z)); }
    function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function ConvertToWordArray(str) {
        const lMessageLength = str.length;
        const lNumberOfWords_temp1 = lMessageLength + 8;
        const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
        const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
        const lWordArray = Array(lNumberOfWords - 1).fill(0);
        let lBytePosition = 0, lByteCount = 0;
        while (lByteCount < lMessageLength) {
            const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
            lByteCount++;
        }
        const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] |= 0x80 << lBytePosition;
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    }
    function WordToHex(lValue) {
        let WordToHexValue = '', WordToHexValue_temp = '', lByte, lCount;
        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255;
            WordToHexValue_temp = '0' + lByte.toString(16);
            WordToHexValue += WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
        }
        return WordToHexValue;
    }
    let x = [];
    let k, AA, BB, CC, DD, a, b, c, d;
    const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    const S41 = 6, S42 = 10, S43 = 15, S44 = 21;
    x = ConvertToWordArray(string);
    a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
    for (k = 0; k < x.length; k += 16) {
        AA = a; BB = b; CC = c; DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD);
    }
    return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}