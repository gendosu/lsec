#!/usr/bin/env bash
set -euo pipefail

curl https://mise.run | sh

MISE_BIN="$HOME/.local/bin/mise"

if [ -f "$HOME/.bashrc" ] && ! grep -q 'mise activate' "$HOME/.bashrc"; then
  echo 'eval "$('"$MISE_BIN"' activate bash)"' >> "$HOME/.bashrc"
fi
if [ -f "$HOME/.zshrc" ] && ! grep -q 'mise activate' "$HOME/.zshrc"; then
  echo 'eval "$('"$MISE_BIN"' activate zsh)"' >> "$HOME/.zshrc"
fi

"$MISE_BIN" trust
"$MISE_BIN" install

"$MISE_BIN" exec -- corepack enable
CI=true "$MISE_BIN" exec -- pnpm install
