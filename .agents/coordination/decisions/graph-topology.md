# Decision: Full Mesh Topology with Command-Based Routing

- **Decided by**: Building Base Agent Graph (`0bc4d7e8`)
- **Date**: 2026-03-08
- **Status**: active

## Decision

The agent graph uses a **full mesh topology** where every agent node can route to every other agent node. Routing is done via LangGraph `Command` objects returned by each agent function, not via static conditional edges.

**Why**: This gives maximum flexibility — any agent can hand off to any other agent based on the conversation context, without requiring the graph structure to be modified.

## Constraints on Other Agents

- **New agent nodes** added to the graph MUST be connected to all existing nodes (added to every node's `ends` array)
- **All existing nodes** must have the new node added to their `ends` array
- **Routing decisions** are made by the agent's LLM, not hardcoded — don't add conditional edges
- **`BaseClawState`** is the single shared state schema — extend it, don't create parallel state objects
- **Conversation Agent** remains the sole entry/exit point (`__start__ → conversation`, only conversation routes to `__end__`)

## Files Affected
- `src/graph.ts` — Graph structure
- `src/state.ts` — State schema
- `src/agents/*.ts` — All agent implementations
