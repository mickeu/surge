// t.me → 第三方 Telegram 客户端重定向（Surge 兼容版）
// 逻辑移植自 Aswoth/Keek 的 TGRedirect.js（Egern 版改写为 Surge 脚本）
// 通过模块 argument 里的 tme_redirect 指定目标客户端（如 Turrit）

const CLIENT = "Turrit"; // 默认，可由 argument 覆盖

const SCHEME = {
  Telegram: "tg",
  Swiftgram: "sg",
  Turrit: "turrit",
  iMe: "ime",
  Nicegram: "ng",
  Lingogram: "lingo",
  Nagram: "tg",
};

function qval(qs, key) {
  if (!qs) return "";
  const re = new RegExp("(?:^|&)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)");
  const m = qs.match(re);
  return m ? decodeURIComponent(m[1]) : "";
}

function deeplink(s, path, qs) {
  const p = path.split("/").filter(Boolean);
  if (!p[0]) return "";

  if (p[0][0] === "+") {
    return `${s}://join?invite=${encodeURIComponent(p[0].slice(1))}`;
  }

  if (p[0] === "joinchat" && p[1]) {
    return `${s}://join?invite=${encodeURIComponent(p[1])}`;
  }

  if (p[0] === "addstickers" && p[1]) {
    return `${s}://addstickers?set=${encodeURIComponent(p[1])}`;
  }

  if (p[0] === "share" && p[1] === "url") {
    return `${s}://msg_url?url=${encodeURIComponent(qval(qs, "url"))}&text=${encodeURIComponent(qval(qs, "text"))}`;
  }

  if (p[1] && /^\d+$/.test(p[1])) {
    return `${s}://resolve?domain=${encodeURIComponent(p[0])}&post=${encodeURIComponent(p[1])}`;
  }

  return `${s}://resolve?domain=${encodeURIComponent(p[0])}`;
}

function onRequest() {
  const url = $request.url;
  const m = url.match(/^https?:\/\/t\.me\/(.+)$/i);
  if (!m) {
    $done({});
    return;
  }

  // 从 argument 提取目标客户端（tme_redirect=Turrit）覆盖默认值
  let client = CLIENT;
  if ($argument && /tme_redirect=([^&]+)/.test($argument)) {
    client = $argument.match(/tme_redirect=([^&]+)/)[1];
  }
  const scheme = SCHEME[client] || "tg";

  let tail = m[1];
  if (tail.startsWith("s/")) tail = tail.slice(2);

  const qi = tail.indexOf("?");
  const path = qi < 0 ? tail : tail.slice(0, qi);
  const qs = qi < 0 ? "" : tail.slice(qi + 1);

  const loc = deeplink(scheme, path, qs);
  if (!loc) {
    $done({});
    return;
  }

  $done({
    response: {
      status: 302,
      headers: { Location: loc, "Cache-Control": "no-store, no-cache" },
    },
  });
}

onRequest();