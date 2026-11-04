/**
 * 中国联通面板脚本（Surge 版）
 *
 * 用法：generic 脚本，被 Surge [Panel] 调用。
 *   参数（来自模块 #!arguments）：
 *     cookie_enabled       'true' / 'false'  是否启用自动抓取 Cookie（由 MITM 脚本写入）
 *     show_general_flow    'true' / 'false'  是否显示「已用通用流量」
 *
 * Cookie / 手机号由同模块的 MITM http-request 脚本写入 $persistentStore。
 *
 * 数据接口（与原 Egern 模块一致）：
 *   汇总（话费/语音/剩余通用流量）：
 *     GET https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven
 *   流量明细（通用/定向分项）：
 *     POST https://m.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune
 */

const API_HOST = 'm.client.10010.com';

const API_URL =
  'https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven';

const FLOW_DETAIL_URL =
  'https://m.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune';

const UA = 'ChinaUnicom.x CFNetwork iOS/16.3';

/* 流量明细里的资源类型（中文名） */
const FLOW_RESOURCE_NAMES = {
  resources: '套餐内流量&流量包',
  unshared: '套餐内流量&流量包(非共享)',
  rzbresources: '日租宝',
  mlresources: '免流流量',
  twresources: '套外流量',
};

function isDirectionalFlowItem(item, resourceName) {
  const addupItemCode = String(item.addupItemCode || '');
  const addUpItemName = String(item.addUpItemName || '');
  const feePolicyName = String(item.feePolicyName || '');
  return (
    addupItemCode === '40008' ||
    addUpItemName === '套餐内专享免费流量' ||
    resourceName === '免流流量' ||
    /（免流）|畅视/.test(feePolicyName)
  );
}

/* 流量数值自动换算单位：>= 1024 MB 时显示为 GB */
function formatFlowValue(value, unit) {
  const v = parseFloat(value) || 0;
  const u = String(unit || '').toUpperCase();
  if ((u === 'MB' || u === 'M') && v >= 1024) {
    return { value: Math.round((v / 1024) * 100) / 100, unit: 'GB' };
  }
  return { value: Math.round(v * 100) / 100, unit: String(unit || 'MB') };
}

/* 解析流量明细，按通用/定向汇总（单位：MB），返回 total / remain */
function parseFlowDetail(data) {
  let generalRemain = 0, directionalRemain = 0;
  let generalTotal = 0, directionalTotal = 0;

  for (const key of Object.keys(FLOW_RESOURCE_NAMES)) {
    const resourceName = FLOW_RESOURCE_NAMES[key];
    const list = data[key];
    if (!Array.isArray(list)) continue;

    for (const res of list) {
      const details = res.details;
      if (!Array.isArray(details)) continue;

      for (const item of details) {
        const directional = isDirectionalFlowItem(item, resourceName);
        const remain = Math.max(0, parseFloat(item.remain) || 0);
        const total = Math.max(0, parseFloat(item.total) || 0);

        if (directional) {
          directionalRemain += remain;
          directionalTotal += total;
        } else {
          generalRemain += remain;
          generalTotal += total;
        }
      }
    }
  }

  return {
    generalRemain, directionalRemain,
    generalTotal, directionalTotal,
  };
}

function parseUnicomData(res) {
  if (!res || res.code !== 'Y' || !res.feeResource || !res.voiceResource || !res.flowResource) {
    throw new Error('API 返回异常：' + (res && res.code ? res.code : 'unknown'));
  }

  const feeResource = res.feeResource;
  const voiceResource = res.voiceResource;
  const flowResource = res.flowResource;

  const fee = {
    title: feeResource.dynamicFeeTitle || '剩余话费',
    value: feeResource.feePersent != null ? feeResource.feePersent : 0,
    unit: feeResource.newUnit || '元',
  };

  const voice = {
    title: voiceResource.dynamicVoiceTitle || '剩余语音',
    value: voiceResource.voicePersent != null ? voiceResource.voicePersent : 0,
    unit: voiceResource.newUnit || '分钟',
  };

  const formatted = formatFlowValue(
    flowResource.flowPersent != null ? flowResource.flowPersent : 0,
    flowResource.newUnit || 'MB'
  );
  const flow = {
    title: flowResource.dynamicFlowTitle || '剩余流量',
    value: formatted.value,
    unit: formatted.unit,
  };

  return { fee, voice, flow };
}

