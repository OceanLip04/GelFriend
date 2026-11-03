#!/bin/zsh
set -eu
cd -- "${0:A:h}"
TESTDIR=$(mktemp -d /tmp/labscope-analysis-test.XXXXXX)
trap 'rm -rf "$TESTDIR"' EXIT
if [[ ! -d DevTools/node_modules/jsdom ]]; then
  npm ci --prefix DevTools --ignore-scripts --no-audit --no-fund
fi
python3 Tests/make_public_fixture.py "$TESTDIR/synthetic-reference.sgd"
./test.command "$TESTDIR/synthetic-reference.sgd"
node Tests/analysis.test.js
node Tests/skew.test.js
node Tests/workspace.test.js
node Tests/workflow.test.js

node Tests/project-logic.test.js

node Tests/agent.test.js
