#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if [[ $# -gt 1 ]]; then
    echo '用法：./test.command [可选：原始或参考 SGD 路径]'
    exit 1
fi
TESTDIR=$(mktemp -d /tmp/sgd-viewer-test.XXXXXX)
trap 'rm -rf "$TESTDIR"' EXIT
python3 Tests/make_fixture.py "$TESTDIR/fixture.sgd"
swiftc -O -swift-version 5 -parse-as-library Sources/CompoundFile.swift Sources/GelImage.swift Sources/BatchProcessor.swift Tests/Verify.swift -o "$TESTDIR/verify"
"$TESTDIR/verify" "$TESTDIR/fixture.sgd" "$@"
