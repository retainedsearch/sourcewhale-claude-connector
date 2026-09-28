#!/bin/zsh
# Uploads a secret to Cloudflare straight from your clipboard, without ever showing it.
# Mac only. (On Windows, see "Setting secrets on Windows" in README.md.)
#
# Usage, from the project folder:
#   scripts/set-secret-from-clipboard.sh MICROSOFT_CLIENT_SECRET
#   scripts/set-secret-from-clipboard.sh SOURCEWHALE_API_KEY
#
# 1. Run the command. It waits.
# 2. Copy the secret (Entra's copy icon, or copy the key in SourceWhale).
# 3. The script notices, uploads it, and clears your clipboard.
#
# Nothing is pasted into Terminal, so the secret cannot end up on screen or in history.

name="$1"
if [[ "$name" != "MICROSOFT_CLIENT_SECRET" && "$name" != "SOURCEWHALE_API_KEY" ]]; then
  echo "Say which secret: MICROSOFT_CLIENT_SECRET or SOURCEWHALE_API_KEY"
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1

before="$(pbpaste 2>/dev/null)"
echo "Waiting for you to copy the $name (up to 10 minutes)..."

for i in {1..300}; do
  now="$(pbpaste 2>/dev/null)"
  if [[ "$now" != "$before" ]]; then
    ok=false
    # In Entra, the Secret ID looks like a GUID. Microsoft only accepts the Value.
    if [[ "$name" == "MICROSOFT_CLIENT_SECRET" && "$now" =~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' ]]; then
      echo "That looks like the Secret ID. Copy the VALUE column instead. Still waiting..."
    elif [[ "$name" == "MICROSOFT_CLIENT_SECRET" && "$now" =~ '^[A-Za-z0-9~._-]{30,60}$' ]]; then
      ok=true
    elif [[ "$name" == "SOURCEWHALE_API_KEY" && "$now" =~ '^[^[:space:]]{20,200}$' ]]; then
      ok=true
    else
      echo "What you copied does not look like a $name. Still waiting..."
    fi

    if $ok; then
      printf %s "$now" | npx wrangler secret put "$name" 2>&1 | grep -E "Success|rror"
      printf '' | pbcopy
      unset now before
      echo "Clipboard cleared."
      exit 0
    fi
    before="$now"
  fi
  sleep 2
done

echo "Timed out. Run the command again when ready."
exit 1
