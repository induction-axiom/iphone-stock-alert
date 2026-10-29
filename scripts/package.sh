#!/bin/sh
# Builds dist/pickup-alert-for-iphone.zip: what users load unpacked, and what the Chrome Web Store takes.
set -eu
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
mkdir -p dist
rm -f dist/pickup-alert-for-iphone.zip
(cd extension && zip -qr ../dist/pickup-alert-for-iphone.zip . -x test.js -x icons/icon.svg -x '.*')
echo "dist/pickup-alert-for-iphone.zip (version $version)"
