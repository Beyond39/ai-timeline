"""Read-only heuristic release scan. Reports locations/rule names, NEVER values.

Usage: python tools/audit-public-source.py [--output tmp/public-audit.json]
Not a proof of absence; binary media and semantic privacy require human review.
"""
import argparse
import io
import json
import os
import re
import subprocess
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = {
    'provider-key': rb'\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b',
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'jwt': rb'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b',
    'credential-url': rb'https?://[^\s/:@]+:[^\s/@]+@[^\s/]+',
    'literal-secret-candidate': rb'''(?i)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|cookie|authorization)\s*["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']''',
    'email-candidate': rb'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
    'chat-url-candidate': rb'https://(?:chatgpt\.com|chat\.openai\.com)/(?:c|share)/[A-Za-z0-9_-]{8,}',
}
PATTERNS = {name: re.compile(pattern) for name, pattern in RULES.items()}
findings = []
counts = Counter()
skipped = Counter()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def scan(data, location, scope):
    if data.startswith((b'%PDF-', b'\x89PNG', b'\xff\xd8\xff', b'PK\x03\x04', b'\x00asm')) or b'\x00' in data[:8192]:
        skipped[scope + ':binary'] += 1
        return
    counts[scope] += 1
    for rule, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            findings.append({'scope': scope, 'location': location,
                             'line': data.count(b'\n', 0, match.start()) + 1, 'rule': rule})

def scan_zip(data, location, depth=0):
    if depth > 1:
        skipped['nested-archive-depth'] += 1
        return
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                if item.file_size > 100_000_000:
                    skipped['archive-entry-size'] += 1
                    continue
                body = archive.read(item)
                name = location + '::' + item.filename
                if item.filename.lower().endswith('.zip'):
                    scan_zip(body, name, depth + 1)
                else:
                    scan(body, name, 'archive')
    except (zipfile.BadZipFile, RuntimeError):
        skipped['unreadable-archive'] += 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='tmp/public-audit.json')
    args = parser.parse_args()
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '__pycache__', '.venv', '.pytest_cache'}
                   and not d.endswith('-profile') and '-profile-' not in d]
        for name in names:
            file = Path(base) / name
            relative = file.relative_to(ROOT).as_posix()
            if relative.startswith(('tmp/', 'apps/navigator-extension/dist/', 'dist/')):
                skipped['generated-output'] += 1
                continue
            if file.stat().st_size > 300_000_000:
                skipped['file-size'] += 1
                continue
            data = file.read_bytes()
            if name.lower().endswith('.zip'):
                scan_zip(data, relative)
            else:
                scan(data, relative, 'working-tree')
    objects = git('rev-list', '--objects', '--all', '--reflog').splitlines()
    for entry in objects:
        parts = entry.split(b' ', 1)
        oid = parts[0].decode('ascii')
        if git('cat-file', '-t', oid).strip() != b'blob':
            continue
        label = parts[1].decode('utf-8', 'replace') if len(parts) > 1 else '[unnamed blob]'
        data = git('cat-file', 'blob', oid)
        if label.lower().endswith('.zip'):
            scan_zip(data, 'git:' + oid[:12] + ':' + label)
        else:
            scan(data, oid[:12] + ':' + label, 'git-history')
    report = {'scope': 'Working files (including ignored data/output), root ZIP contents, all refs and reflog-reachable Git blobs. No network or credential validation.',
              'limitations': 'Heuristic candidates only; no OCR/PDF text extraction, encrypted-archive inspection, arbitrary binary parsing or unreachable-object guarantee. Generated dist/tmp and browser profiles excluded.',
              'counts': dict(counts), 'skipped': dict(skipped), 'findings': findings}
    out = ROOT / args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'scanned': dict(counts), 'candidate_counts': dict(Counter(f['scope'] + ':' + f['rule'] for f in findings)),
                      'report': args.output}, ensure_ascii=False))

if __name__ == '__main__':
    main()
