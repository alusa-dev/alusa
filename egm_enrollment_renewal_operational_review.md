# Enrollment and re-enrollment operational review

**Scope:** Read-only audit of existing student enrollment, family enrollment, renewal, transfer, closure, cancellation, contract, financial-history, authorization, and tenant-isolation paths. No code was changed and no tests were run.

## Reviewer status

| Reviewer | Status | Lens |
| --- | --- | --- |
| `design_critic` | completed | Wizard and design behavior |
| `codebase_details` | completed | Implementation traces and operational observability |
| `zoom_out` | completed | End-to-end lifecycle/system consistency |
| `comprehension` | completed | Behavior/rule alignment |
| `implementation_readiness` | completed | Readiness and coverage gaps |
| `structural` | completed | Relationship/history/transaction invariants |
| `inventive_catalyst` | completed | Non-obvious failure modes |

## Prioritized findings

### Minor enrollment can omit a responsible party when billing is disabled — Major

`enrollment.service.ts` derives `requiresPayer` from billing/fee flags and rejects a missing payer only when one of those flags is enabled ([enrollment.service.ts:755](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment.service.ts:755)). As written, an under-18 student's enrollment can pass when all billing flags are false, even though the product rule supplied for this review says minors require a responsible party. This may reflect a narrower intended meaning of “responsible” as the financial payer; that policy boundary is not clear. The family enrollment path is stricter and requires a same-tenant responsible with formal student links ([create-family-enrollment.use-case.ts:765](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/create-family-enrollment.use-case.ts:765)).

**Operational scenario to exercise:** create an individual enrollment for a minor with no responsible party and all billing, fee generation, and immediate fee-payment options disabled; confirm whether the system should reject it or persist an academically active record without a guardian link.

### Wizard ignores failure to link a newly created responsible party — Major

In `StepStudent.onSubmit`, the wizard checks the responsible and student creation responses, but does not inspect the response from `POST /api/alunos/responsavel`; it proceeds to store the student and display success regardless ([StepStudent.tsx:265](/Users/blendstudio/Projects/alusa/apps/web/features/enrollments/components/wizard/steps/StepStudent.tsx:265)). A failed relationship request can leave an unlinked student while the wizard's local `responsavel` field implies the association exists. Whether a later server preflight independently rejects that mismatch is not established by this component review.

**Operational scenario to exercise:** allow responsible and student creation to succeed, fail the relationship request (HTTP error or network drop), and verify the UI reports failure and allows safe recovery without duplicate student/responsible records.

### Admin classification overrides can bypass evidence-derived classification — Major, policy-dependent

The manual classification endpoint allows an ADMIN to change any non-transfer classification to another allowed value with a free-text reason and audit record ([classification route.ts:43](/Users/blendstudio/Projects/alusa/apps/web/app/api/matriculas/vinculos-academicos/%5Bid%5D/classificacao/route.ts:43)). It blocks transfer without a formal relation and is tenant-scoped, but it does not enforce evidence for `REMATRICULA`, `RETORNO`, or `PRIMEIRO_INGRESSO`. This is a confirmed override capability; whether it is an operational defect depends on whether admin correction is intentionally permitted without evidence gates.

**Operational scenario to exercise:** attempt an admin override to `REMATRICULA` for a student with an interruption/formal rupture, and verify the expected policy, audit visibility, and downstream renewal behavior.

### Family wizard can silently present incomplete class choices — Nit / scale-dependent

`StepFamilyStudents` requests classes with `pageSize=200` and suppresses fetch errors, then fills the selectors from whatever data arrived ([StepFamilyStudents.tsx:65](/Users/blendstudio/Projects/alusa/apps/web/features/enrollments/components/wizard/steps/StepFamilyStudents.tsx:65)). Accounts with more than 200 eligible classes may see an incomplete list; request failures can appear as no available options. Impact depends on actual account sizes and backend pagination/ordering.

**Operational scenario to exercise:** use an account with more than 200 active classes and a transient class/combos API failure; verify the operator sees complete options or an actionable error.

### Expired-enrollment job failure lacks operational detail — Nit

The close-expired route returns a generic 500 on exceptions without recording a structured job outcome or failure reason ([close-expired route.ts:52](/Users/blendstudio/Projects/alusa/apps/web/app/api/jobs/matriculas/close-expired/route.ts:52)). Tenant scope is resolved before execution, and the underlying closure service scopes and logs individual closure work, but job-level diagnosis and partial-run visibility are weaker than the neighboring contract-closure job. This is an observability gap, not evidence that closure semantics are incorrect.

## Evidenced strengths

