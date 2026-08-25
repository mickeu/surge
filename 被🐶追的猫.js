(function() {
    try {
        var groups = $surge.policyGroups();
        var content = JSON.stringify(groups, null, 2);
        return {
            title: '🐱 被🐶追的猫 (调试)',
            content: content,
            style: 'info',
            icon: '🐱',
            'icon-color': 'orange'
        };
    } catch (e) {
        return {
            title: '🐱 被🐶追的猫 (错误)',
            content: '错误: ' + e.message,
            style: 'info',
            icon: '🐱',
            'icon-color': 'red'
        };
    }
})();
