# CLAUDE.md


## Style

- Plain, direct language. No hype, marketing tone, or robotic phrasing.
- File-level comments: one-line summaries only.
- Add comments only to clarify intent or non-obvious behavior. Don't restate obvious code.
- User-facing text: keep sentences short; brevity over perfect grammar.

## Writing

- Use "is", "are", "has" — don't substitute with "serves as", "stands as", "boasts", "features", "represents".
- Don't inflate importance. Cut "pivotal", "testament", "vital role", "enduring", "marking a shift", "setting the stage", "reflects broader", "indelible mark".
- Don't tack on -ing phrases to fake depth: "highlighting...", "underscoring...", "showcasing...", "reflecting...", "fostering...", "ensuring...".
- Avoid AI-vocabulary words: "Additionally", "delve", "crucial", "landscape" (abstract), "tapestry" (abstract), "interplay", "intricate", "garner", "underscore", "vibrant", "enhance", "foster", "align with", "showcase", "pivotal".
- No negative parallelisms ("It's not just X; it's Y", "Not only...but also...").
- No forced rule-of-three groupings. Two items or four are fine.
- No em-dash abuse. Use commas or periods.
- No sycophancy: cut "Great question!", "You're absolutely right!", "I hope this helps!", "Would you like me to...".
- No filler: "In order to" → "To". "Due to the fact that" → "Because". "It is important to note that" → just state it. "Has the ability to" → "can".
- Don't over-hedge. Say "may" once, not "could potentially possibly".
- Don't end with vague optimism ("The future looks bright", "Exciting times ahead"). End with something concrete or just stop.
- Vary sentence length and structure. Don't let every sentence follow the same pattern.
- Be specific over vague. Name sources, cite numbers, give concrete details instead of "experts say" or "studies show".

## Portfolio content

- Technical terminology is expected. Use industry terms accurately.
- Metrics and figures are good — "reduced churn by 15%" beats "improved retention".
- Describe what you did and what changed. Skip adjectives about how important it was.
- Let results speak. "Built X, which did Y" needs no "pivotal" or "vital".

## Editing

- Preserve existing behavior unless explicitly asked to change it. When in doubt, ask first.
- Favor targeted edits over sweeping changes. Don't remove user modifications.
- For layout or gesture logic, note assumptions (coordinate normalization, touch counts, etc.) in brief comments near the code.
- If a request seems unclear or contradicts a previous decision, ask the user before proceeding.
- When a change introduces a visual side-effect, fix the side-effect — don't revert the change. Think about what the user actually wants and find a solution that preserves all prior decisions.
- When the user specifies an exact value (size, spacing, color, etc.), use that value. Don't substitute your own judgment for explicit instructions.
- When a change (e.g. renaming a term, updating a label) could affect other places in the codebase, ask the user if we should propagate the change before doing it.
- Only change what was requested. If a related change seems beneficial, suggest it — don't apply it silently.
- When the user says something is fine (colors, layout, behavior, etc.), treat it as a constraint: do not investigate, question, or change it. Move on to what they actually asked to fix.
- Before writing or modifying any UI element, read the source of the component it mirrors or resembles. Pull exact values (sizes, weights, colors, structure) from the code. Never guess.
- When the user gives a clear instruction, execute it fully in one pass. Don't ask for confirmation of something they already stated. Re-read what they said before responding — if the answer is already in their words, act on it.

## Noticed issues

- When you spot something off that's unrelated to the current task, append it to `.claude/TODO.md` instead of fixing it or ignoring it.
- Keep entries short: one line with the file path and what's wrong.
- Don't duplicate entries already in the file.
- When working on a task that touches a file or area mentioned in the TODO, suggest tackling the related entry while we're there.

## Transitions

- Every element that animates in must also animate out. The user should always see where something came from and where it goes.
- Slide-in panels need a matching slide-out. Fade-in backdrops need a matching fade-out. No element should just disappear.
- Use a `closing` state + `setTimeout(onClose, duration)` pattern for exit animations on components controlled by a parent `{#if}`.

## Learning

- When a correction or preference comes up during a session, note it as a candidate for CLAUDE.md. At the end of the session, propose any new rules or observations before closing — don't silently assume they'll be remembered.

## Components

- When a visual pattern appears in more than one place, extract it into a shared component. Don't duplicate markup across files — use the existing component and pass props for size/status variants.
- Key shared components: `ActionBlock.svelte` (action blocks in pipelines, cards, pickers — supports `size="sm"|"md"` and optional `status`).

## Workflow

- Use plan mode for any non-trivial implementation task. Explore the codebase and design the approach before writing code.
- Launch multiple agents in parallel whenever possible, matching each agent to the appropriate skill and type for the subtask (e.g., Explore for codebase search, Builder for feature work, Debugger for root-cause analysis, etc.).
- Prefer concurrent agent execution over sequential when subtasks are independent.

## Coordination

**Before editing any file, add a `working` entry to `.claude/WORKLOG.md`.** This is mandatory — no exceptions. Remove the entry when the task is finished. The worklog only tracks active work; don't leave `done` entries behind.

Multiple Claude Code instances (separate sessions/conversations) may work on this repo at the same time. Use `.claude/WORKLOG.md` to stay in sync. Agents dispatched within a single instance don't need worklog entries — they're coordinated by their parent instance.

### Worklog format

Each entry is an H2 heading with two fields:

```
## Task name
- Status: working
- Files: `path/a`, `path/b`
```

The worklog only contains active work. Remove your entry when the task is finished.

### Instance responsibilities

- **Starting a task**: read `.claude/WORKLOG.md`. If other instances are `working`, note which files they're touching. Then add your own `working` entry listing the files you plan to edit.
- **After finishing edits**: remove your entry entirely.
- **Before editing a file**: if the worklog shows another instance is actively editing that same file, warn the user about the conflict before proceeding.
- **Stale entries**: if a `working` entry is older than 2 hours, treat it as abandoned and remove it.

## Problem-solving

- Before writing a manual workaround, check whether the platform/API already has an attribute or option that solves the problem directly. Use the built-in mechanism — don't reinvent it with offsets, hacks, or compensating logic.

## Git hygiene

- Don't commit build products, generated outputs, or local artifacts (Xcode user data, etc.)—keep them in `.gitignore`.
- Before committing, check for accidental tracking of secrets or machine-specific files. Fix ignore rules rather than cleaning up manually.

## Git commits

- No co-author lines. No mention of Claude.
- Commit messages: vague, short, simple — nothing too specific.
