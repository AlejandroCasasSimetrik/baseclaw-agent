# Feature: Base Agent Graph (Level 1)

## Agent
- **Conversation**: Building Base Agent Graph (`0bc4d7e8`)
- **Started**: 2026-03-08
- **Status**: in-progress

## Scope

### Files I'm modifying
- `src/graph.ts` — Main graph definition (mesh topology)
- `src/state.ts` — `BaseClawState` shared state schema
- `src/index.ts` — Entry point / CLI
- `src/tracing.ts` — LangSmith tracing setup
- `src/agents/conversation.ts` — Conversation Agent (entry/exit point)
- `src/agents/ideation.ts` — Ideation Agent
- `src/agents/planning.ts` — Planning Agent
- `src/agents/execution.ts` — Execution Agent
- `src/agents/reviewer.ts` — Reviewer Agent
- `src/skills/**` — Skill system (loader, registry, built-in skills)
- `src/test.ts` — Manual test harness

### Interfaces I'm defining
- `BaseClawState` — Central state annotation with fields:
  - `messages` (append reducer)
  - `currentAgent`, `phase`, `taskContext` (overwrite)
  - `iterationCount`, `maxIterations` (loop safety)
  - `activeSkills` (skill system)
- `buildGraph()` — Returns compiled LangGraph `StateGraph`

## Key Decisions
- **Mesh topology**: Every agent can route to every other agent via `Command`-based routing
- **Conversation Agent is the entry/exit point**: `__start__ → conversation`, only conversation can reach `__end__`
- **Lazy model initialization**: Models created at invocation time, not import time — enables testing without API keys
- **Intent-based routing**: Agents decide next node via LLM-driven intent classification
- **Iteration safety**: `iterationCount` / `maxIterations` prevent infinite loops

## Dependencies
- Depends on: none (foundational layer)
- Blocks: Coding Agent Integration (`0d47f627`), AI Library Service, Heartbeat System
