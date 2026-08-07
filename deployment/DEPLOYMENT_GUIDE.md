# RTMS 服务部署指南 - 使用 MS Nginx 代理

## 部署架构

```
Zoom Platform
    ↓ HTTPS
https://qa01zccrtmszone7.zoomdev.us:3003
    ↓
10.203.65.98 (nginx: 3003 → 127.0.0.1:9002)
    ↓
Docker Compose (backend:9002 + frontend:3000 + rtms:8080)
```

---

## 前置准备

### 1. 检查可用端口

```bash
ssh 10.203.65.98 "sudo netstat -tlnp | grep -E ':(3003|9002)'"
# 如果无输出，说明端口可用
```

### 2. 准备 SSL 证书

使用现有的证书：
- `/opt/docker/pbxms/zoom_web_api/conf/server.crt`
- `/opt/docker/pbxms/zoom_web_api/conf/server.key`

---

## 部署步骤

### 步骤 1：上传项目到服务器

```bash
# 在本地打包项目
cd /Users/AlexZhang/PBX_REPO
tar -czf zp-rtms-autostart_sample-js.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  zp-rtms-autostart_sample-js/

# 上传到服务器
scp zp-rtms-autostart_sample-js.tar.gz 10.203.65.98:~/

# 在服务器上解压
ssh 10.203.65.98 "tar -xzf zp-rtms-autostart_sample-js.tar.gz"
```

### 步骤 2：配置环境变量

```bash
ssh 10.203.65.98
cd ~/zp-rtms-autostart_sample-js
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# Zoom 应用凭证（从 Marketplace 获取）
ZOOM_APP_CLIENT_ID=your_client_id
ZOOM_APP_CLIENT_SECRET=your_client_secret
ZOOM_SECRET_TOKEN=your_secret_token
SESSION_SECRET=$(openssl rand -hex 32)

# 公网 URL 配置（使用 nginx 代理地址）
PUBLIC_URL=https://qa01zccrtmszone7.zoomdev.us:3003
ZOOM_REDIRECT_URL=https://qa01zccrtmszone7.zoomdev.us:3003/api/auth/callback
FRONTEND_URL=https://qa01zccrtmszone7.zoomdev.us:3003

# 内部服务 URL（保持默认）
FRONTEND_INTERNAL_URL=http://frontend:3000
RTMS_SERVER_URL=http://rtms:8080
BACKEND_URL=http://backend:3001

# 端口配置（保持默认）
PORT=3000
BACKEND_PORT=3001
RTMS_PORT=8080

# Zoom API 配置
ZOOM_HOST=https://zoom.us
ZOOM_API_BASE_URL=https://api.zoom.us/v2
NODE_ENV=production
```

### 步骤 3：配置 nginx 代理

```bash
# 备份现有配置
ssh 10.203.65.98 "sudo cp /opt/docker/pbxms/conf/nginx.conf /opt/docker/pbxms/conf/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)"

# 方案 A：手动编辑（推荐）
ssh 10.203.65.98 "sudo vi /opt/docker/pbxms/conf/nginx.conf"
```

在 `http {}` 块的**末尾**、最后一个 `server {}` 之后添加：

```nginx
# Alex's RTMS Service
server {
    listen 3003 ssl;
    server_name qa01zccrtmszone7.zoomdev.us;
    
    ssl_certificate      ../../zoom_web_api/conf/server.crt;
    ssl_certificate_key  ../../zoom_web_api/conf/server.key;
    ssl_protocols        TLSv1.2;
    ssl_session_cache    shared:SSL:10m;
    ssl_session_timeout  10m;
    ssl_ciphers  'ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers  on;

    location / {
        proxy_pass http://127.0.0.1:9002;
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

**方案 B：自动追加**（需要验证）

```bash
# 将配置追加到 nginx.conf（在最后一个 } 之前）
cat deployment/nginx-rtms-proxy.conf | ssh 10.203.65.98 "sudo tee -a /opt/docker/pbxms/conf/nginx.conf"
```

### 步骤 4：重载 nginx 配置

```bash
# 测试配置是否正确
ssh 10.203.65.98 "sudo docker exec -it docker_pbx_microservice nginx -t"

# 如果测试通过，重载配置
ssh 10.203.65.98 "sudo docker exec -it docker_pbx_microservice nginx -s reload"
```

### 步骤 5：启动 Docker 服务

```bash
ssh 10.203.65.98
cd ~/zp-rtms-autostart_sample-js

# 使用生产配置启动
docker compose -f docker-compose.prod.yml up -d

