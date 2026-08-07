#!/bin/bash
# RTMS 服务验证脚本
# 用法: ./deployment/verify.sh

SERVER="10.203.65.98"
NGINX_PORT="3003"
BACKEND_PORT="9002"
DOMAIN="qa01zccrtmszone7.zoomdev.us"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
}

check_warn() {
    echo -e "${YELLOW}!${NC} $1"
}

echo "========================================"
echo "RTMS 服务部署验证"
echo "========================================"
echo ""

# 1. 检查容器状态
echo "[1/6] 检查 Docker 容器状态..."
ssh ${SERVER} "docker ps --filter 'name=zp-rtms' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" > /tmp/rtms_containers.txt

if grep -q "zp-rtms-backend-alex" /tmp/rtms_containers.txt && \
   grep -q "zp-rtms-frontend-alex" /tmp/rtms_containers.txt && \
   grep -q "zp-rtms-server-alex" /tmp/rtms_containers.txt; then
    check_pass "所有容器正在运行"
    cat /tmp/rtms_containers.txt
else
    check_fail "部分容器未运行"
    cat /tmp/rtms_containers.txt
    exit 1
fi
echo ""

# 2. 检查本地端口
echo "[2/6] 检查本地端口 ${BACKEND_PORT}..."
if ssh ${SERVER} "curl -s http://127.0.0.1:${BACKEND_PORT}/health" | grep -q "ok"; then
    check_pass "Backend 本地端口 ${BACKEND_PORT} 可访问"
else
    check_fail "Backend 本地端口 ${BACKEND_PORT} 不可访问"
    exit 1
fi
echo ""

# 3. 检查 nginx 配置
echo "[3/6] 检查 nginx 配置..."
if ssh ${SERVER} "sudo docker exec docker_pbx_microservice nginx -t" 2>&1 | grep -q "successful"; then
    check_pass "nginx 配置语法正确"
else
    check_fail "nginx 配置有误"
    exit 1
fi

if ssh ${SERVER} "sudo cat /opt/docker/pbxms/conf/nginx.conf" | grep -q "listen 3003 ssl"; then
    check_pass "nginx 配置包含端口 3003"
else
    check_warn "未找到端口 3003 配置，请手动添加"
fi
echo ""

# 4. 检查 nginx 代理
echo "[4/6] 检查 nginx 代理（端口 ${NGINX_PORT}）..."
if curl -k -s "https://${DOMAIN}:${NGINX_PORT}/health" | grep -q "ok"; then
    check_pass "nginx 代理工作正常"
else
    check_fail "nginx 代理无法访问"
    echo "请检查:"
    echo "  1. nginx 配置是否正确"
    echo "  2. 端口 ${NGINX_PORT} 是否被占用"
    echo "  3. 防火墙规则"
    exit 1
fi
echo ""

# 5. 检查前端访问
echo "[5/6] 检查前端页面..."
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}:${NGINX_PORT}/")
if [ "$HTTP_CODE" = "200" ]; then
    check_pass "前端页面可访问（HTTP ${HTTP_CODE}）"
else
    check_warn "前端页面返回 HTTP ${HTTP_CODE}"
fi
echo ""

# 6. 检查 Zoom Webhook 端点
echo "[6/6] 检查 Zoom Webhook 端点..."
WEBHOOK_URL="https://${DOMAIN}:${NGINX_PORT}/api/webhooks/zoom"
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" -X POST "${WEBHOOK_URL}")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "401" ]; then
    check_pass "Webhook 端点响应（HTTP ${HTTP_CODE}）"
    echo "   注意: 401/400 是正常的（缺少签名）"
else
    check_warn "Webhook 端点返回 HTTP ${HTTP_CODE}"
fi
echo ""

# 总结
echo "========================================"
echo "验证完成"
echo "========================================"
echo ""
echo "服务地址:"
echo "  前端:     https://${DOMAIN}:${NGINX_PORT}"
echo "  健康检查: https://${DOMAIN}:${NGINX_PORT}/health"
echo "  Webhook:  https://${DOMAIN}:${NGINX_PORT}/api/webhooks/zoom"
echo ""
echo "查看实时日志:"
echo "  ssh ${SERVER}"
echo "  cd ~/zp-rtms-autostart_sample-js"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "下一步:"
echo "  1. 在 Zoom Marketplace 配置 Webhook URL"
echo "  2. 在 Zoom Marketplace 配置 OAuth Redirect URL"
echo "  3. 测试呼叫录音功能"
echo ""
