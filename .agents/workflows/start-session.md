---
description: Start a new development session (copy-paste into any AI chat)
---

# START SESSION

Copy and paste the text below into your AI chat (Claude, Gemini, or any other). Add your goal after it, or leave blank to follow SESSION_CONTEXT.md.

---

**Copy this:**

```
START SESSION. Read the following files in order:
1. docs/SESSION_CONTEXT.md — tells you the session number and today's goal
2. docs/scriptReferences.md — maps the entire codebase
3. docs/PROGRESS.md — shows feature status tables

Then summarize what you understand and propose a plan. If I've written a goal below, use that instead of whatever SESSION_CONTEXT.md says.

GOAL:
```

**Usage examples:**

To follow the pre-set goal:
```
START SESSION. Read the following files in order:
1. docs/SESSION_CONTEXT.md — tells you the session number and today's goal
2. docs/scriptReferences.md — maps the entire codebase
3. docs/PROGRESS.md — shows feature status tables

Then summarize what you understand and propose a plan. If I've written a goal below, use that instead of whatever SESSION_CONTEXT.md says.

GOAL:
```

To override with a custom goal:
```
START SESSION. Read the following files in order:
1. docs/SESSION_CONTEXT.md — tells you the session number and today's goal
2. docs/scriptReferences.md — maps the entire codebase
3. docs/PROGRESS.md — shows feature status tables

Then summarize what you understand and propose a plan. If I've written a goal below, use that instead of whatever SESSION_CONTEXT.md says.

GOAL: Add a new medication tracking feature to the daily entry form.
```
