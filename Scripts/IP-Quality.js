/**
 * IP 纯净度检测 v2 — 多源并发架构
 *
 * 设计：
 *  - 多源并发请求，最快成功者胜出（容错 + 低延迟）
 *  - 主源 ip-api.com 提供 proxy/hosting/mobile 风险信号（免费唯一可用结构化数据）
 *  - 备源 ipinfo.io / ipwho.is 交叉验证 IP 与归属，主源失败时降级
 *  - 纯 IP 源（ip.sb/ifconfig.me）兜底取出口 IP
 *  - 面板精简显示，通知/日志完整版
 *  - 规则法：不指定 policy，靠模块 [Rule] 段 RULE-SET 让检测域名走 {{{GROUP}}}
 */

const META = "IP 纯净度 v2";

// ---------- 参数解析 ----------
let groupName = "PROXY";
if (typeof $argument !== "undefined" && $argument) {
  for (const p of String($argument).split("&")) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === "group") groupName = p.slice(i + 1).trim();
  }
}

// ---------- 单次完成守卫 ----------
let settled = false;
function done(obj) {
  if (settled) return;
  settled = true;
  try { $done(obj); } catch (e) {}
}

// ---------- 超时兜底 ----------
setTimeout(() => done({
  title: META + " · 超时",
  content: "策略组: " + groupName + "\n所有源均超时，检查节点或规则集是否生效",
  icon: "exclamationmark.triangle", "icon-color": "#FF9500"
}), 13000);

// ---------- 国旗 ----------
const FLAG = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷",ES:"🇪🇸",IT:"🇮🇹",SE:"🇸🇪",CH:"🇨🇭",UA:"🇺🇦",PL:"🇵🇱",MX:"🇲🇽",CL:"🇨🇱" };
const flag = c => (c && c.length === 2) ? (FLAG[c.toUpperCase()] || "🌐") : "🌐";

// ---------- 风险判定（基于 ip-api 布尔信号）----------
function riskLevel(d) {
  const hosting = !!d.hosting, proxy = !!d.proxy, mobile = !!d.mobile;
  let type, risk, score = 100;
  if (hosting && proxy) { type = "🏢🔀 机房+代理"; risk = "🔴 高风险"; score = 25; }
  else if (hosting)     { type = "🏢 数据中心";   risk = "🟡 中风险"; score = 60; }
  else if (proxy)       { type = "🔀 代理/VPN";    risk = "🟡 中风险"; score = 55; }
  else if (mobile)     { type = "📱 移动网络";    risk = "🟢 低风险"; score = 90; }
  else                  { type = "🏠 住宅 IP";     risk = "🟢 低风险"; score = 95; }
  return { type, risk, score };
}

// ---------- 请求封装（Promise 化 $httpClient）----------
function fetch(url) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 8000);
    $httpClient.get(url, (err, resp, data) => {
      clearTimeout(t);
      if (err || !data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
    });
  });
}

// 纯 IP 文本源（返回字符串）
function fetchIP(url) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 6000);
    $httpClient.get(url, (err, resp, data) => {
      clearTimeout(t);
      resolve(err || !data ? null : String(data).trim());
    });
  });
}

// ---------- 源定义 ----------
const SOURCES = {
  // 主源：唯一免费提供 proxy/hosting/mobile 信号
  ipapi:  "http://ip-api.com/json?fields=status,query,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile",
  // 备源1：归属/ISP 交叉验证
  ipinfo: "https://ipinfo.io/json",
  // 备源2：归属/ISP 交叉验证
  ipwho:  "https://ipwho.is/",
  // 纯 IP 兜底
  ipsb:   "https://api.ip.sb/ip",
  ipcfg:  "https://ifconfig.me/ip"
};

// 归一化各源到统一结构
function normIpapi(d) {
  if (!d || d.status === "fail") return null;
  return {
    ip: d.query, country: d.country, code: d.countryCode,
    region: d.regionName, city: d.city, isp: d.isp, org: d.org, as: d.as,
    proxy: d.proxy, hosting: d.hosting, mobile: d.mobile, src: "ip-api"
  };
}
function normIpinfo(d) {
  if (!d || !d.ip) return null;
  const m = (d.org || "").match(/^(AS\d+)\s+(.*)/);
  return {
    ip: d.ip, country: d.country, code: (d.country || "").toUpperCase(),
    region: d.region, city: d.city, isp: m ? m[2] : d.org, org: d.org, as: m ? m[1] : "",
    proxy: null, hosting: null, mobile: null, src: "ipinfo"
  };
}
function normIpwho(d) {
  if (!d || !d.success || !d.ip) return null;
  const c = d.connection || {};
  return {
    ip: d.ip, country: d.country, code: d.country_code,
    region: d.region, city: d.city, isp: c.isp || c.org, org: c.org, as: c.asn ? "AS" + c.asn : "",
    proxy: null, hosting: null, mobile: null, src: "ipwho"
  };
}

