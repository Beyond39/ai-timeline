"""Bounded orchestration loop for the future agent.

TODO:
- Accept an AgentState and a small tool registry.
- Execute one validated action per step.
- Stop on completion, insufficient evidence, approval required, budget limit,
  or repeated tool failure.
"""

