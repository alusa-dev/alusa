-- Uma rematrícula/item pode manter no máximo uma reserva ativa por tenant.
-- Reservas históricas canceladas ou convertidas continuam preservadas para auditoria.
CREATE UNIQUE INDEX "uq_reserva_vaga_futura_conta_item_active"
  ON "ReservaVagaFutura" ("contaId", "itemId")
  WHERE "itemId" IS NOT NULL
    AND "status" IN ('RESERVED', 'WAITLISTED');