// ---------- 主流程：并发取最快 + 交叉验证 ----------
(async () => {
  const [ipapi, ipinfo, ipwho, ipsb, ipcfg] = await Promise.all([
    fetch(SOURCES.ipapi).then(normIpapi),
    fetch(SOURCES.ipinfo).then(normIpinfo),
    fetch(SOURCES.ipwho).then(normIpwho),
    fetchIP(SOURCES.ipsb),
    fetchIP(SOURCES.ipcfg)
  ]);

  // 选主数据：优先 ip-api（有风险信号），否则备源
  let main = ipapi || ipinfo || ipwho;
  // 纯 IP 兜底：结构化源全挂时至少拿到出口 IP
  const bareIP = ipsb || ipcfg;
  if (!main && bareIP) {
    done({
      title: META + " · 仅 IP",
      content: "策略组: " + groupName + "\nIP: " + bareIP + "\n（结构化源全部失败，仅纯 IP 源返回）",
      icon: "exclamationmark.triangle", "icon-color": "#FF9500"
    });
    return;
  }
  if (!main) {
    done({
      title: META + " · 失败",
      content: "策略组: " + groupName + "\n所有源均无响应\n检查 RULE-SET IPCheck.list 是否走 " + groupName,
      icon: "xmark.circle", "icon-color": "#FF3B30"
    });
    return;
  }

  // 交叉验证：不同源 IP 不一致 = 可能分流/中间人
  const ips = new Set([ipapi && ipapi.ip, ipinfo && ipinfo.ip, ipwho && ipwho.ip, ipsb, ipcfg].filter(Boolean));
  const ipMismatch = ips.size > 1 ? " ⚠️多源IP不一致" : "";

  // 归属交叉：备源补全主源缺失字段
  const geo = ipinfo || ipwho || {};
  const country = main.country || geo.country || "未知";
  const code = main.code || geo.code || "";
  const isp = main.isp || geo.isp || "未知";
  const as = main.as || (geo.as ? ("" + geo.as).startsWith("AS") ? geo.as : "AS" + geo.as : "未知");

  // 风险评分（仅 ip-api 有信号；备源无则标注"无数据"）
  let r;
  if (ipapi) { r = riskLevel(ipapi); }
  else { r = { type: "ℹ️ 备源无风险信号", risk: "⚪ 未知", score: 0 }; }

  const f = flag(code);
  const loc = [country, main.region || geo.region || "", main.city || geo.city || ""].filter(Boolean).join(" · ");
  const sources = [ipapi && "ip-api", ipinfo && "ipinfo", ipwho && "ipwho", ipsb && "ip.sb", ipcfg && "ifconfig"].filter(Boolean).join("/");

  // 面板精简版
  const panelLines = [
    "策略组: " + groupName,
    "IP: " + main.ip + ipMismatch,
    "归属: " + f + loc,
    "ISP: " + isp,
    "类型: " + r.type,
    "风险: " + r.risk + (r.score > 0 ? "  " + r.score + "/100" : "")
  ];

  // 通知完整版
  const notifyLines = [
    "策略组: " + groupName,
    "IP: " + main.ip + ipMismatch,
    "归属: " + f + loc + (code ? " (" + code + ")" : ""),
    "ISP: " + isp,
    "AS: " + as,
    "类型: " + r.type,
    "风险: " + r.risk + (r.score > 0 ? " | 纯净度 " + r.score + "/100" : ""),
    "数据源: " + sources
  ];

  // 通知（完整版）
  try { $notification.post(META, main.ip + " " + r.risk, notifyLines.join("\n")); } catch (e) {}

  done({
    title: f + " " + main.ip + (ipMismatch ? " ⚠️" : ""),
    content: panelLines.join("\n"),
    icon: r.score >= 70 ? "checkmark.shield.fill" : r.score >= 40 ? "exclamationmark.shield.fill" : (r.score > 0 ? "xmark.shield.fill" : "questionmark.shield"),
    "icon-color": r.score >= 70 ? "#34C759" : r.score >= 40 ? "#FF9500" : (r.score > 0 ? "#FF3B30" : "#8E8E93")
  });
})();