/* 解析模块传入的 argument="K1=V1;K2=V2" 字符串 */
function parseArgs() {
  const out = {};
  const s = ($argument && typeof $argument === 'string') ? $argument : '';
  s.split(';').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return out;
}

function nowTime() {
  try {
    return new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
    });
  } catch (e) {
    const d = new Date();
    const hh = ('0' + d.getHours()).slice(-2);
    const mm = ('0' + d.getMinutes()).slice(-2);
    return hh + ':' + mm;
  }
}

/* 主流程 */
function main() {
  const args = parseArgs();
  const cookie = $persistentStore.read('unicom_cookie') || '';
  const phone = $persistentStore.read('unicom_phone') || '';
  const showGeneralFlow = args.show_general_flow !== 'false';

  if (!cookie || !phone) {
    $done({
      title: '中国联通',
      content: '尚未捕获登录信息\n打开联通 App 首页刷新一次',
      icon: 'antenna.radiowaves.left.and.right',
      'icon-color': '#E60012',
      style: 'alert',
    });
    return;
  }

  const headers = { Host: API_HOST, 'User-Agent': UA, Cookie: cookie };

  $httpClient.get(
    {
      url: API_URL + '?version=iphone_c@10.0100&desmobiel=' +
           encodeURIComponent(phone) + '&showType=0',
      headers: headers,
      timeout: 10000,
    },
    function (err, resp, body) {
      if (err) {
        doneError('网络错误：' + err);
        return;
      }
      if (resp.status === 401 || resp.status === 403) {
        $done({
          title: '中国联通',
          content: '登录已过期\n请重新打开联通 App 获取登录信息',
          icon: 'antenna.radiowaves.left.and.right',
          'icon-color': '#E60012',
          style: 'error',
        });
        return;
      }
      if (resp.status !== 200) {
        doneError('HTTP ' + resp.status);
        return;
      }

      let res;
      try { res = JSON.parse(body); } catch (e) { doneError('响应解析失败'); return; }

      let data;
      try { data = parseUnicomData(res); }
      catch (e) { doneError(e.message); return; }

      // 第二数据源：流量明细，用于推算「已用通用流量」
      $httpClient.post(
        { url: FLOW_DETAIL_URL, headers: headers, timeout: 10000 },
        function (err2, resp2, body2) {
          let usedGeneral = null;
          if (!err2 && resp2 && resp2.status === 200) {
            try {
              const d = JSON.parse(body2);
              if (d && String(d.code) === '0000') {
                const f = parseFlowDetail(d);
                if (showGeneralFlow) {
                  usedGeneral = f.generalTotal - f.generalRemain;
                  if (usedGeneral < 0) usedGeneral = 0;
                }
              }
            } catch (e) {}
          }

          // 组装面板内容
          const lines = [];
          lines.push('剩余话费  ' + data.fee.value + ' ' + data.fee.unit);
          lines.push('剩余语音  ' + data.voice.value + ' ' + data.voice.unit);

          if (showGeneralFlow && usedGeneral !== null) {
            const uf = formatFlowValue(usedGeneral, 'MB');
            lines.push('已用通用流量  ' + uf.value + ' ' + uf.unit);
          } else if (showGeneralFlow) {
            // 明细接口失败，降级显示汇总剩余流量
            lines.push('剩余流量  ' + data.flow.value + ' ' + data.flow.unit);
          }

          lines.push('更新 ' + nowTime());

          $done({
            title: '中国联通',
            content: lines.join('\n'),
            icon: 'antenna.radiowaves.left.and.right',
            'icon-color': '#E60012',
            style: 'good',
          });
        }
      );
    }
  );
}

function doneError(msg) {
  const cached = $persistentStore.read('unicom_panel_cache');
  let content = '获取失败：' + msg;
  if (cached) content += '\n（显示上次缓存）\n' + cached;
  $done({
    title: '中国联通',
    content: content,
    icon: 'antenna.radiowaves.left.and.right',
    'icon-color': '#E60012',
    style: 'error',
  });
}

main();
