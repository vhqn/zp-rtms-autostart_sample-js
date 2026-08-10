# 67 机器 RTMS 服务运维手册

> 本文中的“67 机器”固定指 **10.203.64.67**。以后提到“去 67 机器部署/查看 RTMS”，默认使用本文的目录、Compose 文件和容器名。

## 基本信息

| 项目 | 值 |
| --- | --- |
| SSH | `ssh alex.zhang@10.203.64.67`（当前 SSH 配置下可简写为 `ssh 10.203.64.67`） |
| 远端项目目录 | `/home/alex.zhang/zp-rtms-autostart_sample-js` |
| 本地项目目录 | `/Users/AlexZhang/PBX_REPO/zp-rtms-autostart_sample-js` |
| 生产 Compose 文件 | `docker-compose.prod.yml` |
| Compose 项目容器 | `zp-rtms-backend-alex`、`zp-rtms-frontend-alex`、`zp-rtms-server-alex` |
| backend 宿主机端口 | `127.0.0.1:9002` |
| RTMS 音频目录（宿主机） | `rtms/data/audio/` |
| RTMS 音频目录（容器） | `/app/data/audio/` |

RTMS 源码和数据以 volume 挂载进入容器：远端 `rtms/` 对应容器 `/app`，远端 `rtms/data/` 对应容器 `/app/data`。上传 `.js` 源码后，`nodemon` 通常会自动重载；涉及 Dockerfile 或 npm 依赖时必须重建镜像。

## 登录与状态检查

```bash
ssh 10.203.64.67
cd /home/alex.zhang/zp-rtms-autostart_sample-js

# 此机器的 Docker client 比 daemon 新，所有 Docker 命令都指定兼容 API 版本
sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml ps

# RTMS 服务健康检查（backend 对外暴露在本机 9002）
curl -fsS http://127.0.0.1:9002/health
```

预期 RTMS 容器名为 `zp-rtms-server-alex`，状态为 `Up`。

## 查看日志

```bash
ssh -t 10.203.64.67 \
  'cd /home/alex.zhang/zp-rtms-autostart_sample-js && \
   sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml logs -f --tail=200 rtms'
```

常用过滤：

```bash
# 查最近一次录音的收尾、WAV 生成及错误
ssh -t 10.203.64.67 \
  'sudo DOCKER_API_VERSION=1.43 docker logs --tail=500 zp-rtms-server-alex 2>&1 | \
   grep -E "Phone RTMS .*stop_reason|Finalized channel|Interleaved|Recording saved|Failed|ffmpeg"'

# backend webhook/OAuth 日志
ssh -t 10.203.64.67 \
  'cd /home/alex.zhang/zp-rtms-autostart_sample-js && \
   sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml logs -f --tail=200 backend'
```

`WebSocket closed (code=1000, ...)` 表示正常关闭。`ffmpeg was not found; wrote WAV header directly` 表示程序已使用 WAV Header 兜底生成单通道 WAV，不是录音失败。

## 上传代码

从本地仓库根目录执行。不要上传本地 `.env` 或 `rtms/data/` 中的录音。

```bash
cd /Users/AlexZhang/PBX_REPO/zp-rtms-autostart_sample-js

# 上传单个 RTMS 文件（推荐用于小改动）
scp rtms/audioHelper.js \
  alex.zhang@10.203.64.67:/home/alex.zhang/zp-rtms-autostart_sample-js/rtms/audioHelper.js

# 上传其他文件时保持相同的相对路径，例如：
scp rtms/server.js \
  alex.zhang@10.203.64.67:/home/alex.zhang/zp-rtms-autostart_sample-js/rtms/server.js
```

需要批量同步源码时，使用不带 `--delete` 的 rsync，避免误删远端的 `.env`、数据或用户改动：

```bash
rsync -az \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'rtms/data' \
  /Users/AlexZhang/PBX_REPO/zp-rtms-autostart_sample-js/ \
  alex.zhang@10.203.64.67:/home/alex.zhang/zp-rtms-autostart_sample-js/
```

## 部署与重启

### 仅改动已挂载的源码

上传后先观察 RTMS 日志中的 `nodemon restarting due to changes`。为了确保新代码已加载，可重启 RTMS 服务：

```bash
ssh -t 10.203.64.67 \
  'cd /home/alex.zhang/zp-rtms-autostart_sample-js && \
   sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml restart rtms'
```

### 改动 Dockerfile 或依赖

```bash
ssh -t 10.203.64.67 \
  'cd /home/alex.zhang/zp-rtms-autostart_sample-js && \
   sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml up -d --build rtms'
```

截至 2026-08-10，该机器构建时无法连接 `deb.debian.org`，所以 `apt-get install ffmpeg` 的镜像重建会失败。恢复外网/软件源访问后，重新执行上面的构建命令即可。当前 `rtms/audioHelper.js` 已有无 ffmpeg 的 PCM-to-WAV 兜底，不影响单通道 WAV 生成。

## 录音文件与验证

```bash
ssh 10.203.64.67 \
  'find /home/alex.zhang/zp-rtms-autostart_sample-js/rtms/data/audio \
   -maxdepth 2 -type f -printf "%p %s bytes\\n" | tail -30'
```

每通通话的目录中应包含：

- `channel_<channel_id>.raw`：16 kHz、16-bit、单声道 PCM 原始数据，无 WAV 文件头。
- `channel_<channel_id>.wav`：单通道可播放 WAV。
- `mixed.wav`：双通道时为交错立体声 WAV。

检查容器内是否真正有 ffmpeg：

```bash
ssh -t 10.203.64.67 \
  'sudo DOCKER_API_VERSION=1.43 docker exec zp-rtms-server-alex ffmpeg -version'
```

若命令显示找不到 `ffmpeg`，系统会自动生成 WAV；无需因此阻断录音。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `client version 1.53 is too new` | 在 Docker 命令前使用 `DOCKER_API_VERSION=1.43`。 |
| Docker socket permission denied | 使用 `sudo` 执行 Docker 命令。 |
| `spawn ffmpeg ENOENT` | 当前代码会自动兜底生成 WAV；长期方案是恢复软件源后重建 RTMS 镜像。 |
| 一路 channel WAV 静音 | 先比对 `mixed.wav` 的左右声道；这通常是 RTMS 上游该 `channel_id` 本身无有效音频，不是 raw/WAV 转换故障。 |
| 需要完整服务重启 | `sudo DOCKER_API_VERSION=1.43 docker compose -f docker-compose.prod.yml restart`。 |

## 安全约束

- `.env` 含 Zoom 凭证，不上传、不复制到聊天记录、不提交 Git。
- `rtms/data/audio/` 可能含通话录音；同步/清理前先确认精确会话目录。
- 批量同步不使用 `rsync --delete`，避免删除远端录音和部署配置。
