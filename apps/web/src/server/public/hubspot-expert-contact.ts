import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { ExpertContactLeadInputDTO } from '@/features/public/dtos';

const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com';
const HUBSPOT_TIMEOUT_MS = 8_000;

type DeliveryState = 'PENDING' | 'NOTE_CREATING' | 'DELIVERED' | 'EXPIRED';
type HubSpotObject = { id?: string; properties?: Record<string, string | null> };
type HubSpotSearchResponse = { results?: HubSpotObject[] };
type HubSpotAssociationTypesResponse = { results?: Array<{ category?: string; typeId?: number; label?: string | null }> };

type PersistedLead = {
  requestId: string;
  payloadHash: string | null;
  state: DeliveryState;
  noteId: string | null;
  noteAttemptedAt: Date | null;
  contactName: string | null;
  email: string | null;
  institutionName: string | null;
  institutionWebsite: string | null;
  phone: string | null;
  institutionType: string | null;
  studentsRange: string | null;
  contactId: string | null;
  companyId: string | null;
  companyAttemptedAt: Date | null;
  dealId: string | null;
  dealAttemptedAt: Date | null;
  taskId: string | null;
  taskAttemptedAt: Date | null;
};

const DEDUPE_WINDOW_MS = 10 * 60_000;

/** The lead is captured locally before any CRM call so a provider outage cannot lose it. */
export type ExpertContactLeadStore = {
  capture(lead: ExpertContactLeadInputDTO, payloadHash: string): Promise<PersistedLead>;
  claimNoteCreation(requestId: string): Promise<boolean>;
  markDelivered(requestId: string, noteId: string): Promise<void>;
  recordRemoteObject(requestId: string, object: 'contact' | 'company' | 'deal', id: string): Promise<void>;
  markRemoteObjectAttempt(requestId: string, object: 'company' | 'deal'): Promise<boolean>;
  clearRemoteObjectAttempt(requestId: string, object: 'company' | 'deal'): Promise<void>;
  markTaskAttempt(requestId: string): Promise<boolean>;
  clearTaskAttempt(requestId: string): Promise<void>;
  recordTask(requestId: string, id: string): Promise<void>;
  markNoteAttempt(requestId: string): Promise<boolean>;
  clearNoteAttempt(requestId: string): Promise<void>;
};

