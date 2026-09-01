/**
 * IP 纯净度检测 v3 — Scamalytics 真实评分 + 多源兜底
 *
 * 架构：
 *  Phase 1: 多源并发获取出口 IP（ip-api/ipinfo/ipwho/ip.sb/ifconfig）
 *  Phase 2: 若有 SCAMALYTICS_API_KEY 环境变量，调 Scamalytics API 取真实评分
 *  Phase 3: 无 key 时降级到 ip-api 布尔信号估算（旧逻辑）
 *
 * 规则法：不指定 policy，靠模块 [Rule] 段 RULE-SET 让检测域名走 {{{GROUP}}}
 * 环境变量：SCAMALYTICS_API_KEY（Minis 环境变量，脚本通过 $environment 读取）
 */

const META = "IP 纯净度 v3";

// ---------- 参数解析 ----------
let groupName = "PROXY", scamKey = "", scamUser = "";
if (typeof $argument !== "undefined" && $argument) {
  for (const p of String($argument).split("&")) {
    const i = p.indexOf("=");
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === "group") groupName = v;
    if (k === "key") scamKey = v;
    if (k === "user") scamUser = v;
  }
}
if (scamKey === "选填") scamKey = "";
if (scamUser === "选填") scamUser = "";
const SCAM_KEY = scamKey;
const SCAM_USER = scamUser;

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
}), 16000);

// ---------- 国旗 ----------
const FLAG = { CN:"🇨🇳",HK:"🇭🇰",TW:"🇹🇼",JP:"🇯🇵",SG:"🇸🇬",US:"🇺🇸",KR:"🇰🇷",GB:"🇬🇧",DE:"🇩🇪",FR:"🇫🇷",CA:"🇨🇦",AU:"🇦🇺",IN:"🇮🇳",RU:"🇷🇺",BR:"🇧🇷",NL:"🇳🇱",TR:"🇹🇷",TH:"🇹🇭",VN:"🇻🇳",PH:"🇵🇭",MY:"🇲🇾",ID:"🇮🇩",AE:"🇦🇪",AR:"🇦🇷",ES:"🇪🇸",IT:"🇮🇹",SE:"🇸🇪",CH:"🇨🇭",UA:"🇺🇦",PL:"🇵🇱",MX:"🇲🇽",CL:"🇨🇱" };
const flag = c => (c && c.length === 2) ? (FLAG[c.toUpperCase()] || "🌐") : "🌐";

// ---------- 请求封装 ----------
function fetchJson(url) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 9000);
    $httpClient.get(url, (err, resp, data) => {
      clearTimeout(t);
      if (err || !data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
    });
  });
}
function fetchText(url) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 7000);
    $httpClient.get(url, (err, resp, data) => {
      clearTimeout(t);
      resolve(err || !data ? null : String(data).trim());
    });
  });
}

// ---------- Scamalytics API ----------
function fetchScamalytics(ip) {
  if (!SCAM_KEY || !ip) return Promise.resolve(null);
  const url = "https://api11.scamalytics.com/v3/" + SCAM_USER + "/?key=" + SCAM_KEY + "&ip=" + encodeURIComponent(ip);
  return fetchJson(url).then(d => {
    if (!d || !d.scamalytics || d.scamalytics.status !== "ok") return null;
    return d.scamalytics;
  });
}

// ---------- Scamalytics 数据解析 ----------
function parseScamalytics(s) {
  const score = parseInt(s.scamalytics_score) || 0;
  const riskLabel = s.scamalytics_risk || "";
  const riskLevel = String(riskLabel).toLowerCase();
  let riskEmoji;
  if (riskLevel.includes("high")) riskEmoji = "🔴 高风险";
  else if (riskLevel.includes("medium")) riskEmoji = "🟡 中风险";
  else if (riskLevel.includes("low")) riskEmoji = "🟢 低风险";
  else riskEmoji = "⚪ " + (riskLabel || "未知");

  // 代理/VPN 状态（scamalytics_proxy 对象）
  const p = s.scamalytics_proxy || {};
  const proxyFlags = [];
  if (p.is_vpn) proxyFlags.push("VPN");
  if (p.is_datacenter) proxyFlags.push("机房");
  if (p.is_apple_icloud_private_relay) proxyFlags.push("iCloud中继");
  if (p.is_amazon_aws) proxyFlags.push("AWS");
  if (p.is_google) proxyFlags.push("Google");
  const proxyStatus = proxyFlags.length > 0 ? "⚠️ " + proxyFlags.join("/") : "✅ 无";

  // 外部数据源交叉验证
  const ext = s.external_datasources || {};
  const x4b = ext.x4bnet || {};
  if (x4b.is_datacenter && !p.is_datacenter) proxyFlags.push("机房(x4b)");
  if (x4b.is_vpn && !p.is_vpn) proxyFlags.push("VPN(x4b)");

  // 黑名单
  const blacklisted = !!s.is_blacklisted_external;
  const blExt = ext.firehol || {}, blIp = ext.ipsum || {}, blSpam = ext.spamhaus_drop || {};
  if (blIp.ip_blacklisted || (blExt.ip_blacklisted_1day) || (blExt.ip_blacklisted_30)) {
    // 补充外部黑名单检测
  }

  // 类型判定
  let type;
  if (p.is_datacenter || x4b.is_datacenter) type = "🏢 数据中心";
  else if (p.is_vpn || x4b.is_vpn) type = "🔀 代理/VPN";
  else type = "🏠 住宅 IP";

  return {
    type: type,
    risk: riskEmoji,
    score: score,
    riskLabel: riskLabel,
    proxyStatus: proxyStatus,
    blacklisted: blacklisted
  };
}

