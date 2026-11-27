#!/usr/bin/env python3
"""muse 任务执行代理：每 2 秒向 Cloudflare Worker 队列取一条命令，执行后回传输出。

用法：
  export MUSEQ_URL=https://muse-queue.mickeu8009.workers.dev
  export MUSEQ_TOKEN=<token>
  export MUSEQ_PROXY=<egress 代理地址>   # 需要走代理时填，形如 http://user:pass@host:3130
  nohup python3 muse_agent.py >/var/log/muse-agent.log 2>&1 &

日志里每轮一行：取了什么命令、退出码。空队列不打印。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

URL = os.environ.get("MUSEQ_URL", "").rstrip("/")
TOKEN = os.environ.get("MUSEQ_TOKEN", "")
PROXY = os.environ.get("MUSEQ_PROXY", "").strip()
POLL = float(os.environ.get("MUSEQ_POLL", "2"))
TIMEOUT = int(os.environ.get("MUSEQ_CMD_TIMEOUT", "900"))
WORKDIR = os.environ.get("MUSEQ_WORKDIR", os.path.expanduser("~"))
DRY = os.environ.get("MUSEQ_DRY", "") == "1"


def call(path, payload=None, timeout=30):
    url = "%s%s?token=%s" % (URL, path, TOKEN)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json",
                 "User-Agent": "muse-agent/1.0"},
        method="POST" if data else "GET")
    if PROXY:
        scheme = PROXY.split("://", 1)[0] if "://" in PROXY else "http"
        req.set_proxy(PROXY.split("://", 1)[-1], scheme)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main():
    if not URL or not TOKEN:
        sys.exit("需要 MUSEQ_URL 与 MUSEQ_TOKEN")
    print("agent start url=%s proxy=%s poll=%ss dry=%s" % (URL, PROXY or "-", POLL, DRY), flush=True)
    while True:
        try:
            code, body = call("/next")
            if code == 204:
                time.sleep(POLL)
                continue
            item = json.loads(body)
            cmd = item.get("cmd", "")
            print("RUN %s" % cmd.replace("\n", " ; ")[:200], flush=True)
            t0 = time.time()
            if DRY:
                call("/done", {"cmd": cmd, "out": "DRY-RUN：未执行。命令原文见上。",
                               "code": 0, "cost": 0})
                print("DRY %s" % cmd.replace("\n", " ; ")[:200], flush=True)
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
        except urllib.error.HTTPError as e:
            if e.code == 403:
                sys.exit("token 被拒（403），检查 MUSEQ_TOKEN")
            print("HTTP %s" % e.code, flush=True)
            time.sleep(5)
        except Exception as e:
            print("ERR %s" % e, flush=True)
            time.sleep(5)


if __name__ == "__main__":
    main()
