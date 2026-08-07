# 部署到 10.203.64.174 指南

## 服务器信息

| 项目 | 值 |
|------|-----|
| 主机名 | sl-r3-svr03-vm08.ipa.zoom.us |
| 内网 IP | 10.203.64.174 |
| **公网 IP** | **newqa01mszone7.zoomdev.us** |
| nginx 端口 | 3001 (HTTPS) |
| backend 端口 | 9001 |
| 公网访问地址 | https://newqa01mszone7.zoomdev.us:3001 |

---

## 快速部署

### 方法 1：自动化脚本（推荐）

```bash
cd /Users/AlexZhang/PBX_REPO/zp-rtms-autostart_sample-js

# 1. 配置 .env
cp .env.example .env
vi .env  # 按下面的配置填写

# 2. 运行部署脚本
./deployment/deploy-to-174.sh
```

### 方法 2：手动部署

参考下面的详细步骤。

---

## .env 配置

```bash
# Zoom 凭证
ZOOM_APP_CLIENT_ID=your_client_id
ZOOM_APP_CLIENT_SECRET=your_client_secret
ZOOM_SECRET_TOKEN=your_secret_token
SESSION_SECRET=$(openssl rand -hex 32)

# 公网 URL（使用服务器公网 IP）
PUBLIC_URL=https://newqa01mszone7.zoomdev.us:3001
ZOOM_REDIRECT_URL=https://newqa01mszone7.zoomdev.us:3001/api/auth/callback
FRONTEND_URL=https://newqa01mszone7.zoomdev.us:3001

# 内部服务 URL（保持默认）
FRONTEND_INTERNAL_URL=http://frontend:3000
RTMS_SERVER_URL=http://rtms:8080
BACKEND_URL=http://backend:3001

# 端口配置（保持默认）
PORT=3000
BACKEND_PORT=3001
RTMS_PORT=8080

# Zoom API
ZOOM_HOST=https://zoom.us
ZOOM_API_BASE_URL=https://api.zoom.us/v2
NODE_ENV=production
```

---

## 手动部署步骤

### 1. 准备环境

```bash
# 在本地配置 .env
cd /Users/AlexZhang/PBX_REPO/zp-rtms-autostart_sample-js
cp .env.example .env
vi .env  # 填写上面的配置
```

### 2. 上传项目

```bash
# 打包项目
tar -czf zp-rtms-autostart_sample-js.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  zp-rtms-autostart_sample-js/

# 上传到服务器
scp zp-rtms-autostart_sample-js.tar.gz 10.203.64.174:~/

# 在服务器上解压
ssh 10.203.64.174 "tar -xzf zp-rtms-autostart_sample-js.tar.gz"
```

### 3. 配置 nginx

```bash
# 备份现有配置
ssh 10.203.64.174 "sudo cp /opt/docker/pbxms/conf/nginx.conf /opt/docker/pbxms/conf/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)"

# 编辑配置
ssh 10.203.64.174 "sudo vi /opt/docker/pbxms/conf/nginx.conf"
```

在文件末尾、最后一个 `}` 之前添加：

```nginx
# Alex's RTMS Service
server {
    listen newqa01mszone7.zoomdev.us:3001 ssl;
    server_name sl-r3-svr03-vm08.ipa.zoom.us;

    ssl_certificate      ../../zoom_web_api/conf/server.crt;
    ssl_certificate_key  ../../zoom_web_api/conf/server.key;
    ssl_protocols        TLSv1.2;
    ssl_session_cache    shared:SSL:10m;
    ssl_session_timeout  10m;
    ssl_ciphers  'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers  on;

    location / {
        proxy_pass http://127.0.0.1:9001;
        proxy_http_version 1.1;

        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }
}
```

### 4. 重载 nginx

```bash
# 测试配置
ssh 10.203.64.174 "sudo docker exec docker_pbx_microservice nginx -t"

# 重载配置
ssh 10.203.64.174 "sudo docker exec docker_pbx_microservice nginx -s reload"
```

### 5. 启动 Docker 服务

