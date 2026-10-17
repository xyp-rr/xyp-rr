#!/usr/bin/env bash
# 推送脚本：把 index.html 与 data/ 下的城市活动 JSON 直传到 Cloudflare Pages
# 用法：bash deploy.sh
# 前置：
#   1) 在 Cloudflare 控制台建好 Pages 项目（直接上传方式，项目名即下方 PROJECT）
#   2) 生成 API Token（权限 Cloudflare Pages: Edit），写入 .cf_token（chmod 600）
#   3) 可选：把 Account ID 写入 .cf_account（token 绑定单账号时可省略）
# 注意：含变量的行必须保持 ASCII（中文说明放独立无变量行），否则部分终端会丢变量
set -euo pipefail

ROOT="/Users/xyp/guangzhou-events"
SRC="$ROOT/index.html"
DATA_DIR="$ROOT/data"
PUBLIC_DIR="$ROOT/public"
TOKEN_FILE="$ROOT/.cf_token"
ACCOUNT_FILE="$ROOT/.cf_account"
PROJECT="gz-events"

N="/Users/xyp/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
W="/Users/xyp/.workbuddy/binaries/node/workspace/node_modules/.bin/wrangler"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: source file not found: $SRC" >&2
  exit 1
fi
if [[ ! -f "$DATA_DIR/cities.json" ]]; then
  echo "ERROR: city registry not found: $DATA_DIR/cities.json" >&2
  exit 1
fi
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: CF token file not found: $TOKEN_FILE" >&2
  echo "请把 Cloudflare API Token（Pages:Edit 权限）写入该文件，并 chmod 600" >&2
  exit 1
fi

# 部署前数据门禁：校验不过则中止，避免把坏数据推上线
echo ">> validating city data"
"$N" "$ROOT/tools/validate.mjs"

# 复制到干净的 public 目录，只带 index.html 与 data/，避免把 .cf_token 等机密一起上传
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR/data"
cp "$SRC" "$PUBLIC_DIR/index.html"
cp "$DATA_DIR/cities.json" "$PUBLIC_DIR/data/"
shopt -s nullglob
for f in "$DATA_DIR"/events-*.json; do
  cp "$f" "$PUBLIC_DIR/data/"
done
shopt -u nullglob

# 缓存策略：HTML 短缓存保证每日更新及时可见，JSON 略长（页面 fetch 已带 no-store，双保险）
cat > "$PUBLIC_DIR/_headers" <<'EOF'
/index.html
  Cache-Control: public, max-age=300
/data/*
  Cache-Control: public, max-age=600
EOF

export CLOUDFLARE_API_TOKEN="$(cat "$TOKEN_FILE")"

# 组装命令：CMD 始终非空，避免旧版 bash + set -u 下空数组展开报错
# 注意：项目需提前在 Cloudflare 控制台建好（直接上传方式），否则会卡在交互提示
CMD=("$N" "$W" pages deploy "$PUBLIC_DIR" --project-name "$PROJECT")
if [[ -f "$ACCOUNT_FILE" ]]; then
  CMD+=(--account-id "$(cat "$ACCOUNT_FILE")")
fi

echo ">> deploying to Cloudflare Pages project: $PROJECT"
TMP_OUT="$(mktemp)"
# 输出做脱敏：token/authorization 字样一律打码，防日志泄漏
if "${CMD[@]}" 2>&1 | sed -E 's/(token|secret|authorization)[ =:][^[:space:]]*/\1 [REDACTED]/I' | tee "$TMP_OUT"; then
  rm -f "$TMP_OUT"
  echo "OK: Cloudflare Pages deploy finished"
else
  rc=${PIPESTATUS[0]}
  if grep -qi "non-interactive" "$TMP_OUT"; then
    echo "ERROR: deploy rejected in non-interactive context." >&2
    echo "Most likely the Cloudflare Pages project '$PROJECT' does not exist yet." >&2
    echo "请在 Cloudflare 控制台先创建该项目（直接上传方式），或一次性运行：" >&2
    echo "  wrangler pages project create $PROJECT --production-branch main" >&2
  else
    echo "ERROR: deploy failed (exit $rc), see output above." >&2
  fi
  rm -f "$TMP_OUT"
  exit 1
fi
