#!/bin/sh
# sync-config.sh — 将 Surge 本地配置中"可公开"的部分自动同步到 GitHub（mickeu/surge）
# 用法: sh /var/minis/shared/surge-sync/sync-config.sh
# 依赖: GITHUB_TOKEN 环境变量（已配置）
#
# ⚠️ 仅同步不含密钥/密码的文件。以下文件含敏感信息，严禁推公开仓库：
#   - mitm-ca.dconf      （CA 私钥 p12）
#   - Proxy.dconf        （snell psk）
#   - Script.dconf       （网上国网明文账号密码）
#   - .conf / .p12       （主配置 / 证书）

set -e

REPO=/var/minis/shared/surge-sync
LOCAL=/var/minis/mounts/nssurge
BRANCH=main

cd "$REPO"
git fetch origin "$BRANCH" --quiet 2>/dev/null || true

# 同步映射：<本地文件> <仓库相对路径>
# 只放无敏感信息的文件，新增条目前先确认不含密钥
SYNC_MAP="
Rule.dconf|Config/Rule.dconf
"

changed=0
for entry in $SYNC_MAP; do
  src="${entry%%|*}"
  dst="${entry##*|}"
  if [ ! -f "$LOCAL/$src" ]; then
    echo "⚠️ 跳过 $src：本地不存在"
    continue
  fi
  if ! diff -q "$LOCAL/$src" "$dst" >/dev/null 2>&1; then
    cp "$LOCAL/$src" "$dst"
    echo "→ 已更新 $dst"
    changed=1
  else
    echo "✓ $dst 与本地一致"
  fi
done

if [ "$changed" = "0" ]; then
  echo "✓ 无变更，不需要推送"
  exit 0
fi

git add -A
git commit -m "sync: Surge Rule 配置 $(date +'%Y-%m-%d %H:%M')" || { echo "✓ 无新增提交"; exit 0; }

# 一次性 token 推送，避免 token 写入 .git/config
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/mickeu/surge.git" "$BRANCH" >/dev/null 2>&1
echo "✓ 已推送到 GitHub（mickeu/surge $BRANCH）"