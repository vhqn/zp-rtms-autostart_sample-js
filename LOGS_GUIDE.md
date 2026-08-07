# RTMS 日志查看指南

## 快速命令

```bash
# 实时查看 RTMS 日志（最常用）
docker compose logs -f rtms

# 使用监控脚本（高亮关键词）
./watch-rtms.sh

# 查看最近 50 行
docker compose logs rtms --tail=50
```

---

## 按服务查看日志

### RTMS 服务

```bash
# 实时跟踪
docker compose logs -f rtms

# 查看最近的日志
docker compose logs rtms --tail=100

# 查看特定时间
docker compose logs --since 10m rtms    # 最近 10 分钟
docker compose logs --since 1h rtms     # 最近 1 小时
docker compose logs --since 2023-08-06T10:00:00 rtms  # 指定时间点
```

### Backend 服务

```bash
docker compose logs -f backend
docker compose logs backend --tail=50
```

### Frontend 服务

```bash
docker compose logs -f frontend
docker compose logs frontend --tail=50
```

### 所有服务

```bash
docker compose logs -f
```

---

## 按事件类型过滤

### Webhook 事件

```bash
# 查看所有 webhook 事件
docker compose logs rtms | grep -i webhook

# 实时监控 webhook
docker compose logs -f rtms | grep --color=always -i webhook
```

### WebSocket 连接

```bash
# WebSocket 握手和连接
docker compose logs rtms | grep -i "websocket\|ws:"

# 实时监控
docker compose logs -f rtms | grep --color=always -i "websocket\|connection"
```

### 音频处理

```bash
# 音频文件处理
docker compose logs rtms | grep -i "audio\|channel\|wav\|pcm"

# 音频保存事件
docker compose logs rtms | grep -i "saved\|finalized\|mixed"
```

### 转录事件

```bash
# 转录内容
docker compose logs rtms | grep -i "transcript\|transcription"
```

### 错误和警告

```bash
# 错误信息
docker compose logs rtms | grep -i "error\|fail\|exception"

# 警告信息
docker compose logs rtms | grep -i "warn\|warning"
```

### RTMS 状态变化

```bash
# 启动/停止/中断事件
docker compose logs rtms | grep -i "started\|stopped\|interrupted"
```

---

## 查看数据文件

### 音频文件

```bash
# 列出所有音频会话
ls -lh rtms/data/audio/

# 查看最新的音频目录
ls -lt rtms/data/audio/ | head -5

# 查看特定会话的音频文件
ls -lh rtms/data/audio/<session_timestamp>_<callId>/
```

### 转录文件

```bash
# 列出所有转录文件
ls -lh rtms/data/transcripts/

# 查看特定呼叫的转录
cat rtms/data/transcripts/<callId>.txt

# 查看最新的转录
tail -20 rtms/data/transcripts/*.txt
```

---

## 导出日志

### 导出到文件

```bash
# 导出 RTMS 日志
docker compose logs rtms > rtms_logs_$(date +%Y%m%d_%H%M%S).txt

# 导出所有服务日志
docker compose logs > all_logs_$(date +%Y%m%d_%H%M%S).txt

# 导出最近 1 小时的日志
docker compose logs --since 1h rtms > rtms_last_hour.txt
```

### 导出特定事件

```bash
# 导出所有错误
docker compose logs rtms | grep -i error > rtms_errors.txt

# 导出所有 webhook 事件
docker compose logs rtms | grep -i webhook > rtms_webhooks.txt
```

---

## 进入容器查看

```bash
# 进入 RTMS 容器
docker exec -it zoom-phone-rtms sh

# 在容器内执行命令
ls -lh /app/data/audio/
ls -lh /app/data/transcripts/
cat /app/data/transcripts/*.txt
ps aux
netstat -tlnp
exit
```

---

## 调试技巧

### 1. 多窗口监控

在不同终端窗口中：

