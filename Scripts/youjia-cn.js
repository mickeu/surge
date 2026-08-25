// 实时油价 - 中文城市版
// 输入中文城市名（如"北京"、"深圳"、"长沙"）即可查询当地油价
// 自动将中文城市名映射到 qiyoujiage.com 拼音路径
// 由 mickeu 基于 youjia.js(@keywos) 改造

// ── 城市映射表（中文城市名 → qiyoujiage 路径）──
// 直辖市/单列市路径是直接的拼音；普通市需要 "省/市" 两级
const CITY_MAP = {
  // 直辖市
  "北京": "beijing", "上海": "shanghai", "天津": "tianjin", "重庆": "chongqing",
  // 河北
  "石家庄": "hebei/shijiazhuang", "唐山": "hebei/tangshan", "保定": "hebei/baoding",
  "邯郸": "hebei/handan", "张家口": "hebei/zhangjiakou", "秦皇岛": "hebei/qinhuangdao",
  "廊坊": "hebei/langfang", "沧州": "hebei/cangzhou", "邢台": "hebei/xingtai", "承德": "hebei/chengde", "衡水": "hebei/hengshui",
  // 山西
  "太原": "shanxi/taiyuan", "大同": "shanxi/datong", "运城": "shanxi/yuncheng",
  "临汾": "shanxi/linfen", "晋中": "shanxi/jinzhong", "长治": "shanxi/changzhi",
  "晋城": "shanxi/jincheng", "阳泉": "shanxi/yangquan", "朔州": "shanxi/shuozhou", "忻州": "shanxi/xinzhou", "吕梁": "shanxi/lvliang",
  // 内蒙古
  "呼和浩特": "neimenggu/huhehaote", "包头": "neimenggu/baotou", "鄂尔多斯": "neimenggu/eerduosi",
  "赤峰": "neimenggu/chifeng", "通辽": "neimenggu/tongliao", "呼伦贝尔": "neimenggu/hulunbeier",
  // 辽宁
  "沈阳": "liaoning/shenyang", "大连": "liaoning/dalian", "鞍山": "liaoning/anshan",
  "抚顺": "liaoning/fushun", "本溪": "liaoning/benxi", "丹东": "liaoning/dandong",
  "锦州": "liaoning/jinzhou", "营口": "liaoning/yingkou", "盘锦": "liaoning/panjin", "阜新": "liaoning/fuxin",
  "辽阳": "liaoning/liaoyang", "铁岭": "liaoning/tieling", "朝阳": "liaoning/chaoyang", "葫芦岛": "liaoning/huludao",
  // 吉林
  "长春": "jilin/changchun", "吉林": "jilin/jilin", "四平": "jilin/siping",
  "辽源": "jilin/liaoyuan", "通化": "jilin/tonghua", "白山": "jilin/baishan",
  "松原": "jilin/songyuan", "白城": "jilin/baicheng", "延边": "jilin/yanbian",
  // 黑龙江
  "哈尔滨": "heilongjiang/haerbin", "齐齐哈尔": "heilongjiang/qiqihaer", "大庆": "heilongjiang/daqing",
  "牡丹江": "heilongjiang/mudanjiang", "佳木斯": "heilongjiang/jiamusi", "绥化": "heilongjiang/suihua",
  // 江苏
  "南京": "jiangsu/nanjing", "苏州": "jiangsu/suzhou", "无锡": "jiangsu/wuxi",
  "常州": "jiangsu/changzhou", "南通": "jiangsu/nantong", "徐州": "jiangsu/xuzhou",
  "扬州": "jiangsu/yangzhou", "盐城": "jiangsu/yancheng", "泰州": "jiangsu/taizhou",
  "镇江": "jiangsu/zhenjiang", "淮安": "jiangsu/huaian", "连云港": "jiangsu/lianyungang", "宿迁": "jiangsu/suqian",
  // 浙江
  "杭州": "zhejiang/hangzhou", "宁波": "zhejiang/ningbo", "温州": "zhejiang/wenzhou",
  "嘉兴": "zhejiang/jiaxing", "湖州": "zhejiang/huzhou", "绍兴": "zhejiang/shaoxing",
  "金华": "zhejiang/jinhua", "衢州": "zhejiang/quzhou", "舟山": "zhejiang/zhoushan",
  "台州": "zhejiang/taizhou", "丽水": "zhejiang/lishui", "义乌": "zhejiang/yiwu",
  // 安徽
  "合肥": "anhui/hefei", "芜湖": "anhui/wuhu", "蚌埠": "anhui/bengbu",
  "淮南": "anhui/huainan", "马鞍山": "anhui/maanshan", "安庆": "anhui/anshan",
  "六安": "anhui/liuan", "阜阳": "anhui/fuyang", "滁州": "anhui/chuzhou", "铜陵": "anhui/tongling",
  // 福建
  "福州": "fujian/fuzhou", "厦门": "fujian/xiamen", "泉州": "fujian/quanzhou",
  "漳州": "fujian/zhangzhou", "莆田": "fujian/putian", "三明": "fujian/sanming",
  "龙岩": "fujian/longyan", "南平": "fujian/nanping", "宁德": "fujian/ningde",
  // 江西
  "南昌": "jiangxi/nanchang", "赣州": "jiangxi/ganzhou", "九江": "jiangxi/jiujiang",
  "上饶": "jiangxi/shangrao", "宜春": "jiangxi/yichun", "吉安": "jiangxi/jian",
  "萍乡": "jiangxi/pingxiang", "新余": "jiangxi/xinyu", "景德镇": "jiangxi/jingdezhen", "鹰潭": "jiangxi/yingtan",
  // 山东
  "济南": "shandong/jinan", "青岛": "shandong/qingdao", "烟台": "shandong/yantai",
  "潍坊": "shandong/weifang", "临沂": "shandong/linyi", "淄博": "shandong/zibo",
  "济宁": "shandong/jining", "泰安": "shandong/taian", "威海": "shandong/weihai",
  "日照": "shandong/rizhao", "菏泽": "shandong/heze", "聊城": "shandong/liaocheng", "德州": "shandong/dezhou",
  // 河南
  "郑州": "henan/zhengzhou", "洛阳": "henan/luoyang", "开封": "henan/kaifeng",
  "新乡": "henan/xinxiang", "安阳": "henan/anyang", "南阳": "henan/nanyang",
  "许昌": "henan/xuchang", "周口": "henan/zhoukou", "商丘": "henan/shangqiu", "平顶山": "henan/pingdingshan",
  // 湖北
  "武汉": "hubei/wuhan", "宜昌": "hubei/yichang", "襄阳": "hubei/xiangyang",
  "荆州": "hubei/jingzhou", "黄冈": "hubei/huanggang", "十堰": "hubei/shiyan",
  "孝感": "hubei/xiaogan", "荆门": "hubei/jingmen", "黄石": "hubei/huangshi", "咸宁": "hubei/xianning",
  // 湖南
  "长沙": "hunan/changsha", "株洲": "hunan/zhuzhou", "湘潭": "hunan/xiangtan",
  "衡阳": "hunan/hengyang", "岳阳": "hunan/yueyang", "常德": "hunan/changde",
  "邵阳": "hunan/shaoyang", "郴州": "hunan/chenzhou", "益阳": "hunan/yiyang", "娄底": "hunan/loudi",
  // 广东
  "广州": "guangdong/guangzhou", "深圳": "guangdong/shenzhen", "东莞": "guangdong/dongguan",
  "佛山": "guangdong/foshan", "珠海": "guangdong/zhuhai", "中山": "guangdong/zhongshan",
  "惠州": "guangdong/huizhou", "汕头": "guangdong/shantou", "江门": "guangdong/jiangmen",
  "湛江": "guangdong/zhanjiang", "肇庆": "guangdong/zhaoqing", "梅州": "guangdong/meizhou",
  "清远": "guangdong/qingyuan", "韶关": "guangdong/shaoguan", "阳江": "guangdong/yangjiang",
  // 广西
  "南宁": "guangxi/nanning", "柳州": "guangxi/liuzhou", "桂林": "guangxi/guilin",
  "梧州": "guangxi/wuzhou", "北海": "guangxi/beihai", "玉林": "guangxi/yulin",
  // 海南
  "海口": "hainan/haikou", "三亚": "hainan/sanya",
  // 四川
  "成都": "sichuan/chengdu", "绵阳": "sichuan/mianyang", "德阳": "sichuan/deyang",
  "宜宾": "sichuan/yibin", "南充": "sichuan/nanchong", "泸州": "sichuan/luzhou",
  "乐山": "sichuan/leshan", "攀枝花": "sichuan/panzhihua", "自贡": "sichuan/zigong", "遂宁": "sichuan/suining",
  // 贵州
  "贵阳": "guizhou/guiyang", "遵义": "guizhou/zunyi", "六盘水": "guizhou/liupanshui",
  "安顺": "guizhou/anshun", "毕节": "guizhou/bijie", "铜仁": "guizhou/tongren",
  // 云南
  "昆明": "yunnan/kunming", "曲靖": "yunnan/qujing", "玉溪": "yunnan/yuxi",
  "大理": "yunnan/dali", "丽江": "yunnan/lijiang", "保山": "yunnan/baoshan",
  // 西藏（省级有页面，城市级无独立页面，用省级）
  "拉萨": "xizang",
  // 陕西（qiyoujiage 用 shanxi-3 的特殊分支，区别于山西 shanxi）
  "西安": "shanxi-3/xian", "宝鸡": "shanxi-3/baoji", "咸阳": "shanxi-3/xianyang",
  "延安": "shanxi-3/yanan", "榆林": "shanxi-3/yulin", "渭南": "shanxi-3/weinan",
  // 甘肃
  "兰州": "gansu/lanzhou", "天水": "gansu/tianshui", "酒泉": "gansu/jiuquan",
  "张掖": "gansu/zhangye", "武威": "gansu/wuwei", "金昌": "gansu/jinchang",
  // 青海
  "西宁": "qinghai/xining", "海东": "qinghai/haidong",
  // 宁夏
  "银川": "ningxia/yinchuan", "石嘴山": "ningxia/shizuishan", "吴忠": "ningxia/wuzhong",
  // 新疆
  "乌鲁木齐": "xinjiang/wulumuqi", "克拉玛依": "xinjiang/kelamayi", "喀什": "xinjiang/kashi",
  "伊犁": "xinjiang/yili", "吐鲁番": "xinjiang/tulufan"
};

