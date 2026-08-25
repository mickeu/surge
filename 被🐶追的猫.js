(function() {
    let param = $script.param || 'AIGC';
    let result = $exec('surge-cli --raw policy-group get ' + param);
    if (result.status !== 0) {
        return {
            title: '🐱 被🐶追的猫',
            content: '获取策略组失败: ' + (result.stderr || '未知错误'),
            style: 'info',
            icon: '🐱',
            'icon-color': 'red'
        };
    }
    let data = JSON.parse(result.stdout);
    let group = data.group;
    let selected = group.selected || '无';
    let total = group.options ? group.options.length : 0;
    let content = '策略组: ' + group.name + '\n当前节点: ' + selected + '\n节点总数: ' + total;
    return {
        title: '🐱 被🐶追的猫',
        content: content,
        style: 'info',
        icon: '🐱',
        'icon-color': 'orange'
    };
})();
