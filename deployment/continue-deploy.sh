#!/bin/bash
# 继续部署（从步骤 6 开始）

set -e

SERVER="10.203.64.174"
NGINX_CONF="/opt/docker/pbxms/conf/nginx.conf"
NGINX_CONTAINER="docker_pbx_microservice"

GREEN='\033[0;32m'
NC='\033[0m'

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

# 步骤 6: 上传 nginx 配置
echo_info "步骤 6: 上传 nginx 配置..."
scp /Users/AlexZhang/dir/nginx.conf ${SERVER}:~/nginx.conf.new

echo_info "备份现有 nginx 配置..."
ssh ${SERVER} "sudo cp ${NGINX_CONF} ${NGINX_CONF}.backup.\$(date +%Y%m%d_%H%M%S)"

echo_info "替换 nginx 配置..."
ssh ${SERVER} "sudo cp ~/nginx.conf.new ${NGINX_CONF}"

# 步骤 7: 测试并重载 nginx
echo_info "步骤 7: 测试 nginx 配置..."
ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -t"

echo_info "重载 nginx..."
ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -s reload"

# 步骤 8: 启动 Docker 服务
echo_info "步骤 8: 启动 Docker 服务..."

ssh ${SERVER} << 'ENDSSH'
cd ~/zp-rtms-autostart_sample-js

docker compose -f docker-compose.prod.yml down 2>/dev/null || true

echo "构建 Docker 镜像..."
docker compose -f docker-compose.prod.yml build

echo "启动服务..."
docker compose -f docker-compose.prod.yml up -d

sleep 10

docker compose -f docker-compose.prod.yml ps

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
echo_info "部署完成！"
echo ""
echo "访问地址:"
echo "  https://newqa01mszone7.zoomdev.us:3001"
echo ""
