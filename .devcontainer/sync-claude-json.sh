#!/usr/bin/env bash
# ~/.claude.json はClaude Codeが保存のたびに一時ファイル→renameで書き込むため、
# postCreate.sh で張ったシンボリンクが実体ファイルに置き換わってしまうことがある。
# そうなると以降の書き込みが永続化ボリューム外（コンテナのエフェメラル層）に行き、
# リビルド時に履歴インデックスが失われる。これを常駐監視して直す。
set -euo pipefail

PIDFILE="$HOME/.claude/.sync-claude-json.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ > "$PIDFILE"

CLAUDE_JSON_TARGET="$HOME/.claude.json"
CLAUDE_JSON_PERSIST="$HOME/.claude/.claude.json"

while true; do
  if [ -e "$CLAUDE_JSON_TARGET" ] && [ ! -L "$CLAUDE_JSON_TARGET" ]; then
    cp -f "$CLAUDE_JSON_TARGET" "$CLAUDE_JSON_PERSIST"
    ln -sf "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON_TARGET"
  fi
  sleep 3
done
