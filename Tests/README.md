# Public test data

`make_fixture.py` creates a tiny SGD with six known pixel values to exercise CFB mini streams. `make_public_fixture.py` creates a deterministic 1392×1040 SGD with artificial lanes/bands to exercise normal streams. Both use only Python's standard library and generate data in temporary directories. No biological sample, image or instrument capture is needed.

`test-analysis.command` uses the synthetic reference. `Verify.swift` checks its complete pixel array against an independent Swift calculation, then tests TIFF/PNG round trips and other operations. An existing optional branch for a developer's local retained reference remains in the verification code, but the reference pixels, reconstruction utility, UI input files and inspection outputs are excluded from this repository.

`agent-integration.py` generates its own synthetic SGD. It requires an isolated, running test application with Agent enabled and may replace its document. It is intentionally excluded from the ordinary automated test command.

Historical verification documents describe local tests performed before publication; those real-pixel reference fixtures are not distributed here.
