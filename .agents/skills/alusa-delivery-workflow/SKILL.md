---
name: alusa-delivery-workflow
description: Coordinate Alusa code changes in Codex using the canonical specialist contracts, one implementation worker, and risk-based read-only review. Use for implementing, fixing, or reviewing a change in this repository.
---

# Alusa delivery workflow

Use this skill as the Codex operational entry point. `.agents/alusa-orchestrator.md` is the canonical delivery contract; `AGENTS.md` and relevant `.agents/*.md` contracts define project rules.

## Contracts, profiles, and configuration

- `.agents/*.md` are canonical specialist contracts, independent of agent runtime.
- `.codex/agents/*.toml` are executable Codex app/CLI profiles. Each profile points to its canonical contract and applies runtime permissions; it does not replace the contract.
- Project Codex configuration is `.codex/config.toml`: primary coordinator GPT-6.1 Sol Medium; `[agents] enabled = true`, `max_concurrent_threads_per_session = 3`, and GPT-6 Luna Medium subagent defaults. Use only the focused profiles below; do not create profiles for every specialist without a routing need.
- The `agent.multi_agent.enabled` setting in OpenAI Agents API docs configures **Agents API sessions**, not Codex app/CLI. For Codex, use `[agents]` in `.codex/config.toml` and custom profiles under `.codex/agents/`, as documented in [Codex subagents](https://developers.openai.com/codex/subagents/) and the [Codex config reference](https://developers.openai.com/codex/config-reference/).

| Canonical contract (`.agents/*.md`) | Codex profile (`.codex/agents/*.toml`) |
|-------------------------------------|---------------------------------------|
| `alusa-prisma-data-integrity` | `alusa-prisma-reviewer` |
| `alusa-webhook-reliability` | `alusa-webhook-reviewer` |
| `alusa-test-adversarial` | `alusa-adversarial-reviewer` |
| `alusa-architecture-reviewer` | `alusa-architecture-reviewer` |
| `alusa-tenant-security-auditor` | `alusa-tenant-reviewer` |

## Model and delegation policy

- The primary coordinator always uses GPT-6.1 Sol Medium.
- The coordinator performs intake, analysis, routing, and synthesis only; it never implements product code. Every task editing product code/files goes to one `alusa-core-worker` (GPT-6 Luna Medium). Preserve Medium for the worker.
- Do not add advisor, specialist, or reviewer agents for trivial/small tasks. Delegate edits to one core worker only; the coordinator may handle analysis-only work without editing files.
- For normal/material work, use one worker plus at most one most-relevant read-only reviewer. Run the architecture gate only if materiality or risk requires it.
- For critical tenant, finance, webhook, or schema changes, use the minimum reviewers required by applicable contracts. Independent reviews may run in parallel within the configured limit; run architecture review last when required.
- Use `alusa-decision-advisor` only for a high-impact decision still unresolved after checking relevant code and contracts. It is read-only, always uses GPT-6.1 Sol Medium, and never implements or performs a general review. Do not use it for routine or trivial tasks.
- The default subagent is GPT-6 Luna Medium. Specialized reviewers use GPT-6 Luna High and remain strictly read-only.
- For critical changes, independent read-only specialist reviews may run in parallel within the Codex session limit of three spawned agents. Select only the minimum set required by risk and repository contracts.
- For a material delivery or review that requires the architecture gate, run the `alusa-architecture-reviewer` profile last, after every applicable specialist review has completed. Do not spawn it for trivial changes that do not warrant a review gate. If a finding needs code changes, route the fix to `alusa-core-worker`, then rerun affected reviews and the architecture gate when still warranted.
- Reviewers do not edit files. They return actionable findings with severity, exact file and line, evidence, impact, and a suggested correction. No finding should be silently fixed by a reviewer; the orchestrator decides and routes remediation.
- Start subagents without inherited conversation history by default. Provide exact scope and paths, a short summary, and only applicable contracts. Inspect only directly related code; avoid broad repository reads. Ask for concise findings, not logs or extended diffs, and stop or redirect work that leaves scope or makes no progress.

## Delivery sequence

1. Read `.agents/alusa-orchestrator.md`; classify the request as analysis, delivery, review, or hotfix.
2. Inspect relevant code and read only specialist contracts required by affected domains. Resolve product ambiguity through `alusa`.
3. For explicit implementation, delegate the bounded scope to `alusa-core-worker`; keep one implementation worker active.
4. Select no reviewer for trivial edits, at most one most-relevant reviewer for normal/material work, or the minimum required by applicable contracts for critical risks. Parallelize independent critical reviews within the configured limit. Route Prisma risk to `alusa-prisma-reviewer`, webhook risk to `alusa-webhook-reviewer`, adversarial test risk to `alusa-adversarial-reviewer`, and tenant risk to `alusa-tenant-reviewer`; each follows its canonical contract in `.agents/*.md`.
5. Resolve findings through the core worker and rerun affected reviews as needed. For material deliveries/reviews requiring the gate, finish with the `alusa-architecture-reviewer` profile after all other applicable reviews.
6. Run relevant checks and synthesize the result using the Delivery Brief structure when warranted.

## Reviewer handoff

Give each reviewer the request, a concise change summary, changed paths or diff, and its canonical specialist contract. Ask for concrete findings with file and line references. Reviewers are read-only and must not broaden scope.

## Completion report

Report what changed, which contracts/reviews were used, checks and outcomes, and unresolved risks. Do not claim a reviewer ran unless it actually ran. For analysis-only requests, do not delegate implementation or modify files.
