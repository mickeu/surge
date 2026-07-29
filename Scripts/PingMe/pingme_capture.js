/*
@Name: PingMe 获取签到参数 (Surge专用版)
@Description: 拦截PingMe余额查询请求，自动捕获所有请求头和参数
@Author: mickeu
@Date: 2026-07-30
*/

const ckKey = 'pingme_capture_v3';

// 检查模块开关（通过 #!arguments 传递）
const captureEnabled = $argument || 'true';
if (captureEnabled === 'false') {
    console.log('⏸ PingMe 已关闭，跳过抓参');
    $done();
    return;
}

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
    $notification.post('✅ PingMe 获取成功', '现在可以关闭抓参了', '');
    console.log('PingMe 获取到的内容为：' + url);
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