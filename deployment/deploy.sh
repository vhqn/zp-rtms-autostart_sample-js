#!/bin/bash
# RTMS 服务部署脚本
# 用法: ./deployment/deploy.sh

set -e  # 出错时退出

# 配置变量
SERVER="10.203.65.98"
REMOTE_DIR="~/zp-rtms-autostart_sample-js"
PROJECT_NAME="zp-rtms-autostart_sample-js"
NGINX_CONF="/opt/docker/pbxms/conf/nginx.conf"
NGINX_CONTAINER="docker_pbx_microservice"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

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
echo_info "步骤 1/7: 检查本地环境..."

if [ ! -f ".env" ]; then
    echo_error ".env 文件不存在，请先配置环境变量"
    echo "运行: cp .env.example .env"
    exit 1
fi

if ! grep -q "ZOOM_APP_CLIENT_ID" .env || grep -q "your_client_id" .env; then
    echo_error ".env 文件未配置完整，请填写 Zoom 凭证"
    exit 1
fi

echo_info "本地环境检查通过"

# 步骤 2: 打包项目
echo_info "步骤 2/7: 打包项目..."

cd ..
tar -czf ${PROJECT_NAME}.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude='rtms/data/audio/*' \
    --exclude='rtms/data/transcripts/*' \
    ${PROJECT_NAME}/

echo_info "项目打包完成: ${PROJECT_NAME}.tar.gz"

# 步骤 3: 上传到服务器
echo_info "步骤 3/7: 上传到服务器 ${SERVER}..."

scp ${PROJECT_NAME}.tar.gz ${SERVER}:~/
rm -f ${PROJECT_NAME}.tar.gz

echo_info "上传完成"

# 步骤 4: 在服务器上解压
echo_info "步骤 4/7: 在服务器上解压并配置..."

ssh ${SERVER} << 'ENDSSH'
set -e

# 解压项目
if [ -d ~/zp-rtms-autostart_sample-js ]; then
    echo "备份现有部署..."
    mv ~/zp-rtms-autostart_sample-js ~/zp-rtms-autostart_sample-js.backup.$(date +%Y%m%d_%H%M%S)
fi

tar -xzf ~/zp-rtms-autostart_sample-js.tar.gz
rm -f ~/zp-rtms-autostart_sample-js.tar.gz

echo "项目解压完成"
ENDSSH

# 步骤 5: 上传 .env 文件
echo_info "步骤 5/7: 上传配置文件..."

cd ${PROJECT_NAME}
scp .env ${SERVER}:${REMOTE_DIR}/

echo_info "配置文件上传完成"

# 步骤 6: 检查 nginx 配置
echo_info "步骤 6/7: 检查 nginx 配置..."

echo_warn "请确认以下配置已添加到 ${NGINX_CONF}:"
echo ""
cat deployment/nginx-rtms-proxy.conf
echo ""

read -p "是否已添加 nginx 配置？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo_warn "请手动添加配置到 nginx.conf，然后重新运行此脚本"
    echo "参考文件: deployment/nginx-rtms-proxy.conf"
    exit 1
fi

# 测试 nginx 配置
echo_info "测试 nginx 配置..."
ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -t"

# 重载 nginx
echo_info "重载 nginx 配置..."
ssh ${SERVER} "sudo docker exec ${NGINX_CONTAINER} nginx -s reload"

echo_info "nginx 配置更新完成"

# 步骤 7: 启动 Docker 服务
echo_info "步骤 7/7: 启动 Docker 服务..."

ssh ${SERVER} << 'ENDSSH'
set -e

cd ~/zp-rtms-autostart_sample-js

# 停止旧容器（如果存在）
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# 构建并启动
echo "构建 Docker 镜像（可能需要几分钟）..."
docker compose -f docker-compose.prod.yml build

echo "启动服务..."
docker compose -f docker-compose.prod.yml up -d

# 等待服务启动
echo "等待服务启动..."
sleep 10

# 检查容器状态
echo ""
echo "容器状态:"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "检查健康状态..."
for i in {1..10}; do
    if curl -s http://127.0.0.1:9002/health | grep -q "ok"; then
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
echo "  前端: https://qa01zccrtmszone7.zoomdev.us:3003"
echo "  健康检查: https://qa01zccrtmszone7.zoomdev.us:3003/health"
echo ""
echo "查看日志:"
echo "  ssh ${SERVER}"
echo "  cd ${REMOTE_DIR}"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "验证 Zoom Webhook:"
echo "  URL: https://qa01zccrtmszone7.zoomdev.us:3003/api/webhooks/zoom"
echo ""
