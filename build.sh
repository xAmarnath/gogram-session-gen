#!/usr/bin/env bash
# Build the two WASM binaries into public/.
# session.wasm  - default tag, drives the session generator UI
# check.wasm    - built with -tags checker, drives the session inspector UI
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Building session.wasm"
GOOS=js GOARCH=wasm go build -o public/session.wasm .

echo "==> Building check.wasm"
GOOS=js GOARCH=wasm go build -tags checker -o public/check.wasm .

ls -la public/session.wasm public/check.wasm
