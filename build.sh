#!/usr/bin/env bash
# Build the two WASM binaries into public/ and precompress with brotli.
# session.wasm / session.wasm.br - session generator UI
# check.wasm   / check.wasm.br   - session inspector UI (built with -tags checker)
#
# -s -w strips DWARF + symbol table (~30% smaller with no runtime hit).
# brotli -q 11 compresses maximally; the browser decodes with zero fuss
# once Vercel serves the .br variant behind Content-Encoding: br.
set -euo pipefail

cd "$(dirname "$0")"

LDFLAGS="-s -w"

echo "==> Building session.wasm"
GOOS=js GOARCH=wasm go build -ldflags "$LDFLAGS" -o public/session.wasm .

echo "==> Building check.wasm"
GOOS=js GOARCH=wasm go build -tags checker -ldflags "$LDFLAGS" -o public/check.wasm .

echo "==> Brotli-compressing"
brotli -f -q 11 public/session.wasm -o public/session.wasm.br
brotli -f -q 11 public/check.wasm   -o public/check.wasm.br

ls -la public/session.wasm public/session.wasm.br public/check.wasm public/check.wasm.br