// ---------- 旧逻辑：ip-api 布尔信号估算（降级用）----------
function riskLevelLegacy(d) {
  const hosting = !!d.hosting, proxy = !!d.proxy, mobile = !!d.mobile;
  let type, risk, score = 100;
  if (hosting && proxy) { type = "🏢🔀 机房+代理"; risk = "🔴 高风险"; score = 25; }
  else if (hosting)     { type = "🏢 数据中心";   risk = "🟡 中风险"; score = 60; }
  else if (proxy)       { type = "🔀 代理/VPN";    risk = "🟡 中风险"; score = 55; }
  else if (mobile)     { type = "📱 移动网络";    risk = "🟢 低风险"; score = 90; }
  else                  { type = "🏠 住宅 IP";     risk = "🟢 低风险"; score = 95; }
  return { type, risk, score };
}

// ---------- 源定义 ----------
const SOURCES = {
  ipapi:  "http://ip-api.com/json?fields=status,query,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile",
  ipinfo: "https://ipinfo.io/json",
  ipwho:  "https://ipwho.is/",
  ipsb:   "https://api.ip.sb/ip",
  ipcfg:  "https://ifconfig.me/ip"
};

function normIpapi(d) {
  if (!d || d.status === "fail") return null;
  return { ip: d.query, country: d.country, code: d.countryCode, region: d.regionName, city: d.city, isp: d.isp, org: d.org, as: d.as, proxy: d.proxy, hosting: d.hosting, mobile: d.mobile };
}
function normIpinfo(d) {
  if (!d || !d.ip) return null;
  const m = (d.org || "").match(/^(AS\d+)\s+(.*)/);
  return { ip: d.ip, country: d.country, code: (d.country || "").toUpperCase(), region: d.region, city: d.city, isp: m ? m[2] : d.org, org: d.org, as: m ? m[1] : "" };
}
function normIpwho(d) {
  if (!d || !d.success || !d.ip) return null;
  const c = d.connection || {};
  return { ip: d.ip, country: d.country, code: d.country_code, region: d.region, city: d.city, isp: c.isp || c.org, org: c.org, as: c.asn ? "AS" + c.asn : "" };
}

