import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '@/lib/prisma';
import { getEventReports } from '@alusa/lib/events/events.service';

const suffix = randomUUID().replaceAll('-', '');
const contaAId = `events-report-rls-a-${suffix}`;
const contaBId = `events-report-rls-b-${suffix}`;
const roleName = `alusa_rls_events_report_${suffix}`;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

let ownerRole = '';
let roleCreated = false;
let userId = '';
let eventId = '';

async function runAsTenant<T>(contaId: string, callback: (_tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${contaId}, true)`;
    return callback(tx);
  });
}

describe('event reports tenant RLS', () => {
  beforeAll(async () => {
    const [connection] = await prisma.$queryRawUnsafe<Array<{ current_user: string }>>('SELECT current_user');
    ownerRole = connection?.current_user ?? '';
    if (!ownerRole) throw new Error('Não foi possível identificar a role proprietária do banco de teste.');

    await prisma.conta.createMany({
      data: [
        { id: contaAId, nome: `Events Report RLS A ${suffix}` },
        { id: contaBId, nome: `Events Report RLS B ${suffix}` },
      ],
    });
    const user = await prisma.usuario.create({
      data: {
        contaId: contaAId,
        nome: 'Legacy account owner with foreign membership',
        email: `events-report-rls-${suffix}@example.test`,
        senhaHash: 'test-only-hash',
      },
      select: { id: true },
    });
    userId = user.id;
    await prisma.usuarioConta.create({
      data: { usuarioId: user.id, contaId: contaBId, role: 'RESPONSAVEL', status: 'ATIVO' },
    });
    const event = await prisma.schoolEvent.create({
      data: {
        contaId: contaAId,
        name: `Events RLS Probe ${suffix}`,
        type: 'OTHER',
        startsAt: new Date('2026-10-01T12:00:00Z'),
        responsibleUserId: user.id,
        createdByUserId: user.id,
      },
      select: { id: true },
    });
    eventId = event.id;

    const role = quoteIdentifier(roleName);
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    roleCreated = true;
    await prisma.$executeRawUnsafe(`GRANT ${role} TO ${quoteIdentifier(ownerRole)}`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public, app_security TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION app_security.current_conta_id() TO ${role}`);
    await prisma.$executeRawUnsafe(
      `GRANT SELECT ON TABLE public."SchoolEvent", public."Usuario", public."UsuarioConta", public."EventTicketSale", public."EventTicketLot", public."EventCostume", public."EventCostumeAssignment", public."EventFinancialEntry", public."EventParticipant" TO ${role}`,
    );
  });

  afterAll(async () => {
    if (eventId) await prisma.schoolEvent.deleteMany({ where: { id: eventId } });
    if (userId) await prisma.usuarioConta.deleteMany({ where: { usuarioId: userId } });
    if (userId) await prisma.usuario.deleteMany({ where: { id: userId } });
    await prisma.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    if (roleCreated) {
      const role = quoteIdentifier(roleName);
      await prisma.$executeRawUnsafe(`REVOKE ${role} FROM ${quoteIdentifier(ownerRole)}`);
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });

  it('redacts account B membership hidden by RLS in an account A report', async () => {
    const [policyRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ table_name: string; rls_enabled: boolean; policy_exists: boolean }>>(
        `SELECT c.relname AS table_name,
          c.relrowsecurity AS rls_enabled,
          EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'tenant_isolation'
          ) AS policy_exists
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('SchoolEvent', 'Usuario', 'UsuarioConta')
        ORDER BY c.relname`,
      ),
    ]);
    expect(policyRows).toHaveLength(3);
    expect(policyRows.every((row) => row.rls_enabled && row.policy_exists)).toBe(true);

    const report = await runAsTenant(contaAId, (tx) =>
      getEventReports({ contaId: contaAId }, { eventId }, tx),
    );

    expect(report.selected?.id).toBe(eventId);
    expect(report.selected?.responsibleUserId).toBeNull();
    expect(report.selected?.responsibleUser).toBeNull();
    expect(report.selected?.createdByUserId).toBeNull();
    expect(report.selected?.createdBy).toBeNull();
  });

  it('keeps simultaneous report reads isolated to each tenant context', async () => {
    const [reportA, reportB] = await Promise.all([
      runAsTenant(contaAId, (tx) => getEventReports({ contaId: contaAId }, { eventId }, tx)),
      runAsTenant(contaBId, (tx) => getEventReports({ contaId: contaBId }, { eventId }, tx)),
    ]);

    expect(reportA.selected?.id).toBe(eventId);
    expect(reportA.selected?.responsibleUserId).toBeNull();
    expect(reportB.selected).toBeNull();
    expect(reportB.compareWith).toBeNull();
  });
});
