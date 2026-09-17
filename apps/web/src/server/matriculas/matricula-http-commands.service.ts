import { prisma } from '@/src/prisma';
import { pausarMatricula, reativarMatricula } from './matricula-pausa.service';
import { syncMatriculaStatus } from './matricula-sync.service';

type InputOf<T> = T extends (..._args: infer Args) => unknown
  ? Args extends [infer Input, ...unknown[]]
    ? Input
    : never
  : never;

type HttpInput<T> = Omit<InputOf<T>, 'prisma'>;

export function pauseMatriculaFromHttp(input: HttpInput<typeof pausarMatricula>) {
  return pausarMatricula({ prisma, ...input });
}

export function reactivateMatriculaFromHttp(input: HttpInput<typeof reativarMatricula>) {
  return reativarMatricula({ prisma, ...input });
}

export function syncMatriculaStatusFromHttp(input: HttpInput<typeof syncMatriculaStatus>) {
  return syncMatriculaStatus({ prisma, ...input });
}
