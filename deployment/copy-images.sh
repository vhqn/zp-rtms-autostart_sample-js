#!/bin/bash
# 从 10.203.65.98 复制 Docker 镜像到 10.203.64.174

set -e

SOURCE_SERVER="10.203.65.98"
TARGET_SERVER="10.203.64.174"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_info "步骤 1/4: 在源服务器导出镜像..."

ssh ${SOURCE_SERVER} << 'EOF'
cd /tmp
echo "导出 RTMS 镜像..."
sudo docker save rtms-zcc-sample-rtms:latest | gzip > rtms.tar.gz

echo "导出 Backend 镜像..."
sudo docker save rtms-zcc-sample-backend:latest | gzip > backend.tar.gz

echo "导出 Frontend 镜像..."
sudo docker save rtms-zcc-sample-frontend:latest | gzip > frontend.tar.gz

ls -lh *.tar.gz
EOF

echo_info "步骤 2/4: 传输镜像到目标服务器..."

echo "传输 RTMS 镜像..."
ssh ${SOURCE_SERVER} "cat /tmp/rtms.tar.gz" | ssh ${TARGET_SERVER} "cat > /tmp/rtms.tar.gz"

echo "传输 Backend 镜像..."
ssh ${SOURCE_SERVER} "cat /tmp/backend.tar.gz" | ssh ${TARGET_SERVER} "cat > /tmp/backend.tar.gz"

echo "传输 Frontend 镜像..."
ssh ${SOURCE_SERVER} "cat /tmp/frontend.tar.gz" | ssh ${TARGET_SERVER} "cat > /tmp/frontend.tar.gz"

echo_info "步骤 3/4: 在目标服务器导入镜像..."

ssh ${TARGET_SERVER} << 'EOF'
cd /tmp

echo "导入 RTMS 镜像..."
docker load < rtms.tar.gz

echo "导入 Backend 镜像..."
docker load < backend.tar.gz

echo "导入 Frontend 镜像..."
docker load < frontend.tar.gz

echo "重新标记镜像..."
docker tag rtms-zcc-sample-rtms:latest zp-rtms-autostart_sample-js-rtms:latest
docker tag rtms-zcc-sample-backend:latest zp-rtms-autostart_sample-js-backend:latest
docker tag rtms-zcc-sample-frontend:latest zp-rtms-autostart_sample-js-frontend:latest

echo "查看导入的镜像:"
docker images | grep zp-rtms-autostart_sample-js
EOF

echo_info "步骤 4/4: 清理临时文件..."

ssh ${SOURCE_SERVER} "rm -f /tmp/{rtms,backend,frontend}.tar.gz"
ssh ${TARGET_SERVER} "rm -f /tmp/{rtms,backend,frontend}.tar.gz"

echo ""
echo_info "镜像复制完成！"
echo ""
echo "现在可以在 174 服务器上启动服务："
echo "  ssh ${TARGET_SERVER}"
echo "  cd ~/zp-rtms-autostart_sample-js"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo ""
