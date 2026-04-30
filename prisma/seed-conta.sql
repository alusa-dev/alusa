-- Inserir conta padrão se não existir
INSERT INTO "Conta" (id, nome, "cpfCnpj", status, "createdAt", "updatedAt")
SELECT 'conta-default', 'Escola Padrão', '00000000000', 'ATIVO', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Conta" WHERE id = 'conta-default');
