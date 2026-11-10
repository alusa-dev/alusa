import { describe, expect, it } from 'vitest';
import { getEligibleTransferSources, type EffectiveSourceLink } from '../steps/transfer-source-options';

const sourceLinks: EffectiveSourceLink[] = [
  {
    id: 'unused-ballet', modalidade: { id: 'ballet', nome: 'Ballet' },
    cicloAcademico: null, transferenciaOrigem: null,
  },
  {
    id: 'used-jazz', modalidade: { id: 'jazz', nome: 'Jazz' },
    cicloAcademico: null, transferenciaOrigem: { id: 'transfer-1' },
  },
  {
    id: 'unused-jazz', modalidade: { id: 'jazz', nome: 'Jazz' },
    cicloAcademico: null, transferenciaOrigem: null,
  },
];

describe('getEligibleTransferSources', () => {
  it('excludes sources already used by a transfer and the destination course', () => {
    expect(getEligibleTransferSources(sourceLinks, 'jazz').map((link) => link.id)).toEqual(['unused-ballet']);
  });

  it('returns no options when the destination course is unknown', () => {
    expect(getEligibleTransferSources(sourceLinks, undefined)).toEqual([]);
  });
});
