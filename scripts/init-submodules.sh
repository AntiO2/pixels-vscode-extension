#!/usr/bin/env sh
set -eu

git submodule update --init third_party/pixels
git -C third_party/pixels submodule update --init cpp/third-party/protobuf
