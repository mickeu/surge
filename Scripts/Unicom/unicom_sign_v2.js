/*
 * 中国联通 App 每日签到脚本 - Surge
 * 使用方式：
 *   1. 在 Surge 中配置 MITM，域名 *.10010.com
 *   2. 添加脚本类型为 http-request，匹配 URL 为包含 10010.com 的请求
 *   3. 添加脚本类型为 cron，定时触发签到（例如每天 8:00）
 *   4. 首次运行 http-request 模式，从请求中提取 Cookie 和认证信息
 *   5. 后续 cron 模式自动签到
 */

// 签到接口 URL（根据常见模式推断，若不正确请修改）
const SIGN_URL = 'https://act.10010.com/SigninApp/requestSignStatusListInfo';

// 判断模式：http-request 或 cron
if (typeof $request !== 'undefined') {
    // ========== http-request 模式：提取认证信息 ==========
    let cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
    let authorization = $request.headers['Authorization'] || $request.headers['authorization'] || '';
    
    // 从 URL 中提取必要参数
    let url = $request.url || '';
    let params = {};
    try {
        let query = url.split('?')[1] || '';
        query.split('&').forEach(pair => {
            let [k, v] = pair.split('=');
            if (k && v) {
                params[k] = decodeURIComponent(v);
            }
        });
    } catch (e) {
        // 解析失败不影响
    }

    let mobile = params['mobile'] || '';
    let unikey = params['unikey'] || '';
    let deviceId = params['deviceId'] || '';
    let appId = params['appId'] || '';
    let version = params['version'] || '';

    // 存储到持久化存储
    if (cookie) $persistentStore.write(cookie, 'unicom_cookie');
    if (authorization) $persistentStore.write(authorization, 'unicom_auth');
    if (mobile) $persistentStore.write(mobile, 'unicom_mobile');
    if (unikey) $persistentStore.write(unikey, 'unicom_unikey');
    if (deviceId) $persistentStore.write(deviceId, 'unicom_deviceId');
    if (appId) $persistentStore.write(appId, 'unicom_appId');
    if (version) $persistentStore.write(version, 'unicom_version');

    // 弹窗通知
    $notification.post('中国联通签到', '已获取认证信息', 'Cookie 和参数已保存');
    $done();
} else {
    // ========== cron 模式：执行签到 ==========
    mainSign();
}

async function mainSign() {
    // 读取存储的认证信息
    let cookie = $persistentStore.read('unicom_cookie') || '';
    let authorization = $persistentStore.read('unicom_auth') || '';
    let mobile = $persistentStore.read('unicom_mobile') || '';
    let unikey = $persistentStore.read('unicom_unikey') || '';
    let deviceId = $persistentStore.read('unicom_deviceId') || '';
    let appId = $persistentStore.read('unicom_appId') || '';
    let version = $persistentStore.read('unicom_version') || '';

    // 检查必要参数是否存在
    if (!cookie) {
        $notification.post('中国联通签到', '缺少认证信息', '请先运行 http-request 模式抓取');
        $done();
        return;
    }

    // 构造签到请求
    let url = SIGN_URL + '?mobile=' + encodeURIComponent(mobile) + '&unikey=' + encodeURIComponent(unikey) + '&deviceId=' + encodeURIComponent(deviceId) + '&appId=' + encodeURIComponent(appId) + '&version=' + encodeURIComponent(version);

    let headers = {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    };
    if (authorization) {
        headers['Authorization'] = authorization;
    }

    $httpClient.get(url, { headers: headers }, function(error, response, data) {
        if (error) {
            $notification.post('中国联通签到', '签到失败', '网络错误: ' + error);
            $done();
            return;
        }
        let result = null;
        try {
            result = JSON.parse(data);
        } catch (e) {
            $notification.post('中国联通签到', '签到接口待确认', '响应格式异常，请检查接口');
            $done();
            return;
        }
        if (result && (result.code === '0' || result.code === 0 || result.msg === 'success')) {
            $notification.post('中国联通签到', '签到成功', result.msg || 'success');
        } else {
            let failMsg = result ? (result.msg || result.message || '未知错误') : '响应为空';
            $notification.post('中国联通签到', '签到失败', failMsg);
        }
        $done();
    });
}