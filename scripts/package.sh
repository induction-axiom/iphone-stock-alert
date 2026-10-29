#!/bin/sh
# Builds dist/iphone-stock-alert.zip: what users load unpacked, and what the Chrome Web Store takes.
set -eu
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
mkdir -p dist
rm -f dist/iphone-stock-alert.zip
(cd extension && zip -qr ../dist/iphone-stock-alert.zip . -x test.js -x icons/icon.svg -x '.*')
echo "dist/iphone-stock-alert.zip (version $version)"