const databaseLeadStore: ExpertContactLeadStore = {
  async capture(lead, payloadHash) {
    return prisma.$transaction(async (tx) => {
      // Serialize equivalent form submissions across instances, even when each tab
      // generated a different request UUID. The bounded window preserves later leads.
      await tx.$queryRaw`WITH lock AS (SELECT pg_advisory_xact_lock(hashtextextended(${payloadHash}, 0))) SELECT 1 FROM lock`;
      const byRequestId = await tx.expertContactLeadDelivery.findUnique({ where: { requestId: lead.requestId } });
      if (byRequestId) return byRequestId as PersistedLead;

      const recentEquivalent = await tx.expertContactLeadDelivery.findFirst({
        where: { payloadHash, updatedAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
        orderBy: { updatedAt: 'desc' },
      });
      if (recentEquivalent) {
        return await tx.expertContactLeadDelivery.update({
          where: { requestId: recentEquivalent.requestId },
          data: { updatedAt: new Date() },
        }) as PersistedLead;
      }

      return tx.expertContactLeadDelivery.create({
        data: {
          requestId: lead.requestId,
          payloadHash,
          contactName: lead.contactName,
          email: lead.email,
          institutionName: lead.institutionName,
          institutionWebsite: lead.institutionWebsite || null,
          phone: lead.phone,
          institutionType: lead.institutionType,
          studentsRange: lead.studentsRange,
        },
      }) as Promise<PersistedLead>;
    });
  },
  async claimNoteCreation(requestId) {
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId, state: 'PENDING' },
      data: { state: 'NOTE_CREATING' },
    });
    return result.count === 1;
  },
  async markDelivered(requestId, noteId) {
    if (!noteId.trim()) throw new HubSpotExpertContactError('invalid_response');
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId, state: 'NOTE_CREATING' },
      data: {
        state: 'DELIVERED',
        noteId,
        deliveredAt: new Date(),
        contactName: null,
        email: null,
        institutionName: null,
        institutionWebsite: null,
        phone: null,
        institutionType: null,
        studentsRange: null,
      },
    });
    if (result.count === 1) return;
    const existing = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { state: true, noteId: true } });
    if (existing?.state === 'DELIVERED' && existing.noteId === noteId) return;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async recordRemoteObject(requestId, object, id) {
    if (!id.trim()) throw new HubSpotExpertContactError('invalid_response');
    const field = object === 'contact' ? 'contactId' : object === 'company' ? 'companyId' : 'dealId';
    const result = await prisma.expertContactLeadDelivery.updateMany({ where: { requestId }, data: { [field]: id } });
    if (result.count !== 1) throw new HubSpotExpertContactError('ambiguous');
  },
  async markRemoteObjectAttempt(requestId, object) {
    const field = object === 'company' ? 'companyAttemptedAt' : 'dealAttemptedAt';
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId, [field]: null }, data: { [field]: new Date() },
    });
    if (result.count === 1) return true;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { [field]: true } });
    if (current?.[field]) return false;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async clearRemoteObjectAttempt(requestId, object) {
    const field = object === 'company' ? 'companyAttemptedAt' : 'dealAttemptedAt';
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId }, data: { [field]: null },
    });
    if (result.count === 1) return;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { [field]: true } });
    if (current && !current[field]) return;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async markTaskAttempt(requestId) {
    const result = await prisma.expertContactLeadDelivery.updateMany({ where: { requestId, taskAttemptedAt: null }, data: { taskAttemptedAt: new Date() } });
    if (result.count === 1) return true;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { taskAttemptedAt: true } });
    if (current?.taskAttemptedAt) return false;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async clearTaskAttempt(requestId) {
    const result = await prisma.expertContactLeadDelivery.updateMany({ where: { requestId }, data: { taskAttemptedAt: null } });
    if (result.count === 1) return;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { taskAttemptedAt: true } });
    if (current && !current.taskAttemptedAt) return;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async recordTask(requestId, id) {
    if (!id.trim()) throw new HubSpotExpertContactError('invalid_response');
    const result = await prisma.expertContactLeadDelivery.updateMany({ where: { requestId, taskId: null }, data: { taskId: id } });
    if (result.count === 1) return;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { taskId: true } });
    if (current?.taskId === id) return;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async markNoteAttempt(requestId) {
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId, noteAttemptedAt: null }, data: { noteAttemptedAt: new Date() },
    });
    if (result.count === 1) return true;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { noteAttemptedAt: true } });
    if (current?.noteAttemptedAt) return false;
    throw new HubSpotExpertContactError('ambiguous');
  },
  async clearNoteAttempt(requestId) {
    const result = await prisma.expertContactLeadDelivery.updateMany({
      where: { requestId }, data: { noteAttemptedAt: null },
    });
    if (result.count === 1) return;
    const current = await prisma.expertContactLeadDelivery.findUnique({ where: { requestId }, select: { noteAttemptedAt: true } });
    if (current && !current.noteAttemptedAt) return;
    throw new HubSpotExpertContactError('ambiguous');
  },
};

export class HubSpotExpertContactError extends Error {
  constructor(
    readonly code: 'not_configured' | 'timeout' | 'provider_error' | 'invalid_response' | 'ambiguous' | 'idempotency_conflict',
  ) {
    super(`HubSpot expert contact delivery failed: ${code}`);
    this.name = 'HubSpotExpertContactError';
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function fingerprint(lead: ExpertContactLeadInputDTO): string {
  const content = [
    lead.contactName,
    lead.email,
    lead.institutionName,
    lead.institutionWebsite || '',
    lead.phone,
    lead.institutionType,
    lead.studentsRange,
  ].join('\u0000');
  return createHash('sha256').update(content).digest('hex');
}

function getContactNameParts(contactName: string) {
  const [firstName, ...lastNameParts] = contactName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(' ') };
}

function createNoteBody(lead: ExpertContactLeadInputDTO) {
  const escapeHtml = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return [
    '<p>Solicitação de atendimento recebida pelo site da Alusa.</p>',
    `<p>Referência do envio: ${escapeHtml(lead.requestId)}</p>`,
    `<p>Contato: ${escapeHtml(lead.contactName)}</p>`,
    `<p>E-mail: ${escapeHtml(lead.email)}</p>`,
    `<p>Instituição: ${escapeHtml(lead.institutionName)}</p>`,
    ...(lead.institutionWebsite ? [`<p>Site: ${escapeHtml(lead.institutionWebsite)}</p>`] : []),
    `<p>Telefone/WhatsApp: ${escapeHtml(lead.phone)}</p>`,
    `<p>Tipo de instituição: ${escapeHtml(lead.institutionType)}</p>`,
    `<p>Faixa estimada de alunos: ${escapeHtml(lead.studentsRange)}</p>`,
  ].join('');
}

function uniqueResultId(results: HubSpotSearchResponse): string | null {
  if (!Array.isArray(results.results) || results.results.length > 1) throw new HubSpotExpertContactError('ambiguous');
  const id = results.results[0]?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function institutionWebsiteDomain(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const url = new URL(website);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || !hostname.includes('.') || hostname === 'localhost') return null;
    return hostname;
  } catch {
    return null;
  }
}

