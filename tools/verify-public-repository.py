"""Check the source index and publishable main history without printing secrets."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args, input=None):
    return subprocess.check_output(['git', *args], cwd=ROOT, input=input)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--index', action='store_true')
    args = parser.parse_args()
    raw = git('ls-files', '--stage', '-z') if args.index else git('ls-tree', '-r', '-z', args.ref)
    entries = [entry.split(b'\t', 1) for entry in raw.split(b'\0') if entry]
    paths = {p.decode('utf8') for _, p in entries}
    forbidden = re.compile(r'^(?:data|dist|output|tmp|apps/navigator-site|apps/navigator-extension/(?:dist|validation/search-baseline))(?:/|$)|(?:^|/)(?:node_modules|__pycache__)(?:/|$)|(?:^|/)\.env(?:$|\.(?!example$))|\.(?:sqlite(?:-wal|-shm)?|sqlite3|pyc|pem|pfx|crx|zip)$')
    violations = sorted(p for p in paths if forbidden.search(p) or p.endswith('performance-v03-fixture.json'))
    assert not violations, f'Private/generated files tracked: {violations}'
    assert not any(meta.startswith(b'160000') for meta, _ in entries), 'Unexpected Gitlink'
    prefix = 'apps/navigator-extension/'
    for name in ['manifest.json', 'package.json', 'background.js', 'workspace.html', 'sidepanel.html',
                 'scripts/build.mjs', 'scripts/validate-all.mjs', 'scripts/verify-package.mjs',
                 'LICENSE', 'vendor/bge/ort-wasm-simd.wasm', 'vendor/bge/ort-wasm.wasm',
                 'vendor/bge/LICENSE-transformers', 'vendor/bge/LICENSE-onnxruntime', 'vendor/katex/LICENSE']:
        assert prefix + name in paths, f'Missing required source: {name}'
    for directory in ['adapters', 'analysis', 'domain', 'exports', 'importers', 'storage', 'ui', 'icons', 'validation']:
        assert any(p.startswith(prefix + directory + '/') for p in paths), f'Missing directory: {directory}'
    history = git('rev-list', '--objects', args.ref)
    assert b'performance-v03-fixture.json' not in history, 'Large fixture in publishable history'
    ids = b'\n'.join(row.split(b' ', 1)[0] for row in history.splitlines()) + b'\n'
    sizes = git('cat-file', '--batch-check=%(objecttype) %(objectsize)', input=ids)
    assert not any(int(row.split()[1]) >= 100 * 1024 * 1024 for row in sizes.splitlines() if row.startswith(b'blob ')), '100 MiB blob in publishable history'
    probes = ['data/example.sqlite', 'dist/example.zip', 'output/private.json', 'tmp/private.txt',
              prefix + 'dist/manifest.json', prefix + 'validation/performance-v03-fixture.json']
    ignored = subprocess.run(['git', 'check-ignore', '--no-index', '--stdin'], cwd=ROOT,
                             input=('\n'.join(probes) + '\n').encode('utf8'), capture_output=True)
    assert set(ignored.stdout.decode('utf8').splitlines()) == set(probes), 'Expected ignore rule missing'
    print(json.dumps({'passed': True, 'scope': 'index' if args.index else args.ref,
                      'files': len(paths), 'extensionFiles': sum(p.startswith(prefix) for p in paths),
                      'historyChecked': args.ref, 'largeFixtureInHistory': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
