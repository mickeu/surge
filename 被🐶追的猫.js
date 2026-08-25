(function() {
    let key = 'cat_panel_group';
    let saved = $persistentStore.read(key);
    let param = $script.param || 'AIGC';
    let targetGroup = saved || param;

    if ($script && $script.purpose === 'button') {
        let input = $ui.input('输入策略组名', '请输入要监控的策略组名称（或关键词）', targetGroup);
        if (input !== null && input.trim() !== '') {
            $persistentStore.write(input.trim(), key);
            targetGroup = input.trim();
        }
    }

    let groups = $surge.policyGroups();
    let target = groups.find(g => g.name.includes(targetGroup));
    if (!target) target = groups[0];

    let selected = target.selected || '无';
    let total = target.policies ? target.policies.length : 0;
    let content = `策略组: ${target.name}\n当前节点: ${selected}\n节点总数: ${total}`;
    return {
        title: '🐱 被🐶追的猫',
        content: content,
        style: 'info',
        icon: '🐱',
        'icon-color': 'orange'
    };
})();
