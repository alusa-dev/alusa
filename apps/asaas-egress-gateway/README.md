# Asaas refund egress gateway (sandbox)

Standalone, refund-only Node service. It accepts only `POST /v1/payments/:id/refund`, requires an HMAC-SHA256 signature over `<method>.<path>.<timestamp>.<request-id>.<raw-body>` (60 second signature window), and rejects repeated stable request IDs using the persistent dedupe store. It validates a sandbox API key and always calls the fixed Asaas sandbox host. Request bodies are capped at 16 KiB and upstream calls time out after 15 seconds. Provider error bodies and credentials are never returned or logged.

## Configuration

Gateway process: `ASAAS_REFUND_GATEWAY_ENABLED=true`, `ASAAS_REFUND_GATEWAY_SECRET=<shared random secret>` (enforced minimum 32 bytes), `ASAAS_REFUND_GATEWAY_NONCE_DIR` (persistent writable directory; default `/var/lib/alusa-asaas-gateway/nonces`), and optional `PORT` (default 8080). The process listens on `127.0.0.1`. Each stable financial command ID reserves a file through exclusive creation; its dedupe record is retained permanently so a retry after timeout/restart cannot send a second Asaas refund. Storage failure rejects requests, and duplicate commands return ambiguous HTTP 503 for reconciliation. Run exactly one gateway process on the Lightsail instance: the local dedupe store is not shared across instances. Alusa server process: set the same enable flag, `ASAAS_REFUND_GATEWAY_URL=https://<chosen-host>` (origin only: no path, query, fragment, or credentials), and the same secret. With the flag unset or false, `refundPayment` keeps using its existing direct Asaas transport; with the flag true and URL, secret, or stable command ID absent, it fails closed. Production API keys are rejected by this route.

Example local secret generation: `openssl rand -hex 32`. Do not commit secrets.

## Deployment status

No deployment, DNS, TLS, firewall, or cloud account changes are included. The Lightsail instance currently has no domain/HTTPS and only SSH ingress, so this service must not be enabled until a domain and HTTPS ingress on 443 are configured and verified. Operationally, point the actual chosen hostname to the instance, provision a certificate for that hostname, then configure a local reverse proxy (for example, Nginx) to terminate TLS on 443 and forward only `/v1/payments/` to `http://127.0.0.1:8080`; keep the Node listener on loopback and expose no other gateway routes. Allow inbound 443 only after the proxy and certificate are ready. The actual hostname and certificate paths are intentionally left unspecified. The Alusa client expects HTTPS and does not use the static IP directly.
