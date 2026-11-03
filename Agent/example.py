#!/usr/bin/env python3
"""Small optional stdlib client: open, export a display PNG, save a new project.

The app and its local Agent interface must already be running. No analysis
standards or lane geometry are inferred. Existing output files are not replaced.
"""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', required=True, help='Absolute path to bundled gelfriend-agent')
    parser.add_argument('--input', required=True, help='SGD/TIFF/PNG/gelproject path')
    parser.add_argument('--experiment', choices=['dna', 'protein', 'western', 'colony', 'spots'])
    parser.add_argument('--output-dir', required=True, help='Existing directory; writes agent-preview.png and agent-copy.gelproject')
    args = parser.parse_args()
    cli = str(Path(args.cli).resolve())
    output = Path(args.output_dir).resolve()
    if not output.is_dir():
        parser.error('--output-dir must already exist')

    def call(method, params=None):
        response = subprocess.run([cli, 'call', method, json.dumps(params or {})],
                                  capture_output=True, text=True, timeout=100)
        reply = json.loads(response.stdout)
        if 'error' in reply:
            raise RuntimeError(json.dumps(reply['error'], ensure_ascii=False))
        return reply['result']

    def write(method, params):
        state = call('workspace.state')
        return call(method, dict(params, expectedDocumentId=state['documentId'],
                                 expectedRevision=state['revision']))

    params = {'path': str(Path(args.input).resolve())}
    if args.experiment:
        params['experiment'] = args.experiment
    # No discardChanges: an unsaved current project is intentionally preserved.
    write('document.open', params)
    image = write('document.exportImage', {'path': str(output / 'agent-preview.png'), 'annotated': False})
    project = write('document.save', {'path': str(output / 'agent-copy.gelproject')})
    print(json.dumps({'image': image, 'project': project}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
