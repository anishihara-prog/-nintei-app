#!/usr/bin/env bash
set -euo pipefail

CLAUDE_JSON_TARGET="$HOME/.claude.json"
CLAUDE_JSON_PERSIST="$HOME/.claude/.claude.json"

# 初回のみ: 既存の .claude.json を永続化ボリューム側へ退避
if [ -f "$CLAUDE_JSON_TARGET" ] && [ ! -L "$CLAUDE_JSON_TARGET" ]; then
  mv "$CLAUDE_JSON_TARGET" "$CLAUDE_JSON_PERSIST"
fi

[ -f "$CLAUDE_JSON_PERSIST" ] || echo '{}' > "$CLAUDE_JSON_PERSIST"

ln -sf "$CLAUDE_JSON_PERSIST" "$CLAUDE_JSON_TARGET"

npm install
npm install -g @anthropic-ai/claude-code