function requireId(object: HubSpotObject | null): string {
  if (typeof object?.id !== 'string' || !object.id.trim()) throw new HubSpotExpertContactError('invalid_response');
  return object.id.trim();
}

export async function submitExpertContactLeadToHubSpot(
  lead: ExpertContactLeadInputDTO,
  options: {
    fetcher?: typeof fetch;
    store?: ExpertContactLeadStore;
  } = {},
): Promise<void> {
  // Self-service leads do not belong in the specialist sales CRM pipeline.
  // Only the explicit >500 route creates Contact, Company, Deal, and Note records.
  if (lead.studentsRange !== 'Mais de 500' || lead.website?.trim()) return;

  const store = options.store ?? databaseLeadStore;
  const persisted = await store.capture(lead, fingerprint(lead));
  if (persisted.payloadHash !== fingerprint(lead)) throw new HubSpotExpertContactError('idempotency_conflict');
  if (persisted.state === 'DELIVERED') return;
  if (persisted.state === 'EXPIRED') throw new HubSpotExpertContactError('ambiguous');
  const canonicalLead = {
    ...lead,
    requestId: persisted.requestId,
    contactName: persisted.contactName,
    email: persisted.email,
    institutionName: persisted.institutionName,
    institutionWebsite: persisted.institutionWebsite ?? undefined,
    phone: persisted.phone,
    institutionType: persisted.institutionType,
    studentsRange: persisted.studentsRange,
  };
  if (Object.values(canonicalLead).some((value) => value === null)) throw new HubSpotExpertContactError('ambiguous');
  const accessToken = process.env.HUBSPOT_PRIVATE_APP_ACCESS_TOKEN;
  if (!accessToken?.trim()) throw new HubSpotExpertContactError('not_configured');

  const fetcher = options.fetcher ?? fetch;
  const expertLead = canonicalLead as ExpertContactLeadInputDTO;
  const noteBody = createNoteBody(expertLead);
  const requestHubSpot = async (path: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HUBSPOT_TIMEOUT_MS);
    try {
      return await fetcher(`${HUBSPOT_API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        cache: 'no-store',
      });
    } catch {
      if (controller.signal.aborted) throw new HubSpotExpertContactError('timeout');
      throw new HubSpotExpertContactError('provider_error');
    } finally {
      clearTimeout(timeout);
    }
  };

  const json = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => null) as T | null;
    if (body === null) throw new HubSpotExpertContactError('invalid_response');
    return body;
  };
  const searchOne = async (object: 'companies' | 'deals' | 'tasks', propertyName: string, value: string) => {
    const response = await requestHubSpot(`/crm/v3/objects/${object}/search`, {
      method: 'POST',
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value }] }], limit: 2 }),
    });
    if (!response.ok) throw new HubSpotExpertContactError('provider_error');
    return uniqueResultId(await json<HubSpotSearchResponse>(response));
  };
  const getAssociationTypeId = async (from: string, to: string): Promise<number> => {
    const response = await requestHubSpot(`/crm/v4/associations/${from}/${to}/labels`, { method: 'GET' });
    if (!response.ok) throw new HubSpotExpertContactError('provider_error');
    const body = await json<HubSpotAssociationTypesResponse>(response);
    const association = body.results?.find((item) => item.category === 'HUBSPOT_DEFINED' && item.label == null && Number.isInteger(item.typeId));
    if (!association?.typeId) throw new HubSpotExpertContactError('invalid_response');
    return association.typeId;
  };
  const associate = async (from: string, fromId: string, to: string, toId: string, typeId: number) => {
    const response = await requestHubSpot(`/crm/v4/objects/${from}/${encodeURIComponent(fromId)}/associations/${to}/${encodeURIComponent(toId)}`, {
      method: 'PUT', body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }]),
    });
    if (!response.ok) throw new HubSpotExpertContactError(response.status === 409 ? 'ambiguous' : 'provider_error');
  };

  // Claim the whole CRM delivery before the first non-idempotent operation.
  // A concurrent request cannot create a second set of records for this requestId.
  if (persisted.state === 'PENDING') {
    const claimed = await store.claimNoteCreation(persisted.requestId);
    if (!claimed) {
      const latest = await store.capture(lead, fingerprint(lead));
      if (latest.state === 'DELIVERED') return;
      throw new HubSpotExpertContactError('ambiguous');
    }
  }

  const existingNoteResponse = await requestHubSpot('/crm/v3/objects/notes/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'hs_note_body', operator: 'EQ', value: noteBody }] }],
      properties: ['hs_note_body'],
      limit: 2,
    }),
  });
  if (!existingNoteResponse.ok) throw new HubSpotExpertContactError('provider_error');
  const existingNote = await json<HubSpotSearchResponse>(existingNoteResponse);
  const existingNoteId = uniqueResultId(existingNote);

  const contactPath = `/crm/v3/objects/contacts/${encodeURIComponent(canonicalLead.email!)}?idProperty=email&properties=email`;
  const createOrFindContact = async (): Promise<HubSpotObject> => {
    const byEmail = await requestHubSpot(contactPath, { method: 'GET' });
    if (byEmail.ok) return json<HubSpotObject>(byEmail);
    if (byEmail.status !== 404) throw new HubSpotExpertContactError('provider_error');
    const { firstName, lastName } = getContactNameParts(canonicalLead.contactName!);
    const created = await requestHubSpot('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties: {
        email: canonicalLead.email,
        firstname: firstName,
        ...(lastName ? { lastname: lastName } : {}),
        company: canonicalLead.institutionName,
        phone: canonicalLead.phone,
      } }),
    });
    if (created.ok) return json<HubSpotObject>(created);
    if (created.status === 409) {
      const racedContact = await requestHubSpot(contactPath, { method: 'GET' });
      if (!racedContact.ok) throw new HubSpotExpertContactError('ambiguous');
      return json<HubSpotObject>(racedContact);
    }
    throw new HubSpotExpertContactError(created.status >= 500 ? 'ambiguous' : 'provider_error');
  };
  let contact: HubSpotObject | null = null;
  if (persisted.contactId) {
    const response = await requestHubSpot(`/crm/v3/objects/contacts/${encodeURIComponent(persisted.contactId)}?properties=email,firstname,lastname,phone,company`, { method: 'GET' });
    if (response.ok) contact = await json<HubSpotObject>(response);
    else if (response.status === 404) contact = await createOrFindContact();
    else throw new HubSpotExpertContactError('provider_error');
  } else {
    contact = await createOrFindContact();
  }
  const contactId = requireId(contact);
  await store.recordRemoteObject(persisted.requestId, 'contact', contactId);
  const { firstName, lastName } = getContactNameParts(canonicalLead.contactName!);
  const contactProperties: Record<string, string> = {};
  if (!contact.properties?.firstname) contactProperties.firstname = firstName;
  if (lastName && !contact.properties?.lastname) contactProperties.lastname = lastName;
  if (!contact.properties?.phone) contactProperties.phone = canonicalLead.phone!;
  if (!contact.properties?.company) contactProperties.company = canonicalLead.institutionName!;
  if (Object.keys(contactProperties).length) {
    const update = await requestHubSpot(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH', body: JSON.stringify({ properties: contactProperties }),
    });
    if (!update.ok) throw new HubSpotExpertContactError('provider_error');
  }

  const companyDomain = institutionWebsiteDomain(canonicalLead.institutionWebsite);
  const findCompany = () => searchOne('companies', companyDomain ? 'domain' : 'name', companyDomain ?? canonicalLead.institutionName!);
  let companyId = persisted.companyId;
  if (!companyId) {
    if (persisted.companyAttemptedAt) {
      // Search indexing can lag. Never repeat an ambiguous create after a negative search.
      companyId = await findCompany();
      if (!companyId) throw new HubSpotExpertContactError('ambiguous');
    } else {
      companyId = await findCompany();
      if (!companyId) {
        const claimedCreate = await store.markRemoteObjectAttempt(persisted.requestId, 'company');
        if (!claimedCreate) {
          companyId = await findCompany();
          if (!companyId) throw new HubSpotExpertContactError('ambiguous');
        } else {
          const properties = { name: canonicalLead.institutionName!, ...(companyDomain ? { domain: companyDomain } : {}) };
          let response: Response;
          try {
            response = await requestHubSpot('/crm/v3/objects/companies', { method: 'POST', body: JSON.stringify({ properties }) });
          } catch {
            throw new HubSpotExpertContactError('ambiguous');
          }
          if (response.status === 409) {
            companyId = await findCompany();
            if (!companyId) throw new HubSpotExpertContactError('ambiguous');
          } else if (response.ok) {
            companyId = requireId(await json<HubSpotObject>(response));
          } else {
            if (response.status >= 500 || response.status === 408) throw new HubSpotExpertContactError('ambiguous');
            await store.clearRemoteObjectAttempt(persisted.requestId, 'company');
            throw new HubSpotExpertContactError('provider_error');
          }
        }
      }
    }
  }
  if (!companyId) throw new HubSpotExpertContactError('ambiguous');
  await store.recordRemoteObject(persisted.requestId, 'company', companyId);

  let dealId: string | null = null;
  if (canonicalLead.studentsRange === 'Mais de 500') {
    const dealDescription = `Alusa expert lead ${persisted.requestId}\nSolicitação de atendimento especializado acima de 500 alunos.`;
    dealId = persisted.dealId;
    if (!dealId) {
      if (persisted.dealAttemptedAt) {
        dealId = await searchOne('deals', 'description', dealDescription);
        if (!dealId) throw new HubSpotExpertContactError('ambiguous');
      } else {
        dealId = await searchOne('deals', 'description', dealDescription);
        if (!dealId) {
          const claimedCreate = await store.markRemoteObjectAttempt(persisted.requestId, 'deal');
          if (!claimedCreate) {
            dealId = await searchOne('deals', 'description', dealDescription);
            if (!dealId) throw new HubSpotExpertContactError('ambiguous');
          } else {
            let response: Response;
            try {
              response = await requestHubSpot('/crm/v3/objects/deals', {
                method: 'POST',
                body: JSON.stringify({ properties: {
                  dealname: `Atendimento especializado — ${canonicalLead.institutionName}`,
                  pipeline: 'default',
                  dealstage: 'qualifiedtobuy',
                  description: dealDescription,
                  ...(process.env.HUBSPOT_EXPERT_CONTACT_OWNER_ID?.trim() ? { hubspot_owner_id: process.env.HUBSPOT_EXPERT_CONTACT_OWNER_ID.trim() } : {}),
                } }),
              });
            } catch {
              throw new HubSpotExpertContactError('ambiguous');
            }
            if (response.status === 409) {
              dealId = await searchOne('deals', 'description', dealDescription);
              if (!dealId) throw new HubSpotExpertContactError('ambiguous');
            } else if (response.ok) {
              dealId = requireId(await json<HubSpotObject>(response));
            } else {
              if (response.status >= 500 || response.status === 408) throw new HubSpotExpertContactError('ambiguous');
              await store.clearRemoteObjectAttempt(persisted.requestId, 'deal');
              throw new HubSpotExpertContactError('provider_error');
            }
          }
        }
      }
    }
    if (!dealId) throw new HubSpotExpertContactError('ambiguous');
    await store.recordRemoteObject(persisted.requestId, 'deal', dealId);
  }

  const contactCompanyType = await getAssociationTypeId('contacts', 'companies');
  await associate('contacts', contactId, 'companies', companyId, contactCompanyType);
  if (dealId) {
    const [dealCompanyType, dealContactType] = await Promise.all([
      getAssociationTypeId('deals', 'companies'),
      getAssociationTypeId('deals', 'contacts'),
    ]);
    await Promise.all([
      associate('deals', dealId, 'companies', companyId, dealCompanyType),
      associate('deals', dealId, 'contacts', contactId, dealContactType),
    ]);
    const taskBody = `Acompanhar lead público ${persisted.requestId}`;
    let taskId = persisted.taskId;
    if (!taskId) {
      if (persisted.taskAttemptedAt) {
        taskId = await searchOne('tasks', 'hs_task_body', taskBody);
        if (!taskId) throw new HubSpotExpertContactError('ambiguous');
        await store.recordTask(persisted.requestId, taskId);
      } else {
        const claimed = await store.markTaskAttempt(persisted.requestId);
        if (!claimed) throw new HubSpotExpertContactError('ambiguous');
        let response: Response;
        try {
          response = await requestHubSpot('/crm/v3/objects/tasks', { method: 'POST', body: JSON.stringify({ properties: {
            hs_task_subject: `Follow-up: ${canonicalLead.institutionName}`,
            hs_task_body: taskBody,
            hs_task_status: 'NOT_STARTED',
            hs_task_priority: 'HIGH',
            hs_timestamp: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
            ...(process.env.HUBSPOT_EXPERT_CONTACT_OWNER_ID?.trim() ? { hubspot_owner_id: process.env.HUBSPOT_EXPERT_CONTACT_OWNER_ID.trim() } : {}),
          } }) });
        } catch { throw new HubSpotExpertContactError('ambiguous'); }
        if (response.status === 409) {
          taskId = await searchOne('tasks', 'hs_task_body', taskBody);
          if (!taskId) throw new HubSpotExpertContactError('ambiguous');
          await store.recordTask(persisted.requestId, taskId);
        } else if (!response.ok) {
          if (response.status >= 500 || response.status === 408) throw new HubSpotExpertContactError('ambiguous');
          await store.clearTaskAttempt(persisted.requestId);
          throw new HubSpotExpertContactError('provider_error');
        } else {
          taskId = requireId(await json<HubSpotObject>(response));
          await store.recordTask(persisted.requestId, taskId);
        }
      }
    }
    const taskDealType = await getAssociationTypeId('tasks', 'deals');
    await associate('tasks', taskId, 'deals', dealId, taskDealType);
  }

  if (existingNoteId) {
    const [noteContactType, noteCompanyType] = await Promise.all([
      getAssociationTypeId('notes', 'contacts'),
      getAssociationTypeId('notes', 'companies'),
    ]);
    const noteAssociations: Promise<void>[] = [
      associate('notes', existingNoteId, 'contacts', contactId, noteContactType),
      associate('notes', existingNoteId, 'companies', companyId, noteCompanyType),
    ];
    if (dealId) {
      const noteDealType = await getAssociationTypeId('notes', 'deals');
      noteAssociations.push(associate('notes', existingNoteId, 'deals', dealId, noteDealType));
    }
    await Promise.all(noteAssociations);
    await store.markDelivered(persisted.requestId, existingNoteId);
    return;
  }
  if (persisted.noteAttemptedAt) throw new HubSpotExpertContactError('ambiguous');
  const claimedNoteCreate = await store.markNoteAttempt(persisted.requestId);
  if (!claimedNoteCreate) throw new HubSpotExpertContactError('ambiguous');

  let noteResponse: Response;
  try {
    noteResponse = await requestHubSpot('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteBody },
        associations: await Promise.all([
          ['contacts', contactId],
          ['companies', companyId],
          ...(dealId ? [['deals', dealId]] : []),
        ].map(async ([objectType, id]) => ({
          to: { id },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: await getAssociationTypeId('notes', objectType) }],
        }))),
      }),
    });
  } catch {
    // Even a network error can happen after HubSpot committed the POST.
    throw new HubSpotExpertContactError('ambiguous');
  }
  if (!noteResponse.ok) {
    if (noteResponse.status >= 500 || noteResponse.status === 408 || noteResponse.status === 409) {
      throw new HubSpotExpertContactError('ambiguous');
    }
    await store.clearNoteAttempt(persisted.requestId);
    throw new HubSpotExpertContactError('provider_error');
  }
  const createdNote = await noteResponse.json().catch(() => null) as { id?: string } | null;
  if (typeof createdNote?.id !== 'string' || !createdNote.id.trim()) throw new HubSpotExpertContactError('ambiguous');
  await store.markDelivered(persisted.requestId, createdNote.id.trim());
}
