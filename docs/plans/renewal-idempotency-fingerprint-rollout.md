# Renewal idempotency fingerprint rollout

`RematriculaProcesso.requestFingerprint` was added as a nullable field. Processes
created before that migration retain `NULL` because the stored preview snapshot
does not guarantee every semantic request input needed to prove an exact replay
(including all financial terms and client decisions).

For those legacy processes, retrying with the old idempotency key returns the
stable `409 IDEMPOTENCY_CONFLICT` response. The caller must start a new attempt
with a new request key. This can require an operator or user to re-submit an
already confirmed legacy renewal; it avoids returning persisted personal and
financial data or treating a changed request as an identical operation based
on an incomplete preview hash. No automatic backfill is performed because it
would create fingerprints that cannot be verified against the original intent.

New processes persist the canonical fingerprint atomically with the process.
Exact retries are accepted only within the same `contaId` and when the
recomputed fingerprint matches.
