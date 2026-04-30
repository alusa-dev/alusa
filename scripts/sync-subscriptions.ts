
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Chave do ambiente local.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('Missing required encryption configuration.');
}

function decrypt(encoded: string): string {
  const raw = ENCRYPTION_KEY;
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  const parts = encoded.split(':');
  if (parts.length < 4) return '';
  const [ivHex, , authTagHex, encryptedHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

interface AsaasPayment {
  id: string;
  dateCreated: string;
  customer: string;
  paymentLink: string | null;
  value: number;
  netValue: number;
  originalValue: number | null;
  interestValue: number | null;
  dueDate: string;
  billingType: string;
  status: string;
  externalReference: string | null;
  description: string | null;
  creditDate: string | null;
  estimatedCreditDate: string | null;
  installmentNumber: number | null;
}

async function fetchSubscriptionPayments(apiKey: string, subscriptionId: string): Promise<AsaasPayment[]> {
  const allPayments: AsaasPayment[] = [];
  let offset = 0;
  const limit = 20;
  
  while (true) {
    const res = await fetch(`https://api-sandbox.asaas.com/v3/subscriptions/${subscriptionId}/payments?limit=${limit}&offset=${offset}`, {
      headers: {
        'access_token': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) return [];
      console.error(`Status ${res.status}:`, await res.text());
      throw new Error(`Erro ao buscar payments da assinatura ${subscriptionId}: ${res.status}`);
    }

    const data = await res.json();
    const payments = (data.data || []) as AsaasPayment[];
    allPayments.push(...payments);
    
    if (!data.hasMore) break;
    offset += limit;
  }

  return allPayments;
}

function mapAsaasStatus(status: string): any {
  // Mapeia para StatusCobranca do Prisma
  switch(status) {
    case 'PENDING': return 'PENDENTE';
    case 'RECEIVED': 
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH': return 'PAGO';
    case 'OVERDUE': return 'ATRASADO';
    case 'REFUNDED': return 'ESTORNADO';
    case 'DELETED': 
    case 'CANCELLED': 
    case 'CANCELED': return 'CANCELADO'; // Asaas 'CANCELED' vs local (?)
    default: return 'PENDENTE';
  }
}

function mapToChargeStatus(status: string): any {
    // ChargeStatus enum: CREATED, OPEN, PAID, OVERDUE, CANCELED, REFUNDED
    switch(status) {
        case 'PENDING': return 'OPEN';
        case 'RECEIVED': 
        case 'CONFIRMED':
        case 'RECEIVED_IN_CASH': return 'PAID';
        case 'OVERDUE': return 'OVERDUE';
        case 'REFUNDED': return 'REFUNDED';
        case 'DELETED':
        case 'CANCELLED':
        case 'CANCELED': return 'CANCELED';
        default: return 'OPEN';
    }
}

async function main() {
  console.log('Iniciando sync de Assinaturas...');

  const subs = await prisma.subscription.findMany({
    where: { asaasSubscriptionId: { not: null } },
    include: { conta: true, matricula: true }
  });

  console.log(`Encontradas ${subs.length} assinaturas com ID Asaas.`);

  // Agrupar por conta para pegar API key
  const contasMap = new Map<string, string>();

  for (const sub of subs) {
    if (!contasMap.has(sub.contaId)) {
        const acc = await prisma.asaasAccount.findFirst({
            where: { 
                financeProfile: {
                    contaId: sub.contaId 
                }
            }
        });
        if (acc?.apiKeyEncrypted) {
            try {
                const key = decrypt(acc.apiKeyEncrypted);
                contasMap.set(sub.contaId, key);
            } catch (e) {
                console.error(`Falha ao descriptografar conta ${sub.contaId}`);
            }
        }
    }
  }

  for (const sub of subs) {
    const apiKey = contasMap.get(sub.contaId);
    if (!apiKey) {
        console.log(`Pular Sub ${sub.id} (Sem API Key)`);
        continue;
    }

    if (!sub.externalReference) {
        console.log(`Sub ${sub.id} sem externalReference, ignorando linking smart.`);
        continue;
    }

    console.log(`Sync Sub ${sub.id} (${sub.asaasSubscriptionId})...`);
    
    try {
        const payments = await fetchSubscriptionPayments(apiKey, sub.asaasSubscriptionId!);
        console.log(`  -> ${payments.length} pagamentos encontrados no Asaas.`);

        let idx = 0;
        for (const pay of payments) {
             idx++;
             const existingCharge = await prisma.charge.findFirst({
                 where: { asaasPaymentId: pay.id }
             });

             // Gerar external ref de vinculação se não tiver
             // Formato: {sub.externalReference}_pay_{idx}
             // Ex: subscription:XYZ_pay_1
             // MAS tem que ser consistente. Idealmente usar o ID do pagamento se possível, mas 
             // o Route vai filtrar por "startsWith baseRef".
             // BaseRef = sub.externalReference (ex: subscription:XYZ)
             
             // Vamos usar sufixo "_pay_<idx>" ordenando por vencimento ou criação?
             // Asaas retorna por ordem de vencimento default? 
             // Vamos usar o número da parcela se disponível.
             
             const suffix = `_pay_${idx}`;
             const desiredRef = `${sub.externalReference}${suffix}`;

             let cobrancaId = existingCharge?.cobrancaId;
             
             // 1. Upsert Cobranca
             if (!cobrancaId) {
                 // Tenta achar cobranca solta pelo asaasId
                 const c = await prisma.cobranca.findFirst({ where: { asaasPaymentId: pay.id }});
                 if (c) cobrancaId = c.id;
             }
             
             // Se ainda não tem cobrança, criar ou atualizar
             const statusCobranca = mapAsaasStatus(pay.status);
             const vencimento = new Date(pay.dueDate);
             
             // Se existe cobrança, update. Se não, create.
             if (cobrancaId) {
                 await prisma.cobranca.update({
                     where: { id: cobrancaId },
                     data: {
                         status: statusCobranca,
                         valor: pay.value,
                         vencimento: vencimento,
                         dataPagamento: pay.creditDate ? new Date(pay.creditDate) : null,
                         asaasPaymentId: pay.id
                     }
                 });
             } else {
                 const newCob = await prisma.cobranca.create({
                     data: {
                         matriculaId: sub.matriculaId,
                         contaId: sub.contaId,
                         tipo: 'MENSALIDADE', // Assinatura gera mensalidade/recorrente
                         valor: pay.value,
                         vencimento: vencimento,
                         status: statusCobranca,
                         asaasPaymentId: pay.id,
                         competenciaInicio: vencimento,
                         competenciaFim: vencimento
                     }
                 });
                 cobrancaId = newCob.id;
             }

             // 2. Upsert Charge
             const chargeStatus = mapToChargeStatus(pay.status);
             
             if (existingCharge) {
                 // Atualizar link
                 await prisma.charge.update({
                     where: { id: existingCharge.id },
                     data: {
                         cobrancaId,
                         status: chargeStatus,
                         externalReference: existingCharge.externalReference.startsWith(sub.externalReference) 
                            ? existingCharge.externalReference 
                            : desiredRef // Força link se não estiver linkado
                     }
                 });
             } else {
                 await prisma.charge.create({
                     data: {
                         contaId: sub.contaId,
                         cobrancaId,
                         asaasPaymentId: pay.id,
                         externalReference: desiredRef,
                         status: chargeStatus,
                         value: pay.value,
                         dueDate: vencimento,
                         description: pay.description,
                         payerName: sub.matricula.aluno?.nome 
                     }
                 });
             }
        }
    } catch (e) {
        console.error(`Erro ao sync sub ${sub.id}:`, e);
    }
  }
}

main();
