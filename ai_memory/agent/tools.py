"""Narrow, schema-validated tools exposed to the agent.

TODO:
- Wrap existing MemoryService, KnowledgeCompiler, and ExperienceService reads.
- Classify every tool as read-only, derived-write, or human-decision.
- Do not expose arbitrary SQL, shell commands, or unrestricted file paths.
"""

