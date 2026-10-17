#!/usr/bin/env bash
# 部署：提交站点文件到 GitHub 仓库，Pages 自动发布（替代 CF wrangler 直传）
# 用法：bash deploy-git.sh
# 前置：
#   1) GitHub 仓库已建好（公开仓库，免费档 Pages 要求），Settings->Pages 选 Deploy from branch
#   2) fine-grained PAT（仅 Contents: Read and Write）写入 .gh_token（chmod 600）
#   3) 仓库名默认 xyp-rr/xyp-rr，可用环境变量覆盖：GH_REPO=user/repo bash deploy-git.sh
# 注意：含变量的行必须保持 ASCII（中文说明放独立无变量行），否则部分终端会丢变量
set -euo pipefail

ROOT="/Users/xyp/guangzhou-events"
TOKEN_FILE="$ROOT/.gh_token"
REPO="${GH_REPO:-xyp-rr/xyp-rr}"
BRANCH="${GH_BRANCH:-main}"
N="/Users/xyp/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"

cd "$ROOT"

# 1) 数据门禁：校验不过不提交，坏数据到不了线上
"$N" "$ROOT/tools/validate.mjs"

# 2) 暂存站点文件；机密与本地产物由 .gitignore 排除
git add index.html data/
if git diff --cached --quiet; then
  echo "no changes, skip push"
  exit 0
fi

# 3) 推送前机密门禁：机密文件不得入库，暂存内容不得含常见令牌样式
if git ls-files | grep -qE "^\.(cf|gh)_token$"; then
  echo "ERROR: secret file tracked, abort" >&2
  exit 1
fi
if git grep -qE "ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|AKIA[0-9A-Z]{16}" -- .; then
  echo "ERROR: token-like string found in tracked files, abort" >&2
  exit 1
fi
git commit -m "data: update events"

# 4) 一次性 URL 推送：token 不落 git config；输出脱敏防泄漏
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: token file not found: $TOKEN_FILE" >&2
  echo "请把 GitHub fine-grained PAT（Contents: Read and Write）写入该文件，并 chmod 600" >&2
  exit 1
fi
TOKEN="$(cat "$TOKEN_FILE")"
GIT_TERMINAL_PROMPT=0 git push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "HEAD:${BRANCH}" 2>&1 | sed -E 's/(x-access-token:)[^@]*/\1***/'
echo "OK: pushed to ${REPO} (${BRANCH}), Pages publishing"
