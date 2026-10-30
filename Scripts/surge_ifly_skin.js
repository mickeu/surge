// 讯飞皮肤免费化（实验性）：改写 getres 皮肤详情接口响应
// 把 vipType/unlockType/价格字段改为免费，让 App 认为皮肤可免费下载
if ($response.status == 200) {
  let body = $response.body;
  try {
    let obj = JSON.parse(body);
    let res = obj && obj.biz ? obj.biz.res : null;
    if (Array.isArray(res)) {
      for (let item of res) {
        if (item && typeof item === 'object') {
          item.vipType = 0;
          item.unlockType = '0';
          item.presentPrice = '';
          item.originalPrice = '';
          item.iosStorePriceId = '';
        }
      }
      body = JSON.stringify(obj);
      console.log('iflySkinFree: 已改写 ' + res.length + ' 个皮肤');
    }
  } catch (e) {
    console.log('iflySkinFree error: ' + e);
  }
  $done({ body: body });
} else {
  $done();
}