// ---------- 主流程 ----------
(async () => {
  // Phase 1: 多源并发取出口 IP
  const [ipapi, ipinfo, ipwho, ipsb, ipcfg] = await Promise.all([
    fetchJson(SOURCES.ipapi).then(normIpapi),
    fetchJson(SOURCES.ipinfo).then(normIpinfo),
    fetchJson(SOURCES.ipwho).then(normIpwho),
    fetchText(SOURCES.ipsb),
    fetchText(SOURCES.ipcfg)
  ]);

  let main = ipapi || ipinfo || ipwho;
  const bareIP = ipsb || ipcfg;
  if (!main && bareIP) {
    done({ title: META + " · 仅 IP", content: "策略组: " + groupName + "\nIP: " + bareIP + "\n（结构化源全部失败）", icon: "exclamationmark.triangle", "icon-color": "#FF9500" });
    return;
  }
  if (!main) {
    done({ title: META + " · 失败", content: "策略组: " + groupName + "\n所有源均无响应", icon: "xmark.circle", "icon-color": "#FF3B30" });
    return;
  }

  // Phase 2: 交叉验证（v4/v6 分组）
  const allIPs = [ipapi && ipapi.ip, ipinfo && ipinfo.ip, ipwho && ipwho.ip, ipsb, ipcfg].filter(Boolean);
  const v4 = allIPs.filter(x => x && x.includes("."));
  const v6 = allIPs.filter(x => x && x.includes(":"));
  const dualStack = v4.length > 0 && v6.length > 0;
  const realMismatch = new Set(v4).size > 1 || new Set(v6).size > 1;
  const ipMismatch = realMismatch ? " ⚠️IP不一致" : (dualStack ? " 🔀双栈" : "");

  // 归属
  const geo = ipinfo || ipwho || {};
  const country = main.country || geo.country || "未知";
  const code = main.code || geo.code || "";
  const isp = main.isp || geo.isp || "未知";
  const as = main.as || (geo.as ? ("" + geo.as).startsWith("AS") ? geo.as : "AS" + geo.as : "未知");
  const f = flag(code);
  const loc = [country, main.region || geo.region || "", main.city || geo.city || ""].filter(Boolean).join(" · ");
  const sources = [ipapi && "ip-api", ipinfo && "ipinfo", ipwho && "ipwho", ipsb && "ip.sb", ipcfg && "ifconfig"].filter(Boolean).join("/");

  // Phase 3: Scamalytics 真实评分（优先 v4，回退 v6）
  const queryIP = v4[0] || v6[0];
  const scamData = await fetchScamalytics(queryIP);
  let r, scamDisplay;

  if (scamData) {
    const s = parseScamalytics(scamData);
    r = { type: s.type, risk: s.risk, score: s.score };
    scamDisplay = {
      proxyStatus: s.proxyStatus,
      blacklisted: s.blacklisted,
      scoreLabel: s.score + "/100",
      riskLabel: s.riskLabel || ""
    };
  } else if (SCAM_KEY) {
    r = riskLevelLegacy(ipapi || {});
    scamDisplay = { proxyStatus: "API失败", blacklisted: false, scoreLabel: r.score + "/100(估算)", riskLabel: "" };
  } else {
    r = ipapi ? riskLevelLegacy(ipapi) : { type: "无信号", risk: "未知", score: 0 };
    scamDisplay = { proxyStatus: "", blacklisted: false, scoreLabel: (r.score > 0 ? r.score + "/100" : "无数据"), riskLabel: "" };
  }

  // 面板详细版
  const panelLines = [
    "策略组: " + groupName,
    "IP: " + main.ip + ipMismatch,
    "归属: " + f + loc + (code ? " (" + code + ")" : ""),
    "ISP: " + isp,
    "AS: " + as,
    "类型: " + r.type,
    "风险: " + r.risk + " | " + scamDisplay.scoreLabel
  ];
  if (scamDisplay.proxyStatus && scamDisplay.proxyStatus !== "API失败") {
    panelLines.push("代理/VPN: " + scamDisplay.proxyStatus);
  }
  if (scamDisplay.blacklisted) panelLines.push("黑名单: ⚠️ 已收录");
  else if (scamDisplay.proxyStatus !== "" && scamDisplay.proxyStatus !== "API失败") panelLines.push("黑名单: 未收录");

  // 通知完整版
  const notifyLines = [
    "策略组: " + groupName,
    "IP: " + main.ip + ipMismatch,
    "归属: " + f + loc + (code ? " (" + code + ")" : ""),
    "ISP: " + isp,
    "AS: " + as,
    "类型: " + r.type,
    "风险: " + r.risk + " | 评分: " + scamDisplay.scoreLabel,
    "代理/VPN: " + scamDisplay.proxyStatus,
    "黑名单: " + (scamDisplay.blacklisted ? "⚠️ 已收录" : "未收录"),
    "数据源: " + (scamDisplay.proxyStatus ? "Scamalytics" : sources)
  ];
  try { $notification.post(META, main.ip + " " + r.risk, notifyLines.join("\n")); } catch (e) {}

  // 图标三色跟随风险等级（🔴🟡🟢），不依赖 score 方向
  const riskStr = String(r.risk || "");
  let iconColor, iconName;
  if (riskStr.includes("🔴")) { iconColor = "#FF3B30"; iconName = "xmark.shield.fill"; }
  else if (riskStr.includes("🟡")) { iconColor = "#FF9500"; iconName = "exclamationmark.shield.fill"; }
  else if (riskStr.includes("🟢")) { iconColor = "#34C759"; iconName = "checkmark.shield.fill"; }
  else { iconColor = "#8E8E93"; iconName = "questionmark.shield"; }

  done({
    title: f + " " + main.ip + (realMismatch ? " ⚠️" : ""),
    content: panelLines.join("\n"),
    icon: iconName,
    "icon-color": iconColor
  });
})();
