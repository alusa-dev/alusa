import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../prisma';
import { publishEventMap, updateEventMapDraft } from './event-map.service';

describe('event map optimistic concurrency', () => {
  it('rejects stale draft saves and publication without overwriting the newer state', async () => {
    const runId = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Map write conflict ${runId}` } });

    try {
      const event = await prisma.schoolEvent.create({
        data: {
          contaId: conta.id,
          name: `Map write conflict ${runId}`,
          type: 'CULTURAL_SHOW',
          startsAt: new Date(),
        },
      });
      const map = await prisma.eventMap.create({
        data: {
          contaId: conta.id,
          eventId: event.id,
          name: 'Rascunho original',
          levels: {
            create: {
              contaId: conta.id,
              name: 'Ambiente 1',
              sortOrder: 0,
              widthPx: 1440,
              heightPx: 900,
              unit: 'px',
            },
          },
        },
        include: { levels: true },
      });
      const staleUpdatedAt = map.updatedAt.toISOString();
      const newerUpdatedAt = new Date(map.updatedAt.getTime() + 1_000);

      await prisma.eventMap.update({
        where: { id: map.id },
        data: { name: 'Estado salvo por outra sessão', updatedAt: newerUpdatedAt },
      });

      const draft = {
        expectedUpdatedAt: staleUpdatedAt,
        name: 'Tentativa obsoleta',
        levels: [{
          id: map.levels[0]!.id,
          name: 'Ambiente sobrescrito',
          sortOrder: 0,
          widthPx: 1440,
          heightPx: 900,
          unit: 'px',
        }],
        sections: [],
        objects: [],
        seats: [],
      };

      await expect(updateEventMapDraft(
        { contaId: conta.id, userId: 'integration-test-user' },
        event.id,
        map.id,
        draft,
      )).rejects.toMatchObject({ code: 'CONFLITO_RASCUNHO_MAPA', status: 409 });

      await expect(publishEventMap(
        { contaId: conta.id, userId: 'integration-test-user' },
        event.id,
        map.id,
        staleUpdatedAt,
      )).rejects.toMatchObject({ code: 'CONFLITO_RASCUNHO_MAPA', status: 409 });

      const persisted = await prisma.eventMap.findFirst({
        where: { id: map.id, contaId: conta.id, eventId: event.id },
        include: { levels: true, versions: true },
      });
      expect(persisted?.name).toBe('Estado salvo por outra sessão');
      expect(persisted?.updatedAt).toEqual(newerUpdatedAt);
      expect(persisted?.levels).toHaveLength(1);
      expect(persisted?.levels[0]?.name).toBe('Ambiente 1');
      expect(persisted?.status).toBe('DRAFT');
      expect(persisted?.versions).toHaveLength(0);
    } finally {
      await prisma.conta.deleteMany({ where: { id: conta.id } });
    }
  }, 15_000);
});
