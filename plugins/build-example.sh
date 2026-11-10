#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/example-translate"

cargo build --release --target wasm32-unknown-unknown

# 打包到仓库内的示例 zip（plugin.json + wasm + README.md 位于包根部）。
# 不直接写入应用数据目录：在应用「扩展」面板手动导入该 zip 即可，
# 避免开发脚本把示例插件自动装进用户的翻译服务列表。
if command -v powershell >/dev/null 2>&1; then
  powershell -Command "Compress-Archive -Path plugin.json, target/wasm32-unknown-unknown/release/example_translate.wasm, README.md -DestinationPath ../example-translate.zip -Force"
else
  zip -j ../example-translate.zip plugin.json target/wasm32-unknown-unknown/release/example_translate.wasm README.md
fi
echo "packaged to plugins/example-translate.zip — 在应用「扩展」面板导入该 zip"