# 查看日志
docker compose -f docker-compose.prod.yml logs -f
```

---

## 验证部署

### 1. 检查容器状态

```bash
ssh 10.203.65.98 "docker ps | grep zp-rtms"
```

应显示：

```
zp-rtms-backend-alex   Up   127.0.0.1:9002->3001/tcp
zp-rtms-frontend-alex  Up   3000/tcp
zp-rtms-server-alex    Up   8080/tcp
```

### 2. 测试健康检查

```bash
# 测试本地端口
ssh 10.203.65.98 "curl -s http://127.0.0.1:9002/health"
# 应返回: {"status":"ok"}

# 测试 nginx 代理
curl -k https://qa01zccrtmszone7.zoomdev.us:3003/health
# 应返回: {"status":"ok"}
```

### 3. 测试前端访问

在浏览器打开：
- https://qa01zccrtmszone7.zoomdev.us:3003

应显示 RTMS 前端页面。

### 4. 测试 Zoom Webhook

使用 Zoom Marketplace 的 **Event Subscriptions** 测试功能：
- Notification URL: `https://qa01zccrtmszone7.zoomdev.us:3003/api/webhooks/zoom`
- 点击 **Validate**，应显示成功

---

## Zoom Marketplace 配置

### 1. OAuth 配置

- **Redirect URL for OAuth**: `https://qa01zccrtmszone7.zoomdev.us:3003/api/auth/callback`
- **App Home URL**: `https://qa01zccrtmszone7.zoomdev.us:3003`

### 2. Webhook 配置

- **Event notification endpoint URL**: `https://qa01zccrtmszone7.zoomdev.us:3003/api/webhooks/zoom`
- **Event types**:
  - `phone.rtms_started`
  - `phone.rtms_stopped`
  - `phone.rtms_interrupted`

### 3. Scopes

- `phone:read:rtms_session`
- `phone:write:rtms_session`

---

## 故障排查

### 问题 1：nginx 配置测试失败

```bash
# 查看详细错误
ssh 10.203.65.98 "sudo docker exec -it docker_pbx_microservice nginx -t"

# 检查语法错误
ssh 10.203.65.98 "sudo cat /opt/docker/pbxms/conf/nginx.conf | grep -A5 -B5 'listen 3003'"
```

### 问题 2：端口 9002 无法访问

```bash
# 检查容器是否启动
ssh 10.203.65.98 "docker ps | grep zp-rtms-backend"

# 检查端口映射
ssh 10.203.65.98 "docker port zp-rtms-backend-alex"

# 检查防火墙
ssh 10.203.65.98 "sudo netstat -tlnp | grep 9002"
```

### 问题 3：WebSocket 连接失败

检查 nginx 配置是否包含：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400;
```

查看 RTMS 日志：

```bash
ssh 10.203.65.98
cd ~/zp-rtms-autostart_sample-js
docker compose -f docker-compose.prod.yml logs rtms | tail -50
```

### 问题 4：Zoom Webhook 验证失败

1. 检查 `ZOOM_SECRET_TOKEN` 是否正确
2. 查看 backend 日志：

```bash
docker compose -f docker-compose.prod.yml logs backend | grep webhook
```

---

## 维护命令

```bash
# 查看日志
docker compose -f docker-compose.prod.yml logs -f [service_name]

# 重启服务
docker compose -f docker-compose.prod.yml restart

# 停止服务
docker compose -f docker-compose.prod.yml down

# 查看资源使用
docker stats

# 清理旧数据
rm -rf ~/zp-rtms-autostart_sample-js/rtms/data/audio/*
rm -rf ~/zp-rtms-autostart_sample-js/rtms/data/transcripts/*
```

---

## 安全注意事项

1. **不要提交 `.env` 文件到 Git**
   ```bash
   # 确保 .gitignore 包含
   echo ".env" >> .gitignore
   ```

2. **保护音频和转录数据**
   ```bash
   chmod 700 ~/zp-rtms-autostart_sample-js/rtms/data
   ```

3. **定期更新依赖**
   ```bash
   docker compose -f docker-compose.prod.yml build --no-cache
   ```

---

## 端口使用总结

| 服务 | 容器内部端口 | 主机端口 | nginx 代理端口 | 公网访问 |
|------|------------|---------|--------------|---------|
| Backend | 3001 | 127.0.0.1:9002 | 3003 (SSL) | ✅ |
| Frontend | 3000 | - | 通过 backend 代理 | ✅ |
| RTMS | 8080 | - | 通过 backend 代理 | ❌ (内部) |

---

## 参考现有部署

现有 RTMS 服务（Theo 的部署）：
- nginx 端口: 3001
- backend 端口: 9001
- 配置路径: `/opt/docker/pbxms/conf/nginx.conf`
- 容器前缀: `zcc-*`

你的部署：
- nginx 端口: 3003
- backend 端口: 9002
- 配置路径: 同上（追加配置）
- 容器前缀: `zp-rtms-*-alex`
