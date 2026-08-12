-- Um e-mail só pode ter um convite pendente no sistema inteiro.
-- O índice case-insensitive complementa a validação do serviço e protege contra race conditions.
CREATE UNIQUE INDEX "Invite_pending_lower_email_key"
ON "Invite" (LOWER("email"))
WHERE "status" = 'PENDING' AND "email" IS NOT NULL;
