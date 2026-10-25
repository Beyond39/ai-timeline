"""Package only allowlisted built runtime, local proxy and aggregate reports.

Run from any directory after the extension build and package verification.
Never walks private browser profiles, attachments, databases or .env files.
"""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
extension = root / "apps" / "navigator-extension"
built = extension / "dist" / "ai-conversation-visual-navigator"
report = json.loads((extension / "dist" / "PACKAGE_CHECK_REPORT.json").read_text(encoding="utf-8"))
if not report.get("passed"):
    raise SystemExit("Package verification must pass first")
manifest = json.loads((built / "manifest.json").read_text(encoding="utf-8"))
if manifest["version"] != report["version"]:
    raise SystemExit("Verified build version mismatch")
regressions = []
for name in ["OPC_NODE_REPORT.json", "HYBRID_BROWSER_REPORT.json", "P0_SECOND_PROJECT_AFTER.json", "PROJECT_LIFECYCLE_DIAGNOSTIC.json", "TIMELINE_PROJECT_BROWSER_REPORT.json"]:
    data = json.loads((extension / "dist" / name).read_text(encoding="utf-8"))
    if data.get("ok") is not True:
        raise SystemExit("Required test report not passing: " + name)
    cases = data.get("checks", data.get("suites", []))
    regressions.append({"report": name, "scope": data.get("scope", ""), "passed": True, "cases": [{"name": c.get("name", c.get("suite")), "passed": c.get("passed")} for c in cases]})
destination = root / "dist" / "opc-timeline-rc1"
destination.mkdir(parents=True, exist_ok=True)
archive = destination / "OPC-Timeline-V1.0-RC1.zip"
files = [(p, "apps/navigator-extension/" + p.relative_to(built).as_posix()) for p in built.rglob("*") if p.is_file()]
files += [(root / "tools" / "opc-ai-proxy.mjs", "tools/opc-ai-proxy.mjs")]
files += [(root / "LICENSE", "LICENSE")]
files += [(built / "docs" / "HYBRID_RC_GUIDE.zh-CN.md", "START-HERE.zh-CN.md")]
for name in ["OPC_NODE_REPORT.json", "HYBRID_QUALITY.json", "HYBRID_BROWSER_REPORT.json", "PACKAGE_CHECK_REPORT.json", "HYBRID_PERFORMANCE.json"]:
    path = extension / "dist" / name
    if path.exists():
        files.append((path, "reports/" + name))
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for source, name in sorted(files, key=lambda pair: pair[1]):
        if any(part in {".env", "node_modules", ".git", "validation"} for part in Path(name).parts):
            raise SystemExit("Disallowed artifact")
        bundle.write(source, name)
    bundle.writestr("reports/REGRESSION_SUMMARY.json", json.dumps(regressions, ensure_ascii=False, indent=2))
    # Explicit ESM mode also supports early Node 22 releases, which did not yet
    # enable automatic .js syntax detection by default.
    bundle.writestr("package.json", json.dumps({"name": "opc-timeline-rc1", "private": True, "type": "module", "engines": {"node": ">=22"}}))
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise SystemExit("Archive integrity failure")
    for source, name in files:
        if bundle.read(name) != source.read_bytes():
            raise SystemExit("Archive byte mismatch")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(json.dumps({"archive": str(archive), "files": len(files) + 2, "bytes": archive.stat().st_size, "sha256": digest}, ensure_ascii=False))
