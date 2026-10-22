// MiniWatts 真实电池面板 v2.0
// 通过 iSH 里的 CDTK 电池桥服务读取真实电芯电压/电池健康数据（WiFi 下可用）
// 自动获取本机 IP（$network.v4.primaryAddress），policy=DIRECT 强制直连，无需改规则
// 依赖: 本机 iSH 运行 battery_server.py（监听 0.0.0.0:8888）
// 作者: mickeu
const BRIDGE_PORT = 8888;

function fmtTime(ts) {
    if (!ts) return '未知';
    try {
        const d = new Date(ts * 1000);
        return d.toLocaleTimeString('zh-CN', { hour12: false });
    } catch (e) {
        return String(ts);
    }
}

function main() {
    const net = $network && $network.v4;
    const ip = net ? net.primaryAddress : '';
    if (!ip) {
        $done({
            title: '🔋 真实电池',
            content: '无法获取本机 IP\n（请连接 WiFi 后重试）'
        });
        return;
    }
    const url = 'http://' + ip + ':' + BRIDGE_PORT + '/battery';

    $httpClient.get({ url: url, timeout: 5 }, function (error, response, data) {
        if (error || !data) {
            $done({
                title: '🔋 真实电池',
                content: '无法连接电池桥\n请确认 Minis 已运行 battery_server.py\n' + (error ? String(error) : '')
            });
            return;
        }
        let obj;
        try {
            obj = JSON.parse(data);
        } catch (e) {
            $done({ title: '🔋 真实电池', content: '响应解析失败\n' + String(e) });
            return;
        }
        const d = obj.data;
        if (!obj.ok || !d || d.voltage_v === undefined) {
            $done({
                title: '🔋 真实电池',
                content: '电池桥暂无数据\n' + (obj.last_error || '等待首次读取…')
            });
            return;
        }
        const lines = [];
        lines.push('电芯电压: ' + d.voltage_v.toFixed(3) + ' V');
        if (d.percent !== undefined) lines.push('电量: ' + d.percent + '%');
        if (d.charge_status) lines.push('充电状态: ' + d.charge_status);
        if (d.cycles !== undefined) lines.push('充放循环: ' + d.cycles + ' 次');
        if (d.actual_capacity_mah !== undefined) lines.push('实际容量: ' + d.actual_capacity_mah + ' mAh');
        if (d.health_percent !== undefined) lines.push('健康度: ' + d.health_percent + '%');
        if (d.design_capacity_mah !== undefined) lines.push('设计容量: ' + d.design_capacity_mah + ' mAh');
        lines.push('读数时间: ' + fmtTime(obj.last_ok));

        let title = '🔋 ' + d.voltage_v.toFixed(3) + 'V ' + d.percent + '%';
        if (d.charge_status && d.charge_status.indexOf('充电') !== -1) {
            title = '⚡ ' + d.voltage_v.toFixed(3) + 'V ' + d.percent + '%';
        }
        $done({ title: title, content: lines.join('\n') });
    });
}

main();