- **Academic classification and continuity:** static code selects effective academic links per student and modality/course, checks sequence and break evidence, and does not treat campaign membership as continuity evidence ([renewal-process.service.ts:2307](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/renewal-process.service.ts:2307), [enrollment.service.ts:1371](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment.service.ts:1371), [enrollment-classification.ts:24](/Users/blendstudio/Projects/alusa/packages/domain/src/rules/enrollment-classification.ts:24)).
- **Transfer:** source and destination are same-student, tenant-scoped links; the source must be effective and the relation is explicitly registered and formalized with concurrency checks ([academic-transfer.service.ts:25](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/academic-transfer.service.ts:25), [academic-transfer.service.ts:101](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/academic-transfer.service.ts:101)). The classification endpoint rejects a transfer classification without a formal relation ([classification route.ts:40](/Users/blendstudio/Projects/alusa/apps/web/app/api/matriculas/vinculos-academicos/%5Bid%5D/classificacao/route.ts:40)).
- **Closure/history:** natural expiry closes only eligible enrollments without successors, retains enrollment/link records, writes an audit log, and scopes operations by `contaId` ([enrollment-closure.service.ts:32](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-closure.service.ts:32), [enrollment-closure.service.ts:143](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-closure.service.ts:143)).
- **Cancellation financial history:** inspected sync logic preserves overdue charges while removing eligible future charges; test source asserts that overdue charges remain open ([enrollment-sync.service.ts:321](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-sync.service.ts:321), [enrollment-sync.service.test.ts:688](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-sync.service.test.ts:688)). End-to-end proof that cancellation always blocks every future billing path was not established in this review.
- **Failure handling and idempotency:** individual/family creation and renewal have persisted operation states, replay/idempotency handling, reconciliation paths, and tenant-scoped records; family failures include rollback/compensation handling ([create-immediate-enrollment.use-case.ts:359](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/create-immediate-enrollment.use-case.ts:359), [create-family-enrollment.use-case.ts:484](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/create-family-enrollment.use-case.ts:484)).
- **Authorization/tenant scope:** inspected transfer/classification routes derive tenant identity from authenticated context and require admin access; key responsible, enrollment, transfer, and closure queries are scoped by `contaId`. Reviewers reported no confirmed cross-tenant defect in the examined paths. This is scoped evidence, not a complete security audit.

## Automated test evidence vs. manual reports

**Automated test source inspected; not executed:** the repository contains assertions for academic classification by course, interrupted return and transfer, cancellation before effective start, family/immediate enrollment, transfer tenant isolation/concurrency, and closure. Examples include [enrollment-academic-classification-flow.spec.ts:613](/Users/blendstudio/Projects/alusa/apps/web/e2e/enrollment-academic-classification-flow.spec.ts:613), [academic-transfer.concurrency.integration.test.ts](/Users/blendstudio/Projects/alusa/apps/web/tests/integration/enrollments/academic-transfer.concurrency.integration.test.ts), [create-family-enrollment.use-case.test.ts](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/create-family-enrollment.use-case.test.ts), [enrollment-closure.service.test.ts](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-closure.service.test.ts), and [enrollment-sync.service.test.ts:688](/Users/blendstudio/Projects/alusa/apps/web/src/server/enrollments/enrollment-sync.service.test.ts:688). These references establish that test assertions exist, not that they currently pass. The reviewers did not execute tests. The responsible-link request failure and the no-billing minor case were not shown as covered by the reviewed test references. Reviewers also could not find a single assertion proving overdue retention and future-billing blocking together across cancellation.

**User-reported manual sandbox pass:** the requester reports that broad sandbox scenarios have passed so far. The review did not independently observe or reproduce those runs, and the prompt did not enumerate the exact cases or resulting records. This report treats the pass as useful user-reported evidence, not verified test evidence.

## Additional manual scenarios

1. Individual minor enrollment with all charges disabled and no responsible party; verify the intended academic and guardian policy.
2. Responsible creation and student creation succeed while relationship creation fails or times out; verify accurate UI state and safe retry.
3. Family enrollment where one child succeeds and another fails during financial provisioning; verify all students, family/subscription links, charges, and operation status reconcile without duplicates or orphaned history.
4. Admin classification override across a known gap/formal rupture, with subsequent renewal; verify policy, audit, and the classification used by downstream processing.
5. Cancel an enrollment with an overdue receivable plus future installments/subscription; verify overdue balance/history remains, all future billing is stopped, retries/webhooks do not recreate charges, and family/subscription relationships remain coherent.
6. Cancel/reactivate or close at the effective-start boundary, including same civil date across the account timezone; verify the intended distinction between active academic history, cancellation before start, and return after interruption.
7. Family wizard with more than 200 classes, and with one failed class/combos request; verify operators cannot mistake partial data for a complete catalog.
8. Cross-tenant attempts for responsible, student, class, enrollment, transfer source/destination, and renewal campaign IDs; verify rejected requests leave no partial records.

