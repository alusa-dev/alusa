import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prepareAvatarFile, replaceCurrentAvatar } from '@/features/account/server/avatar-service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import prisma from '@/lib/prisma';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { normalizeAccountTimeZone } from '@/src/server/aulas/calendar/account-timezone';
import { isValidIanaTimeZone } from '@/lib/brazil-iana-timezones';

export const runtime = 'nodejs';

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
}).strict();

const mobileProfileUpdateSchema = z
  .object({
    personal: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        telefone: z.string().trim().max(20).nullable().optional(),
        bio: z.string().trim().max(280).nullable().optional(),
      })
      .strict()
      .optional(),
    school: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        // CPF/CNPJ is intentionally accepted by the contract so the API can
        // return a clear policy error instead of silently ignoring the field.
        cpfCnpj: z.string().trim().optional(),
        timezone: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine(isValidIanaTimeZone, 'Fuso horário inválido')
          .optional(),
        address: z
          .object({
            street: z.string().trim().max(120).optional(),
            number: z.string().trim().max(20).optional(),
            neighborhood: z.string().trim().max(80).optional(),
            city: z.string().trim().max(80).optional(),
            state: z.string().trim().max(2).optional(),
            cep: z
              .string()
              .trim()
              .refine((value) => !value || /^\d{5}-?\d{3}$/.test(value), 'CEP inválido')
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.personal !== undefined || value.school !== undefined, {
    message: 'Nenhuma alteração fornecida.',
  });

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

async function getMobileActor(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

type MobileActor = { userId: string; contaId: string };

async function readMobileProfile(actor: MobileActor) {
  const membership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: {
      role: true,
      usuario: {
        select: {
          nome: true,
          email: true,
          telefone: true,
          birthDate: true,
          bio: true,
          locale: true,
          theme: true,
        },
      },
      conta: {
        select: {
          id: true,
          nome: true,
          cpfCnpj: true,
          status: true,
          timezone: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      },
    },
  });

  if (!membership) return null;

  return {
    personal: {
      name: membership.usuario.nome,
      email: membership.usuario.email,
      telefone: membership.usuario.telefone ?? null,
      birthDate: membership.usuario.birthDate?.toISOString() ?? null,
      bio: membership.usuario.bio ?? null,
      locale: membership.usuario.locale,
      theme: membership.usuario.theme,
    },
    school: {
      id: membership.conta.id,
      name: membership.conta.nome,
      cpfCnpj: membership.conta.cpfCnpj ?? null,
      status: membership.conta.status,
      timezone: membership.conta.timezone,
      role: membership.role,
      address: {
        cep: membership.conta.enderecoCep ?? null,
        street: membership.conta.enderecoLogradouro ?? null,
        number: membership.conta.enderecoNumero ?? null,
        neighborhood: membership.conta.enderecoBairro ?? null,
        city: membership.conta.enderecoCidade ?? null,
        state: membership.conta.enderecoUf ?? null,
      },
    },
    permissions: {
      canEditPersonal: true,
      canEditSchool: membership.role === 'ADMIN',
      canEditSchoolLegalIdentity: false,
    },
  };
}

async function hasActiveMembership(userId: string, contaId: string) {
  return prisma.usuarioConta.findFirst({
    where: {
      usuarioId: userId,
      contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true, role: true },
  });
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(request: Request) {
  const actor = await getMobileActor(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-profile:patch:${actor.userId}:${ipFromRequest(request)}`, 20, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const membership = await hasActiveMembership(actor.userId, actor.contaId);
  if (!membership) return unauthorized();

  const body = await request.json().catch(() => null);

  // Keep the original small contract used by the session/profile bootstrap.
  const legacyParsed = profileSchema.safeParse(body);
  if (legacyParsed.success) {
    const updated = await prisma.usuario.updateMany({
      where: { id: actor.userId, acessosConta: { some: { contaId: actor.contaId, status: 'ATIVO' } } },
      data: { nome: legacyParsed.data.name },
    });
    if (updated.count !== 1) return unauthorized();

    return NextResponse.json(
      {
        user: {
          name: legacyParsed.data.name,
          foto: (await prisma.usuario.findUnique({ where: { id: actor.userId }, select: { foto: true } }))?.foto ?? null,
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = mobileProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Revise os dados informados.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const update = parsed.data;
  if (update.school && membership.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Somente administradores podem atualizar os dados da escola.' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (update.school?.cpfCnpj !== undefined) {
    return NextResponse.json(
      {
        error: {
          code: 'LEGAL_IDENTITY_LOCKED',
          message: 'O CPF/CNPJ identifica a conta financeira e não pode ser alterado nesta tela.',
        },
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const userData = update.personal
    ? {
        ...(update.personal.name !== undefined ? { nome: update.personal.name } : {}),
        ...(update.personal.telefone !== undefined
          ? { telefone: normalizeDigits(update.personal.telefone) || null }
          : {}),
        ...(update.personal.bio !== undefined ? { bio: normalizeText(update.personal.bio) } : {}),
      }
    : {};

  const schoolData = update.school
    ? {
        ...(update.school.name !== undefined ? { nome: update.school.name } : {}),
        ...(update.school.timezone !== undefined
          ? { timezone: normalizeAccountTimeZone(update.school.timezone) }
          : {}),
        ...(update.school.address
          ? {
              ...(update.school.address.street !== undefined
                ? { enderecoLogradouro: normalizeText(update.school.address.street) }
                : {}),
              ...(update.school.address.number !== undefined
                ? { enderecoNumero: normalizeText(update.school.address.number) }
                : {}),
              ...(update.school.address.neighborhood !== undefined
                ? { enderecoBairro: normalizeText(update.school.address.neighborhood) }
                : {}),
              ...(update.school.address.city !== undefined
                ? { enderecoCidade: normalizeText(update.school.address.city) }
                : {}),
              ...(update.school.address.state !== undefined
                ? { enderecoUf: normalizeState(update.school.address.state) }
                : {}),
              ...(update.school.address.cep !== undefined
                ? { enderecoCep: normalizeDigits(update.school.address.cep).slice(0, 8) || null }
                : {}),
            }
          : {}),
      }
    : {};

  if (Object.keys(userData).length === 0 && Object.keys(schoolData).length === 0) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Nenhuma alteração fornecida.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  await prisma.$transaction(async (transaction) => {
    if (Object.keys(userData).length > 0) {
      const result = await transaction.usuario.updateMany({
        where: { id: actor.userId, acessosConta: { some: { contaId: actor.contaId, status: 'ATIVO' } } },
        data: userData,
      });
      if (result.count !== 1) throw new Error('PROFILE_MEMBERSHIP_NOT_FOUND');
    }

    if (Object.keys(schoolData).length > 0) {
      await transaction.conta.update({ where: { id: actor.contaId }, data: schoolData });
    }
  });

  const updatedProfile = await readMobileProfile(actor);
  if (!updatedProfile) return unauthorized();

  return NextResponse.json(
    updatedProfile,
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

function normalizeText(value: string | null | undefined) {
  const text = value?.trim() ?? '';
  return text || null;
}

function normalizeDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
}

function normalizeState(value: string | null | undefined) {
  return normalizeText(value)?.toUpperCase() ?? null;
}

export async function GET(request: Request) {
  const actor = await getMobileActor(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-profile:get:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const profile = await readMobileProfile(actor);
  if (!profile) return unauthorized();

  return NextResponse.json(
    profile,
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const actor = await getMobileActor(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-profile:avatar:${actor.userId}:${ipFromRequest(request)}`, 10, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Nenhuma foto foi enviada.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const membership = await hasActiveMembership(actor.userId, actor.contaId);
  if (!membership) return unauthorized();

  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
  try {
    const avatar = await prepareAvatarFile(file);
    const result = await replaceCurrentAvatar(
      { userId: actor.userId, contaId: actor.contaId },
      avatar,
      correlationId,
    );
    return NextResponse.json(
      { url: result.url },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível atualizar a foto agora.';
    return NextResponse.json(
      { error: { code: 'AVATAR_UPDATE_FAILED', message } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
