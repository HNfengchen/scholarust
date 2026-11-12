#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/image-import"

cargo build --release --target wasm32-unknown-unknown

# 打包到仓库内的 zip（plugin.json + wasm + README.md 位于包根部）。
# 在应用「扩展」面板手动导入该 zip 即可。
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp plugin.json README.md target/wasm32-unknown-unknown/release/image_import.wasm "$stage"
if command -v powershell >/dev/null 2>&1; then
  powershell -Command "Compress-Archive -Path '$stage/*' -DestinationPath '$(pwd)/../image-import.zip' -Force"
else
  (cd "$stage" && zip -j "$(pwd)/../image-import.zip" plugin.json image_import.wasm README.md)
fi
echo "packaged to plugins/image-import.zip — 在应用「扩展」面板导入该 zip"
