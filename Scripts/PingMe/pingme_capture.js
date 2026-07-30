/*
@Name: PingMe 获取签到参数 (Surge专用版)
@Description: 拦截PingMe余额查询请求，自动捕获所有请求头和参数
@Author: mickeu
@Date: 2026-07-30
@Fix: 通知消息放在 body 位置（非 subtitle），修复不弹通知的问题
@Fix: 每次抓参成功都会弹通知
*/

const ckKey = 'pingme_capture_v3';

console.log('🔔 PingMe 抓参脚本被触发');
console.log('URL: ' + $request.url);

const url = $request.url;
const headers = $request.headers;

if (url.includes('/app/queryBalanceAndBonus')) {
    console.log('PingMe 开始抓参: ' + url);
    const capture = {
        url: url,
        paramsRaw: parseRawQuery(url),
        headers: normalizeHeaderNameMap(headers)
    };
    $persistentStore.write(JSON.stringify(capture), ckKey);
    console.log('✅ PingMe 参数已保存');
    // 通知消息放在 body 位置（第三个参数），原版脚本格式如此
    $notification.post('✅ PingMe 获取成功', '', '现在可以关闭抓参了');
    console.log('PingMe 获取到的内容为：' + url);
} else {
    console.log('⚠️ URL 不匹配，跳过抓参');
}

$done();

function parseRawQuery(url) {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const qs = url.substring(idx + 1);
    const params = {};
    qs.split('&').forEach(pair => {
        const [k, v] = pair.split('=').map(s => decodeURIComponent(s || ''));
        if (k) params[k] = v;
    });
    return params;
}

function normalizeHeaderNameMap(headers) {
    const normalized = {};
    Object.keys(headers || {}).forEach(k => {
        normalized[k.toLowerCase()] = headers[k];
    });
    return normalized;
}