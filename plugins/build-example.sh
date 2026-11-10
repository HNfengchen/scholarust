#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/example-translate"

cargo build --release --target wasm32-unknown-unknown

PLUGIN_DIR="${APPDATA}/com.scholarust.app/plugins/example-translate"
mkdir -p "$PLUGIN_DIR"
cp target/wasm32-unknown-unknown/release/example_translate.wasm "$PLUGIN_DIR/"
cp plugin.json "$PLUGIN_DIR/"
echo "installed to $PLUGIN_DIR"