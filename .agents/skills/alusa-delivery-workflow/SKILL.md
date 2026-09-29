---
name: alusa-delivery-workflow
description: Coordinate Alusa code changes in Codex using GPT-6 Luna at a task-appropriate reasoning effort, the existing specialist contracts, and risk-based read-only review. Use when implementing, fixing, or reviewing a change in this repository.
---

# Alusa delivery workflow

Use this skill as the operational entry point. `.agents/alusa-orchestrator.md` is the canonical delivery contract; `AGENTS.md` and the relevant `.agents/*.md` files remain the source of project rules.

## Model and delegation policy

- Use GPT-6 Luna exclusively in the primary session and every subagent.
- Default to Medium for bounded analysis, routine work, and simple implementation. Use High for substantial changes, complex debugging, and multi-layer decisions. Use Extra High (`xhigh`) only for unusually difficult work or deep review where the expected quality gain justifies the added reasoning cost.
- Keep routine analysis, task classification, execution, and final synthesis in the primary session.
- Use `alusa-decision-advisor` at most once for a bounded, high-impact decision that remains unresolved after checking user instructions and relevant code/contracts. It uses GPT-6 Luna, is read-only, and never implements or performs a general review.
- Use `alusa-core-worker` as the sole implementation worker for a delivery task; set its reasoning effort based on scope rather than assigning High to every task.
- Do not spawn agents for trivial changes or for work that depends on one short sequential reasoning chain.
- Delegate only independent, bounded reviews. Use `alusa-tenant-reviewer` (GPT-6 Luna High) only when the diff touches tenant authorization, tenant-scoped data, cache, jobs, or webhooks.
- Keep at most one subagent active. Do not delegate the same files to multiple implementers.
- Subagents consume additional usage. Prefer one worker and zero or one reviewer; invoke additional specialists only when required by `AGENTS.md`, the relevant contracts, or the risk matrix in `.agents/alusa-orchestrator.md`.
- Start subagents with no inherited conversation history by default (`fork_turns: "none"`). Give them the user request, a short scope summary, exact paths, and only the applicable contract. Include a few recent turns only when a decision depends on that history.
- Request concise findings and summaries; do not copy raw logs, full diffs, or broad exploration notes back into the primary thread.

## Delivery sequence

1. Read `.agents/alusa-orchestrator.md`; classify the request as analysis, delivery, review, or hotfix.
2. Inspect the relevant code and read only the specialist contracts required by the affected domain. Ask `alusa` first when product scope is uncertain.
3. For explicit implementation requests, delegate a focused task to `alusa-core-worker`, naming the exact scope, likely paths, applicable specialist contracts, and acceptance criteria. Keep implementation sequential and pass only the necessary context.
4. After implementation, select the smallest reviewer set required by risk and repository contracts. Use `alusa-tenant-reviewer` for tenant-sensitive changes. For schema, webhook, financial, or other critical flows, follow the specific reviewers and final gate named in `.agents/alusa-orchestrator.md`; do not replace them with this generic reviewer.
5. Resolve findings or report blockers, run relevant checks, and synthesize the result using the Delivery Brief structure in `.agents/alusa-orchestrator.md` when the change warrants a brief.

## Reviewer handoff

Give each reviewer the user request, a concise change summary, the diff or changed paths, and its canonical specialist contract. Ask for concrete findings with file and line references. Reviewers are read-only and must not broaden scope.

## Completion report

Report what changed, which specialist contracts/reviewers were used, checks and outcomes, and unresolved risks. Do not claim a reviewer ran unless it actually ran. For analysis-only requests, do not delegate implementation or modify files.
