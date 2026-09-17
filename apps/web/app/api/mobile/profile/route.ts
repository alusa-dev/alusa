import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { prepareAvatarFile, replaceCurrentAvatar } from '@/features/account/server/avatar-service';
import {
  mobileLegacyProfileUpdateInputDTOSchema,
  mobileProfileUpdateInputDTOSchema,
} from '@/features/mobile/dtos';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { normalizeAccountTimeZone } from '@/src/server/aulas/calendar/account-timezone';
import {
  getActiveMobileMembership,
  getMobileProfile,
  updateLegacyMobileProfile,
  updateMobileProfile,
  type MobileActor,
} from '@/src/server/mobile/profile.service';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

async function getMobileActor(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
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

  const membership = await getActiveMobileMembership(actor);
  if (!membership) return unauthorized();

  const body = await request.json().catch(() => null);

  // Keep the original small contract used by the session/profile bootstrap.
  const legacyParsed = mobileLegacyProfileUpdateInputDTOSchema.safeParse(body);
  if (legacyParsed.success) {
    const legacyProfile = await updateLegacyMobileProfile(actor, legacyParsed.data.name);
    if (!legacyProfile) return unauthorized();

    return NextResponse.json(
      {
        user: {
          name: legacyParsed.data.name,
          foto: legacyProfile.foto,
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = mobileProfileUpdateInputDTOSchema.safeParse(body);
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

  const updatedProfile = await updateMobileProfile({ actor, userData, schoolData });

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

  const profile = await getMobileProfile(actor);
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

  const membership = await getActiveMobileMembership(actor);
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