```bash
ssh 10.203.64.174
cd ~/zp-rtms-autostart_sample-js

# 上传 .env 文件（从本地）
# 或者在服务器上直接创建并编辑

# 启动服务
docker compose -f docker-compose.prod.yml up -d

# 查看日志
docker compose -f docker-compose.prod.yml logs -f
```

---

## 验证部署

### 1. 检查容器状态

```bash
ssh 10.203.64.174
cd ~/zp-rtms-autostart_sample-js
docker compose -f docker-compose.prod.yml ps
```

应显示：

```
NAME                    STATE    PORTS
zp-rtms-backend-alex   Up       127.0.0.1:9001->3001/tcp
zp-rtms-frontend-alex  Up       3000/tcp
zp-rtms-server-alex    Up       8080/tcp
```

### 2. 测试健康检查

```bash
# 测试本地端口
ssh 10.203.64.174 "curl -s http://127.0.0.1:9001/health"

# 测试 nginx 代理
curl -k https://newqa01mszone7.zoomdev.us:3001/health
```

### 3. 测试前端访问

在浏览器打开：
- https://newqa01mszone7.zoomdev.us:3001

---

## Zoom Marketplace 配置

### OAuth 配置

- **Redirect URL**: `https://newqa01mszone7.zoomdev.us:3001/api/auth/callback`
- **App Home URL**: `https://newqa01mszone7.zoomdev.us:3001`

### Webhook 配置

- **Event notification endpoint URL**: `https://newqa01mszone7.zoomdev.us:3001/api/webhooks/zoom`
- **Event types**:
  - `phone.rtms_started`
  - `phone.rtms_stopped`
  - `phone.rtms_interrupted`

### Scopes

- `phone:read:rtms_session`
- `phone:write:rtms_session`

---

## 常用命令

```bash
# SSH 到服务器
ssh 10.203.64.174

# 查看日志
cd ~/zp-rtms-autostart_sample-js
docker compose -f docker-compose.prod.yml logs -f rtms

# 重启服务
docker compose -f docker-compose.prod.yml restart

# 停止服务
docker compose -f docker-compose.prod.yml down

# 查看资源使用
docker stats
```

---

## 故障排查

### 问题 1: 无法访问 https://newqa01mszone7.zoomdev.us:3001

1. 检查防火墙：
   ```bash
   ssh 10.203.64.174 "sudo netstat -tlnp | grep 3001"
   ```

2. 检查 nginx 配置：
   ```bash
   ssh 10.203.64.174 "sudo docker exec docker_pbx_microservice nginx -t"
   ```

### 问题 2: 容器无法启动

查看日志：
```bash
ssh 10.203.64.174
cd ~/zp-rtms-autostart_sample-js
docker compose -f docker-compose.prod.yml logs backend
```

### 问题 3: Zoom Webhook 验证失败

1. 检查 `ZOOM_SECRET_TOKEN` 配置
2. 查看 backend 日志：
   ```bash
   docker compose -f docker-compose.prod.yml logs backend | grep webhook
   ```

---

## 架构图

```
┌─────────────────────────────────────────┐
│ Zoom Platform                            │
│ ↓ HTTPS Webhook/OAuth                   │
│ https://newqa01mszone7.zoomdev.us:3001             │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ 10.203.64.174 (sl-r3-svr03-vm08)        │
│ nginx:3001 (SSL) → 127.0.0.1:9001      │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ Docker Compose                           │
│ ├─ backend:  127.0.0.1:9001 (exposed)  │
│ ├─ frontend: 3000 (internal)           │
│ └─ rtms:     8080 (internal)           │
└─────────────────────────────────────────┘
```

---

## 与本地开发的区别

| 项目 | 本地开发 | 生产部署（174） |
|------|---------|----------------|
| 访问地址 | http://localhost:3001 | https://newqa01mszone7.zoomdev.us:3001 |
| SSL | 无 | nginx SSL |
| backend 端口 | 3001 | 9001 |
| Webhook | ngrok | 直接使用公网 IP |

---

## 参考文件

- nginx 配置模板: [nginx-config-10.203.64.174.conf](nginx-config-10.203.64.174.conf)
- 部署脚本: [deploy-to-174.sh](deploy-to-174.sh)
- 主部署指南: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
