/*
@Name: PingMe 同步参数 (每5分钟)
@Description: 将模块参数同步到 $persistentStore，供抓参脚本读取
@Author: mickeu
*/

// 从模块参数解析 capture 值
const args = $argument || '';
let captureValue = 'true';

if (typeof args === 'string') {
    args.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k === 'capture' && v) captureValue = v;
    });
}

$persistentStore.write(captureValue, 'pingme_capture_switch');
console.log('📋 同步capture开关: ' + captureValue);
$done();