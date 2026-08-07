# Deployment Files

这个目录包含使用 MS 服务器上的 nginx 代理部署 RTMS 服务的所有配置文件和脚本。

## 文件列表

| 文件 | 用途 |
|------|------|
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | 📖 完整的部署指南（手动步骤） |
| [deploy.sh](deploy.sh) | 🚀 自动化部署脚本 |
| [verify.sh](verify.sh) | ✅ 部署验证脚本 |
| [nginx-rtms-proxy.conf](nginx-rtms-proxy.conf) | ⚙️ nginx 代理配置模板 |

## 快速开始

### 方法 1：自动化部署（推荐）

```bash
# 1. 配置环境变量
cp .env.example .env
vi .env  # 填写 Zoom 凭证

# 2. 运行部署脚本
./deployment/deploy.sh

# 3. 验证部署
./deployment/verify.sh
```

### 方法 2：手动部署

参考 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) 中的详细步骤。

## 部署架构

```
┌─────────────────────────────────────────────┐
│ Zoom Platform                                │
│ ↓ HTTPS Webhook/OAuth                       │
│ https://qa01zccrtmszone7.zoomdev.us:3003    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 10.203.65.98 (MS Server)                     │
│ nginx:3003 (SSL) → 127.0.0.1:9002           │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ Docker Compose                               │
│ ├─ backend:  127.0.0.1:9002 (exposed)       │
│ ├─ frontend: 3000 (internal)                │
│ └─ rtms:     8080 (internal)                │
└─────────────────────────────────────────────┘
```

## 端口分配

| 组件 | 端口 | 访问方式 |
|------|------|---------|
| nginx (SSL) | 3003 | 公网 HTTPS |
| backend | 9002 | nginx 代理 |
| frontend | 3000 | 通过 backend |
| rtms | 8080 | 通过 backend |

## 关键配置

### 环境变量 (.env)

```bash
# Zoom 凭证
ZOOM_APP_CLIENT_ID=<从 Marketplace 获取>
ZOOM_APP_CLIENT_SECRET=<从 Marketplace 获取>
ZOOM_SECRET_TOKEN=<从 Marketplace 获取>

# 公网 URL
PUBLIC_URL=https://qa01zccrtmszone7.zoomdev.us:3003
ZOOM_REDIRECT_URL=https://qa01zccrtmszone7.zoomdev.us:3003/api/auth/callback
FRONTEND_URL=https://qa01zccrtmszone7.zoomdev.us:3003
```

### Zoom Marketplace 配置

- **OAuth Redirect URL**: `https://qa01zccrtmszone7.zoomdev.us:3003/api/auth/callback`
- **Webhook URL**: `https://qa01zccrtmszone7.zoomdev.us:3003/api/webhooks/zoom`
- **App Home URL**: `https://qa01zccrtmszone7.zoomdev.us:3003`

## 常用命令

```bash
# 查看服务状态
ssh 10.203.65.98 "cd ~/zp-rtms-autostart_sample-js && docker compose -f docker-compose.prod.yml ps"

# 查看日志
ssh 10.203.65.98 "cd ~/zp-rtms-autostart_sample-js && docker compose -f docker-compose.prod.yml logs -f"

# 重启服务
ssh 10.203.65.98 "cd ~/zp-rtms-autostart_sample-js && docker compose -f docker-compose.prod.yml restart"

# 停止服务
ssh 10.203.65.98 "cd ~/zp-rtms-autostart_sample-js && docker compose -f docker-compose.prod.yml down"

# 更新代码并重新部署
./deployment/deploy.sh
```

## 故障排查

### 1. 容器无法启动

```bash
# 查看容器日志
ssh 10.203.65.98
cd ~/zp-rtms-autostart_sample-js
docker compose -f docker-compose.prod.yml logs backend
```

### 2. nginx 代理不工作

```bash
# 测试 nginx 配置
ssh 10.203.65.98 "sudo docker exec docker_pbx_microservice nginx -t"

# 查看 nginx 错误日志
ssh 10.203.65.98 "sudo docker exec docker_pbx_microservice cat /opt/docker/pbxms/logs/error.log | tail -50"
```

### 3. Zoom Webhook 验证失败

1. 检查 `ZOOM_SECRET_TOKEN` 是否正确
2. 查看 backend webhook 日志：
   ```bash
   docker compose -f docker-compose.prod.yml logs backend | grep webhook
   ```

### 4. WebSocket 连接失败

确保 nginx 配置包含 WebSocket 支持：
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

## 安全注意事项

1. **不要提交 `.env` 到 Git**
2. **保护音频数据**: `chmod 700 rtms/data/`
3. **定期更新依赖**: `docker compose build --no-cache`
4. **使用强密码**: `SESSION_SECRET` 应使用随机生成的强密码

## 参考资源

- 主 README: [../README.md](../README.md)
- 现有部署: `/home/theo.xie/RTMS-ZCC-Sample` (10.203.65.98)
- nginx 配置: `/opt/docker/pbxms/conf/nginx.conf`
- Zoom RTMS 文档: [Zoom Developer Docs](https://developers.zoom.us/)

## 支持

如有问题，请查看：
1. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) 中的故障排查部分
2. 运行 `./deployment/verify.sh` 进行诊断
3. 查看容器日志
