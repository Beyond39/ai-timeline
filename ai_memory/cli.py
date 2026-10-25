from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
import sys
from urllib.request import urlopen
import webbrowser

from .api import serve
from .compiler import KnowledgeCompiler
from .database import Database
from .doctor import inspect_project
from .experience import ExperienceService
from .extractors import HeuristicExtractor, OpenAIResponsesExtractor
from .qa import QAPipeline
from .service import MemoryService
from .tree import ProjectTree
from .evals import export_review, review_report


DEFAULT_DB = Path("data/ai-memory.sqlite")
LEGACY_DB = Path("data/ai-memory-v0.1.sqlite")


def _print(value) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _configure_console() -> None:
    """Prefer readable Chinese output on modern Windows terminals."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="ai-memory", description="Traceable multi-project memory for LLM conversations")
    root.add_argument("--db", help="SQLite database path (defaults to data/ai-memory.sqlite)")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Initialize the SQLite database")
    commands.add_parser("doctor", help="Read-only check of the current local project stage")

    import_command = commands.add_parser("import", help="Import a ChatGPT export or provider-neutral JSON file")
    import_command.add_argument("path")
    import_command.add_argument("--project-title")
    preview = commands.add_parser("preview", help="Preview a JSON file or folder without importing")
    preview.add_argument("path")
    preview.add_argument("--project-title")
    remove_source = commands.add_parser("remove-source", help="Mark an imported source inactive")
    remove_source.add_argument("path")
    compile_project = commands.add_parser("compile-project", help="Segment and compile one project into a topic tree")
    compile_project.add_argument("project_id")
    compile_project.add_argument("--extractor", choices=("heuristic", "openai"), default="heuristic")
    compile_project.add_argument("--model")
    compile_project.add_argument("--force", action="store_true")
    tree_command = commands.add_parser("tree", help="Show a project's topic tree")
    tree_command.add_argument("project_id")
    fragments_command = commands.add_parser("fragments", help="Show source-backed conversation fragments")
    fragments_command.add_argument("project_id")
    eval_export = commands.add_parser("eval-export", help="Export human review sheet for a compiled project")
    eval_export.add_argument("project_id")
    eval_export.add_argument("--output", required=True)
    eval_report = commands.add_parser("eval-report", help="Summarize reviewed evaluation CSV")
    eval_report.add_argument("path")

    commands.add_parser("projects", help="List imported projects")
    conversations = commands.add_parser("conversations", help="List conversations in one project")
    conversations.add_argument("project_id")
    questions = commands.add_parser("questions", help="List questions globally or in one project")
    questions.add_argument("--project-id")
    questions.add_argument("--limit", type=int, default=100)
    search = commands.add_parser("search", help="Search every traceable sentence")
    search.add_argument("query")
    search.add_argument("--project-id")
    search.add_argument("--limit", type=int, default=50)
    compile_command = commands.add_parser("compile", help="Compile traceable topic knowledge files")
    compile_command.add_argument("--extractor", choices=("heuristic", "openai"), default="heuristic")
    compile_command.add_argument("--model", help="Explicit model ID required for --extractor openai")
    compile_command.add_argument("--project-id", help="Optional project scope; omit for cross-project compilation")
    compile_command.add_argument("--output", default="output/generated/knowledge")
    compile_command.add_argument("--force", action="store_true")
    compile_command.add_argument("--max-input-chars", type=int, default=120_000)
    analyze = commands.add_parser("analyze", help="Build cached, traceable Q/A units before knowledge compilation")
    analyze.add_argument("--project-id")
    analyze.add_argument("--force", action="store_true")
    qa = commands.add_parser("qa", help="List derived Q/A knowledge units")
    qa.add_argument("--project-id")
    qa.add_argument("--limit", type=int, default=200)
    merge_reviews = commands.add_parser("merge-reviews", help="List tag merges that require human judgment")
    merge_reviews.add_argument("--status", default="pending")
    resolve_merge = commands.add_parser("resolve-merge", help="Resolve one suggested topic merge")
    resolve_merge.add_argument("review_id")
    resolve_merge.add_argument("action", choices=("merge", "keep_separate"))
    resolve_merge.add_argument("--note", default="")
    commands.add_parser("topics", help="List compiled topics and evidence counts")
    topic = commands.add_parser("topic", help="Show one topic with its source evidence")
    topic.add_argument("topic_id_or_slug")
    commands.add_parser("knowledge", help="List generated knowledge documents")
    review = commands.add_parser("review", help="Record human approval or rejection")
    review.add_argument("document_or_topic")
    review.add_argument("action", choices=("approve", "reject", "reset"))
    review.add_argument("--note", default="")
    review.add_argument("--output", default="output/generated/knowledge")
    context = commands.add_parser("context", help="Create a portable, evidence-backed context package")
    context.add_argument("topic_id_or_slug")
    context.add_argument("--output", help="Optional Markdown output path")
    timeline = commands.add_parser("timeline", help="Show the chronological conversation trail")
    timeline.add_argument("--project-id")
    timeline.add_argument("--limit", type=int, default=300)
    server = commands.add_parser("serve", help="Start the local V0.4.2 topic-tree and review interface")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8765)
    launcher = commands.add_parser("launch", help="Start the local app and open it in your browser")
    launcher.add_argument("--port", type=int, default=8765)
    return root


def main(argv: list[str] | None = None) -> int:
    _configure_console()
    args = parser().parse_args(argv)
    database_path = Path(args.db) if args.db else (LEGACY_DB if LEGACY_DB.exists() and not DEFAULT_DB.exists() else DEFAULT_DB)
    database = Database(database_path)
    service = MemoryService(database)
    compiler = KnowledgeCompiler(database)
    qa_pipeline = QAPipeline(database)
    experience = ExperienceService(database)
    tree = ProjectTree(database)

    if args.command == "init":
        database.initialize()
        _print({"status": "initialized", "database": str(database.path.resolve())})
    elif args.command == "doctor":
        _print(inspect_project(database))
    elif args.command == "import":
        _print(service.import_path(args.path, project_title=args.project_title))
    elif args.command == "preview":
        _print(service.preview_path(args.path, project_title=args.project_title))
    elif args.command == "remove-source":
        _print(service.remove_source(args.path))
    elif args.command == "compile-project":
        extractor = (OpenAIResponsesExtractor(model=args.model or "") if args.extractor == "openai"
                     else HeuristicExtractor())
        _print(tree.compile(args.project_id, extractor, force=args.force))
    elif args.command == "tree":
        _print(tree.tree(args.project_id))
    elif args.command == "fragments":
        _print(tree.fragments.list_fragments(args.project_id))
    elif args.command == "eval-export":
        _print(export_review(database, args.project_id, args.output))
    elif args.command == "eval-report":
        _print(review_report(args.path))
    elif args.command == "projects":
        database.initialize()
        _print(service.list_projects())
    elif args.command == "conversations":
        database.initialize()
        _print(service.list_conversations(args.project_id))
    elif args.command == "questions":
        database.initialize()
        _print(service.list_questions(args.project_id, limit=args.limit))
    elif args.command == "search":
        database.initialize()
        _print(service.search(args.query, project_id=args.project_id, limit=args.limit))
    elif args.command == "compile":
        if args.extractor == "openai":
            extractor = OpenAIResponsesExtractor(model=args.model or "", max_input_chars=args.max_input_chars)
        else:
            extractor = HeuristicExtractor()
        _print(
            compiler.compile(
                extractor,
                output_dir=args.output,
                project_id=args.project_id,
                force=args.force,
            )
        )
    elif args.command == "analyze":
        _print(qa_pipeline.analyze(project_id=args.project_id, force=args.force))
    elif args.command == "qa":
        _print(qa_pipeline.list_units(project_id=args.project_id, limit=args.limit))
    elif args.command == "merge-reviews":
        _print(qa_pipeline.list_merge_reviews(status=args.status))
    elif args.command == "resolve-merge":
        _print(qa_pipeline.resolve_merge(args.review_id, args.action, note=args.note))
    elif args.command == "topics":
        _print(compiler.list_topics())
    elif args.command == "topic":
        result = compiler.get_topic(args.topic_id_or_slug)
        if result is None:
            raise SystemExit(f"Topic not found: {args.topic_id_or_slug}")
        _print(result)
    elif args.command == "knowledge":
        _print(compiler.list_documents())
    elif args.command == "review":
        _print(
            compiler.review(
                args.document_or_topic,
                args.action,
                note=args.note,
                output_dir=args.output,
            )
        )
    elif args.command == "context":
        result = experience.context_package(args.topic_id_or_slug)
        if args.output:
            target = Path(args.output)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(result["content"], encoding="utf-8")
            result = {**result, "output": str(target.resolve())}
        _print(result)
    elif args.command == "timeline":
        _print(experience.timeline(project_id=args.project_id, limit=args.limit))
    elif args.command == "serve":
        database.initialize()
        serve(service, args.host, args.port, compiler=compiler)
    elif args.command == "launch":
        database.initialize()
        url = f"http://127.0.0.1:{args.port}"
        def open_when_ready():
            for _ in range(40):
                try:
                    with urlopen(url + "/health", timeout=1):
                        if not webbrowser.open(url):
                            print(f"Browser did not open automatically. Open {url} manually.", flush=True)
                        return
                except OSError:
                    time.sleep(.2)
            print(f"Browser did not open automatically. Open {url} manually.", flush=True)
        serve(service, "127.0.0.1", args.port, compiler=compiler, on_ready=open_when_ready)
    return 0
