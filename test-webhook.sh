#!/bin/bash
# 测试 Zoom Webhook 端点
# 用法: ./test-webhook.sh [endpoint_url]

ENDPOINT="${1:-http://localhost:3001/api/webhooks/zoom}"
TIMESTAMP=$(date +%s)

# 模拟 endpoint.url_validation 事件
echo "测试 endpoint.url_validation..."

PAYLOAD='{
  "event": "endpoint.url_validation",
  "payload": {
    "plainToken": "test_token_123"
  }
}'

# 计算签名（需要 ZOOM_SECRET_TOKEN）
# 注意：这里需要你的实际 ZOOM_SECRET_TOKEN
if [ -z "$ZOOM_SECRET_TOKEN" ]; then
    echo "错误: 请设置 ZOOM_SECRET_TOKEN 环境变量"
    echo "用法: ZOOM_SECRET_TOKEN=your_token ./test-webhook.sh"
    exit 1
fi

MESSAGE="v0:${TIMESTAMP}:${PAYLOAD}"
SIGNATURE="v0=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$ZOOM_SECRET_TOKEN" | awk '{print $2}')"

echo "Timestamp: $TIMESTAMP"
echo "Signature: $SIGNATURE"
echo ""

curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-zm-request-timestamp: $TIMESTAMP" \
  -H "x-zm-signature: $SIGNATURE" \
  -d "$PAYLOAD"

echo ""
echo "完成！"
