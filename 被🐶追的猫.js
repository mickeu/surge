(function() {
    try {
        var groups = $surge.policyGroups();
        console.log('=== 被🐶追的猫 调试数据 ===');
        console.log(JSON.stringify(groups, null, 2));
        var preview = JSON.stringify(groups, null, 2);
        // 如果数据太长，截断
        if (preview.length > 500) {
            preview = preview.slice(0, 500) + '\n... (截断，完整数据请查看诊断日志)';
        }
        return {
            title: '🐱 被🐶追的猫 (调试)',
            content: '数据已输出到诊断日志\n请打开 诊断 → 日志\n搜索 "被🐶追的猫"\n\n预览:\n' + preview,
            style: 'info',
            icon: '🐱',
            'icon-color': 'orange'
        };
    } catch (e) {
        console.log('=== 被🐶追的猫 错误 ===');
        console.log(e.message);
        return {
            title: '🐱 被🐶追的猫 (错误)',
            content: '错误: ' + e.message + '\n详情请查看诊断日志',
            style: 'info',
            icon: '🐱',
            'icon-color': 'red'
        };
    }
})();
