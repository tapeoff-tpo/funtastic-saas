#!/bin/bash
# 맥미니에서 실행: 워커를 macOS 서비스로 등록
# 로그인 시 자동 시작, 크래시 시 자동 재시작

set -e

PLIST_NAME="com.funtastic.worker.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$PROJECT_DIR/logs"

# node 경로 확인
NODE_PATH=$(which node)
echo "Node.js: $NODE_PATH ($(node --version))"

# 로그 디렉토리 생성
mkdir -p "$LOG_DIR"

# 기존 서비스 중지 (있으면)
launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true

# plist에서 node 경로를 실제 경로로 치환하여 복사
sed "s|/usr/local/bin/node|$NODE_PATH|g" "$PLIST_SRC" \
  | sed "s|/Users/ian/Desktop/funtastic-saas|$PROJECT_DIR|g" \
  > "$PLIST_DST"

# 서비스 등록 & 시작
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo ""
echo "✅ 워커 서비스 등록 완료!"
echo "   로그: $LOG_DIR/worker.log"
echo "   에러: $LOG_DIR/worker-error.log"
echo ""
echo "관리 명령어:"
echo "  상태 확인: launchctl print gui/$(id -u)/$PLIST_NAME"
echo "  중지:      launchctl bootout gui/$(id -u)/$PLIST_NAME"
echo "  재시작:    launchctl kickstart -k gui/$(id -u)/$PLIST_NAME"
