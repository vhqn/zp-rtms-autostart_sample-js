#!/bin/bash
# RTMS 日志实时监控脚本
# 用法: ./watch-rtms.sh

echo "========================================="
echo "RTMS 服务实时监控"
echo "========================================="
echo ""
echo "按 Ctrl+C 退出"
echo ""

# 实时跟踪 RTMS 日志，并高亮关键词
docker compose logs -f rtms | grep --color=always -E "webhook|WebSocket|audio|transcript|error|ERROR|WARN|started|stopped|interrupted|$"