```bash
# 窗口 1: RTMS 日志
docker compose logs -f rtms

# 窗口 2: Backend 日志
docker compose logs -f backend

# 窗口 3: 健康检查
watch -n 5 'curl -s http://localhost:3001/health'
```

### 2. 查看容器状态

```bash
# 容器运行状态
docker compose ps

# 容器资源使用
docker stats zoom-phone-rtms

# 容器详细信息
docker inspect zoom-phone-rtms
```

### 3. 网络调试

```bash
# 查看容器网络
docker network inspect zp-rtms-autostart_sample-js_zoom-phone-network

# 测试容器间连接
docker exec zoom-phone-backend curl -s http://rtms:8080/health
```

---

## 常见日志模式

### 正常启动

```
Zoom Phone RTMS Server
==================================================
Port: 8080
Audio directory: /app/data/audio
==================================================
Server ready - waiting for Phone RTMS webhooks
```

### Webhook 接收

```
POST /
Received webhook: phone.rtms_started
Call ID: abc123
RTMS Stream ID: xyz789
```

### WebSocket 连接

```
Connecting to signaling WebSocket: wss://...
Signaling WebSocket connected
Received media WebSocket URL
Media WebSocket connected
```

### 音频处理

```
Audio message received (channel 0, 1024 bytes)
Saved channel 0: /app/data/audio/.../channel_0.raw
Finalized WAV: /app/data/audio/.../channel_0.wav
```

### 转录处理

```
Transcript received (speaker: user, text: "Hello")
Saved transcript: /app/data/transcripts/abc123.txt
```

---

## 问题诊断

### 问题 1: 容器不断重启

```bash
# 查看退出原因
docker compose logs rtms --tail=100

# 查看容器状态
docker compose ps
```

### 问题 2: WebSocket 连接失败

```bash
# 查看 WebSocket 日志
docker compose logs rtms | grep -i "websocket\|ws:\|connection"

# 检查网络连接
docker exec zoom-phone-rtms ping -c 3 zoom.us
```

### 问题 3: 音频文件未保存

```bash
# 查看音频处理日志
docker compose logs rtms | grep -i "audio\|channel\|saved"

# 检查目录权限
docker exec zoom-phone-rtms ls -lh /app/data/audio/

# 检查磁盘空间
docker exec zoom-phone-rtms df -h
```

### 问题 4: Webhook 未接收

```bash
# 查看 webhook 日志
docker compose logs backend | grep -i webhook

# 查看 RTMS webhook 处理
docker compose logs rtms | grep -i webhook

# 测试 webhook 端点
curl -X POST http://localhost:3001/api/webhooks/zoom
```

---

## 日志级别配置

如果需要更详细的日志，可以在 `.env` 中配置：

```bash
# 启用详细日志
LOG_FULL_WEBHOOK_PAYLOAD=true
LOG_WEBSOCKET_EVENTS=true
NODE_ENV=development
```

重启服务以应用更改：

```bash
docker compose restart
```

---

## 清理旧日志

```bash
# Docker 会自动管理容器日志，但可以手动清理

# 查看日志文件大小
docker compose logs rtms | wc -l

# 重新创建容器（清空日志）
docker compose down
docker compose up -d

# 清理数据文件
rm -rf rtms/data/audio/*
rm -rf rtms/data/transcripts/*
```

---

## 实用脚本

### 监控脚本

```bash
# 使用提供的监控脚本
./watch-rtms.sh
```

### 自定义监控

```bash
# 监控特定关键词
docker compose logs -f rtms | grep --color=always -E "error|webhook|audio|$"

# 监控多个服务
docker compose logs -f rtms backend | grep --color=always -E "error|webhook|$"
```

---

## 参考资源

- Docker Compose 日志文档: https://docs.docker.com/compose/reference/logs/
- RTMS 主 README: [README.md](README.md)
- 部署指南: [deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md)