## Operational readiness conclusion

**Not yet demonstrated as fully ready for all stated cases.** The core continuity, campaign, per-course classification, explicit-transfer, tenant-scoping, closure, and overdue-retention behavior is supported by static implementation evidence and existing test source. Two material edge paths remain: an individual minor can apparently enroll without a responsible party when billing is disabled, and the wizard can report success after the responsible-student link request fails. Admin classification overrides also allow policy exceptions that need an explicit decision. The user's broad sandbox pass is acknowledged, but it does not establish whether these specific failure paths were exercised. Until these are resolved or explicitly accepted and covered by tests/manual cases, readiness for unrestricted day-to-day enrollment and renewal should be considered conditional.

## Raw reviewer reports and status

### `design_critic` — completed

> Major: `StepStudent.onSubmit` creates a responsible, creates a student, then posts the relationship; it ignores the relationship response and proceeds to update wizard state and show success ([StepStudent.tsx:223–289]). A network/HTTP failure can leave a minor and responsible unlinked; backend payer preflight is conditional ([enrollment.service.ts:755–763]). The API may enforce links elsewhere, but this component definitely ignores failure. Nit/design uncertainty: `StepFamilyStudents` hard-caps classes at 200 and swallows fetch errors ([StepFamilyStudents.tsx:65–105]). Strengths: per-link classification, transfer formalization checks, closure constraints, family responsible/student linkage, tenant-scoped transfer auth. Test files exist for classifications, transfer, family, immediate enrollment, renewals, closure; not run. Manual pass not independently observed.

### `codebase_details` — completed

> Noisy operational visibility: close-expired route catches errors and returns generic 500 without job-run/failure details ([close-expired/route.ts:52–61]); transfer routes/service do not emit a structured correlation/audit event for request outcome ([academic-transfer.service.ts:60–92,139–158]); renewal transitions have persisted state but limited structured transition events; immediate/family UI/backend operation identifiers could be easier for support to correlate. Core workflows have idempotency/reconciliation; campaign is organization/metrics; transfer and history are tenant scoped. Relevant test files exist but were not comprehensively inspected or executed. No cross-tenant flaw established in excerpts; no manual pass independently observed.

### `zoom_out` — completed

> No Blocker/Major defect substantiated. Effective-link history is scoped by tenant, modality, and student; campaign membership is not continuity proof; classification and explicit transfer behavior align with the supplied rules. Cancellation preserves overdue issued charges; test source asserts it. Existing classification, renewal, transfer tenant/concurrency, and cancellation tests cover these areas. No tests run; no sandbox status independently observed.

### `comprehension` — completed

> Likely policy mismatch: individual enrollment only requires a financial responsible party when billing/fee flags request it ([enrollment.service.ts:755–763]); under-18 enrollment can proceed without that payer if all flags are false. This conflicts with the supplied rule if it means any enrollment needs a responsible party. Family path is stricter. Classification, campaign/target period, transfer, and overdue-cancellation paths appear aligned. Test source exists, no runtime/manual pass verified.

### `implementation_readiness` — completed

> No confirmed blocker. Classification uses effective links, coverage, sequence, and break evidence; campaign is not continuity proof. Transfer requires explicit formal relation; tenant scope is present. Potential Major, policy dependent: admin can override any non-transfer classification using free-text reason and audit ([classification route.ts:43–51]). No clear assertion was found for overdue retention plus future-billing block together. Test assertions exist for adult/minor payer UI, family, transfer, classification, cancellation-before-effective-start, and pause; none run.

### `structural` — completed

> Major: minor can be enrolled without responsible party when billing is disabled because `requiresPayer` is conditional ([enrollment.service.ts:755–763]). Effective activation, per-modality renewal classification, explicit tenant-scoped transfer, and transactional closure/history preservation are coherent in the inspected paths. Transfer unit/tenant tests assert formalization/audit/race/foreign-origin behavior. Unknowns include production closure-job invocation and full cancellation billing guarantees. No tests run; no manual result independently verified.

### `inventive_catalyst` — completed

> No confirmed failure-mode finding beyond unresolved same-day cancellation/effective-start semantics: the helper compares `cancelledAt` with `dataInicio`, but no date/timezone contract was available to establish a defect. Static review saw effective-link evidence, per-modality history, explicit transfer, tenant-scoped writes, and retained cancellation/financial history. Tests exist but were not run. Sandbox status not available.
