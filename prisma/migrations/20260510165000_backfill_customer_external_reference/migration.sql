UPDATE "Customer"
SET "externalReference" = CONCAT('customer:', "contaId", ':', "payerType"::text, ':', "payerId")
WHERE "externalReference" IS DISTINCT FROM CONCAT('customer:', "contaId", ':', "payerType"::text, ':', "payerId");
