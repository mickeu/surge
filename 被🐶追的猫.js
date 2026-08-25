(function() {
    var group = $script.param || 'AIGC';
    var url = 'http://127.0.0.1:6171/v1/policy_groups/' + group;
    $httpClient.get({
        url: url,
        headers: {'X-Key': 'surgetest'},
        noProxy: true
    }, function(error, response, data) {
        if (error) {
            $done({
                title: '🐱被🐶追的猫',
                content: '请求失败: ' + error,
                style: 'info',
                icon: '🐱',
                'icon-color': 'red'
            });
            return;
        }
        if (response.status !== 200) {
            $done({
                title: '🐱被🐶追的猫',
                content: 'HTTP错误: ' + response.status,
                style: 'info',
                icon: '🐱',
                'icon-color': 'red'
            });
            return;
        }
        try {
            var json = JSON.parse(data);
            var info = json.group || json;
            var content = '策略组: ' + info.name +
                          '\n当前节点: ' + (info.selected || '无') +
                          '\n节点总数: ' + (info.options ? info.options.length : 0);
            $done({
                title: '🐱被🐶追的猫',
                content: content,
                style: 'info',
                icon: '🐱',
                'icon-color': 'orange'
            });
        } catch(e) {
            $done({
                title: '🐱被🐶追的猫',
                content: '解析错误: ' + e.message,
                style: 'info',
                icon: '🐱',
                'icon-color': 'red'
            });
        }
    });
})();