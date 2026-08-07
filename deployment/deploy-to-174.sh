#!/bin/bash
# 部署 RTMS 到 10.203.64.174
# 用法: ./deployment/deploy-to-174.sh

set -e

SERVER="10.203.64.174"
REMOTE_DIR="~/zp-rtms-autostart_sample-js"
PROJECT_NAME="zp-rtms-autostart_sample-js"
NGINX_CONF="/opt/docker/pbxms/conf/nginx.conf"
NGINX_CONTAINER="docker_pbx_microservice"
PUBLIC_DOMAIN="newqa01mszone7.zoomdev.us"
PUBLIC_IP="38.111.222.121"
NGINX_PORT="3001"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 步骤 1: 检查本地环境
echo_info "步骤 1/8: 检查本地环境..."

if [ ! -f ".env" ]; then
    echo_error ".env 文件不存在，请先配置"
    exit 1
fi

# 检查 .env 中的 URL 配置
if ! grep -q "PUBLIC_URL.*${PUBLIC_DOMAIN}:${NGINX_PORT}" .env 2>/dev/null; then
    echo_warn ".env 文件中的 PUBLIC_URL 可能需要更新为: https://${PUBLIC_DOMAIN}:${NGINX_PORT}"
fi

echo_info "本地环境检查通过"

# 步骤 2: 打包项目
echo_info "步骤 2/8: 打包项目..."

cd ..
tar -czf ${PROJECT_NAME}.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude='rtms/data/audio/*' \
    --exclude='rtms/data/transcripts/*' \
    ${PROJECT_NAME}/

echo_info "项目打包完成"

# 步骤 3: 上传到服务器
echo_info "步骤 3/8: 上传到 ${SERVER}..."

scp ${PROJECT_NAME}.tar.gz ${SERVER}:~/
rm -f ${PROJECT_NAME}.tar.gz

# 步骤 4: 解压项目
echo_info "步骤 4/8: 在服务器上解压..."

ssh ${SERVER} << 'ENDSSH'
if [ -d ~/zp-rtms-autostart_sample-js ]; then
    echo "备份现有部署..."
    mv ~/zp-rtms-autostart_sample-js ~/zp-rtms-autostart_sample-js.backup.$(date +%Y%m%d_%H%M%S)
fi
tar -xzf ~/zp-rtms-autostart_sample-js.tar.gz
rm -f ~/zp-rtms-autostart_sample-js.tar.gz
ENDSSH

# 步骤 5: 上传配置
echo_info "步骤 5/8: 上传 .env 配置..."

cd ${PROJECT_NAME}
scp .env ${SERVER}:${REMOTE_DIR}/

# 步骤 6: 添加 nginx 配置
echo_info "步骤 6/8: 配置 nginx..."

echo ""
echo_warn "需要手动添加以下配置到 ${NGINX_CONF}"
echo ""
cat deployment/nginx-config-10.203.64.174.conf
echo ""

read -p "是否已添加 nginx 配置？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo_warn "请手动添加配置，然后重新运行此脚本"
    echo "配置文件: deployment/nginx-config-10.203.64.174.conf"
    exit 1
fi

# 步骤 7: 测试并重载 nginx
echo_info "步骤 7/8: 测试并重载 nginx..."

ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -t"
ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -s reload"

echo_info "nginx 配置更新完成"

# 步骤 8: 启动 Docker 服务
echo_info "步骤 8/8: 启动 Docker 服务..."

ssh ${SERVER} << 'ENDSSH'
cd ~/zp-rtms-autostart_sample-js

# 停止旧容器
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# 构建并启动
echo "构建 Docker 镜像..."
docker compose -f docker-compose.prod.yml build

echo "启动服务..."
docker compose -f docker-compose.prod.yml up -d

# 等待服务启动
sleep 10

# 检查容器状态
docker compose -f docker-compose.prod.yml ps

# 健康检查
for i in {1..10}; do
    if curl -s http://127.0.0.1:9001/health | grep -q "ok"; then
        echo "✓ Backend 健康检查通过"
        break
    fi
    echo "等待 backend 启动... ($i/10)"
    sleep 2
done
ENDSSH

echo ""
echo_info "==================================="
echo_info "部署完成！"
echo_info "==================================="
echo ""
echo "访问地址:"
echo "  HTTPS: https://${PUBLIC_DOMAIN}:${NGINX_PORT}"
echo "  健康检查: https://${PUBLIC_DOMAIN}:${NGINX_PORT}/health"
echo "  (IP: ${PUBLIC_IP})"
echo ""
echo "Zoom Marketplace 配置:"
echo "  Webhook URL: https://${PUBLIC_DOMAIN}:${NGINX_PORT}/api/webhooks/zoom"
echo "  OAuth Redirect: https://${PUBLIC_DOMAIN}:${NGINX_PORT}/api/auth/callback"
echo ""
echo "查看日志:"
echo "  ssh ${SERVER}"
echo "  cd ${REMOTE_DIR}"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
