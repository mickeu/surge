#!/usr/bin/env python3
"""muse 任务执行代理：每 2 秒向 Cloudflare Worker 队列取一条命令，执行后回传输出。

HTTP 层用 curl 子进程：egress 隧道代理要求 CONNECT + 代理认证，urllib 不支持带凭据的
HTTP 代理（会 Remote end closed connection without response），curl 已验证可通。

用法：
  export MUSEQ_URL=https://muse-queue.mickeu8009.workers.dev
  export MUSEQ_TOKEN=<token>
  export MUSEQ_PROXY=<可选；不填时 curl 继承 http_proxy/https_proxy>
  export MUSEQ_DRY=1            # 可选，只回执不执行
  nohup python3 muse_agent.py >/var/log/muse-agent.log 2>&1 &

日志不含凭据：代理地址只打印协议与主机，token 不打印。
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse

URL = os.environ.get("MUSEQ_URL", "").rstrip("/")
TOKEN = os.environ.get("MUSEQ_TOKEN", "")
PROXY = os.environ.get("MUSEQ_PROXY", "").strip()
POLL = float(os.environ.get("MUSEQ_POLL", "2"))
TIMEOUT = int(os.environ.get("MUSEQ_CMD_TIMEOUT", "900"))
WORKDIR = os.environ.get("MUSEQ_WORKDIR", os.path.expanduser("~"))
DRY = os.environ.get("MUSEQ_DRY", "") == "1"
UA = "muse-agent/3.0"
# 鉴权载体：query 默认（?k=）。hatch-egress-proxy 会把带 X-Token 头的请求黑洞掉，
# 头里有疑似凭据就挂起不返回，所以不能用 header 作为默认。
AUTH = os.environ.get("MUSEQ_AUTH", "query").strip().lower()


def mask_proxy(p):
    if not p:
        env = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or ""
        return "env:" + mask_proxy(env) if env else "-"
    raw = p if "://" in p else "http://" + p
    try:
        u = urllib.parse.urlsplit(raw)
        auth = "+auth" if (u.username or u.password) else ""
        return "%s://%s:%s%s" % (u.scheme, u.hostname or "?", u.port or "", auth)
    except Exception:
        return "set"


def call(path, payload=None, timeout=45):
    """返回 (http_code, body)。走 curl，代理与认证交给 curl 处理。"""
    args = ["curl", "-sS", "-m", str(timeout - 5),
            "-H", "User-Agent: " + UA, "-w", "\n%{http_code}"]
    if AUTH == "header":
        args += ["-H", "X-Client-Id: " + TOKEN]
    elif AUTH == "cookie":
        args += ["-H", "Cookie: mq=" + TOKEN]
    if PROXY:
        args += ["--proxy", PROXY]
    data = None
    if payload is not None:
        data = json.dumps(payload)
        args += ["-X", "POST", "-H", "Content-Type: application/json",
                 "--data-binary", "@-"]
    if AUTH == "query":
        sep = "&" if "?" in path else "?"
        args.append(URL + path + sep + "k=" + TOKEN)
    else:
        args.append(URL + path)
    p = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or "").strip()[:200] or ("curl exit %d" % p.returncode))
    body, _, code = p.stdout.rpartition("\n")
    try:
        return int(code.strip()), body
    except ValueError:
        return 0, body


def main():
    if not URL or not TOKEN:
        sys.exit("需要 MUSEQ_URL 与 MUSEQ_TOKEN")
    print("agent start url=%s proxy=%s poll=%ss dry=%s auth=%s" %
          (URL, mask_proxy(PROXY), POLL, DRY, AUTH), flush=True)

    while True:
        try:
            code, body = call("/next")
            if code == 204:
                time.sleep(POLL)
                continue
            if code != 200:
                print("HTTP %s %s" % (code, body.strip()[:120]), flush=True)
                time.sleep(5)
                continue
            item = json.loads(body)
            cmd = item.get("cmd", "")
            print("RUN %s" % cmd.replace("\n", " ; ")[:200], flush=True)
            t0 = time.time()

            if DRY:
                call("/done", {"cmd": cmd, "out": "DRY-RUN：未执行。", "code": 0, "cost": 0})
                print("DRY rc=0", flush=True)
                continue

            try:
                p = subprocess.run(cmd, shell=True, cwd=WORKDIR,
                                   capture_output=True, timeout=TIMEOUT)
                out = (p.stdout + p.stderr).decode("utf-8", "replace")[-20000:]
                rc = p.returncode
            except subprocess.TimeoutExpired:
                out, rc = "TIMEOUT after %ss" % TIMEOUT, 124
            except Exception as e:
                out, rc = "EXEC ERROR %s" % e, 1

            call("/done", {"cmd": cmd, "out": out, "code": rc,
                           "cost": round(time.time() - t0, 2)})
            print("DONE rc=%s cost=%.1fs out=%dB" % (rc, time.time() - t0, len(out)), flush=True)

        except Exception as e:
            print("ERR %s" % e, flush=True)
            time.sleep(5)


if __name__ == "__main__":
    main()
