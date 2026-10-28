#!/bin/bash
# KindleForge 一键启动器
# 双击这个文件：如果网站没在跑就先启动，然后自动用浏览器打开。
# 关闭这个终端窗口不会立刻停掉网站；想彻底停止，运行：
#   lsof -ti:3100 | xargs kill

set -u
PROJECT="$HOME/Desktop/daily/kindle"
URL="http://127.0.0.1:3100"

cd "$PROJECT" || {
  echo "找不到项目目录：$PROJECT"
  read -r -p "按回车关闭…" _
  exit 1
}

is_up() {
  curl -s -o /dev/null --max-time 2 "$URL/"
}

if is_up; then
  echo "网站已经在运行：$URL"
  open "$URL"
  exit 0
fi

echo "正在启动 KindleForge…（第一次启动约 3-5 秒）"
nohup npx next start -p 3100 > /tmp/kindleforge.log 2>&1 &

for _ in $(seq 1 40); do
  sleep 0.5
  if is_up; then
    break
  fi
done

if is_up; then
  echo "启动成功：$URL"
  open "$URL"
  osascript -e 'display notification "网站已启动，浏览器马上打开" with title "KindleForge"' >/dev/null 2>&1
else
  echo "启动失败，最近日志如下："
  tail -20 /tmp/kindleforge.log
  echo
  echo "可以手动在终端运行：cd $PROJECT && npx next start -p 3100"
  read -r -p "按回车关闭…" _
  exit 1
fi
