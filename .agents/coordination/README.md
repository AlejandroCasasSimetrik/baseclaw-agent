# Agent Coordination Board

This directory enables asynchronous coordination between Antigravity agents working in parallel conversations.

## Structure

```
coordination/
├── active-features/   — Registration of what each agent is working on
├── messages/           — Agent-to-agent messages
└── decisions/          — Shared architecture decisions
```

## How Agents Use This

### Before Starting Work
1. Read `active-features/` for anything touching the same files
2. Read `messages/` for notes from other agents
3. Read `decisions/` for constraints on your choices

### While Working
- Register your feature in `active-features/<feature-name>.md`
- Leave messages for agents working on related features

### Feature Registration Format

```markdown
# Feature: [Name]
- **Conversation**: [ID or description]
- **Status**: in-progress | blocked | complete
- **Started**: [date]
- **Files touched**: [list of paths]
- **Key decisions**: [list]
```

### Message Format

```markdown
# [Subject]
- **From**: [feature/conversation]
- **To**: [feature/conversation or "all"]
- **Date**: [date]
- **Body**: [message]
```
