#!/bin/sh
# Serve the dev app to a phone on the same Wi-Fi network: the web app on the
# Mac's network address, calling the API there, which allows that origin.
# Usage: dev-phone.sh "<command that starts the API>"
set -e

ip=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)
if [ -z "$ip" ]; then
  echo "No Wi-Fi address found: is this Mac on a network?" >&2
  exit 1
fi

export VITE_API_URL="http://$ip:3001/trpc"
export CORS_ORIGIN="http://$ip:5173"

echo "On the phone, open http://$ip:5173"
exec pnpm exec concurrently "$1" "pnpm dev:web --host"