// ── 参数解析 ──
let cityName = "北京";
if (typeof $argument !== "undefined" && $argument) {
  cityName = String($argument).trim();
}

const REGION = CITY_MAP[cityName];

if (!REGION) {
  $done({
    title: "未找到城市",
    content: "未匹配到城市：「" + cityName + "」\n请检查是否输入了正确的城市名（如北京、深圳、长沙）\n\n支持城市：北京/上海/天津/重庆等直辖市，以及全国主要地级市",
    icon: "exclamationmark.triangle",
    "icon-color": "#FF9500"
  });
} else {
  const query_addr = `http://m.qiyoujiage.com/${REGION}.shtml`;
  $httpClient.get({
    url: query_addr,
    headers: {
      'referer': 'http://m.qiyoujiage.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
    }
  }, (error, response, data) => {
    if (error) {
      $done({ title: "查询失败", content: "获取 " + cityName + " 油价失败: " + (error || "网络错误"), icon: "exclamationmark.triangle", "icon-color": "#FF3B30" });
      return;
    }
    const reg_price = /<dl>[\s\S]+?<dt>(.*油)<\/dt>[\s\S]+?<dd>(.*)\(元\)<\/dd>/gm;
    var prices = [];
    var m = null;
    while ((m = reg_price.exec(data)) !== null) {
      if (m.index === reg_price.lastIndex) reg_price.lastIndex++;
      prices.push({ name: m[1], value: `${m[2]} 元/L` });
    }

    // 解析油价调整趋势
    var adjust_date = '';
    var adjust_trend = '';
    var adjust_value = '';
    const reg_adjust_tips = /<div class="tishi"> <span>(.*)<\/span><br\/>([\s\S]+?)<br\/>/;
    const adjust_tips_match = data.match(reg_adjust_tips);
    if (adjust_tips_match && adjust_tips_match.length === 3) {
      adjust_date = adjust_tips_match[1].split('价')[1].slice(0, -2);
      adjust_value = adjust_tips_match[2];
      adjust_trend = (adjust_value.indexOf('下调') > -1 || adjust_value.indexOf('下跌') > -1) ? '↓' : '↑';
      const adjust_value_re = /([\d\.]+)元\/升-([\d\.]+)元\/升/;
      const adjust_value_match = adjust_value.match(adjust_value_re);
      if (adjust_value_match && adjust_value_match.length === 3) {
        adjust_value = `${adjust_value_match[1]}-${adjust_value_match[2]}元/L`;
      }
    }

    if (!prices.length) {
      $done({ title: "获取失败", content: "未解析到 " + cityName + " 油价数据（页面结构可能已变）", icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
      return;
    }

    const lines = prices.map(p => `${p.name}  ${p.value}`);
    const friendly_tips = adjust_date ? `${adjust_date} ${adjust_trend} ${adjust_value}` : "";
    if (friendly_tips) lines.push(friendly_tips);

    $done({
      title: `${cityName} 实时油价`,
      content: lines.join("\n"),
      icon: "fuelpump.fill",
      "icon-color": "#FF9500"
    });
  });
}