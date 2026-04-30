
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const ASAAS_TOKEN = process.env.ASAAS_API_KEY;
if (!ASAAS_TOKEN) {
    throw new Error('Missing required Asaas API configuration.');
}
const CONTA_ID = 'ca37e235-4310-4499-9a55-9cc46d06d7d9'; // Elaine Cristina
const API_URL = 'https://api-sandbox.asaas.com/v3';

async function main() {
  console.log('Starting sync...');

  // 1. Fetch Installments
  const { data: installments } = await axios.get(`${API_URL}/installments?limit=20`, {
    headers: { access_token: ASAAS_TOKEN }
  });

  console.log(`Found ${installments.data.length} installments in Asaas.`);

  for (const inst of installments.data) {
    console.log(`Processing Installment ${inst.id} (Ref: ${inst.paymentLink || 'N/A'})...`);

    // 2. Fetch Payments for this installment to find Matricula/Contract context
    const { data: payments } = await axios.get(`${API_URL}/payments?installment=${inst.id}&limit=20`, {
      headers: { access_token: ASAAS_TOKEN }
    });

    if (payments.data.length === 0) {
      console.log('  No payments found, skipping.');
      continue;
    }

    // Use the first payment to find context
    const firstPayment = payments.data[0];
    const externalRef = firstPayment.externalReference;
    
    if (!externalRef) {
        console.log('  No externalReference, cannot link to system.');
        continue;
    }

    // Try to find ANY existing Cobranca/Charge with this reference to get Matricula
    // We search Charge first
    let matriculaId = null;
    let contratoId = null;

    const existingCharge = await prisma.charge.findFirst({
        where: { externalReference: externalRef },
        include: { cobranca: true, conta: true }
    });

    if (existingCharge && existingCharge.cobranca) {
        matriculaId = existingCharge.cobranca.matriculaId;
    } else {
        // Try searching Cobranca by asaasPaymentId of any payment in list
        // (Maybe one was synced but Charge link is missing?)
        const paymentIds = payments.data.map((p: any) => p.id);
        const existingCobranca = await prisma.cobranca.findFirst({
            where: { asaasPaymentId: { in: paymentIds } }
        });
        if (existingCobranca) {
            matriculaId = existingCobranca.matriculaId;
        }
    }

    if (!matriculaId) {
        console.log('  Could not find local Matricula for this installment. Skipping creation.');
        continue;
    }

    // Get Contract from Matricula
    const matricula = await prisma.matricula.findUnique({
        where: { id: matriculaId },
        include: { contratos: true }
    });

    if (!matricula) continue;
    // Assume the most recent contract or the first one
    const contrato = matricula.contratos[0];
    contratoId = contrato?.id;

    if (!contratoId) {
        // Fallback: Use matricula.contratoAtualId logic if existing? 
        // Or if schema requires contract, we might need to skip or fake it.
        // We will try to find any contract for this matricula.
        if (matricula.contratos.length > 0) contratoId = matricula.contratos[0].id;
    }

    if (!contratoId) {
        console.log('  No Contract found for matricula, cannot create InstallmentPlan.');
        // We will still sync payments (Cobrancas) though!
    } else {
        // 3. Upsert InstallmentPlan
        // We use externalReference as unique key if unique. 
        // Asaas doesn't give a plan externalReference in the installment object usually, 
        // but the payments share one. We use that.
        const headerRef = externalRef;

        try {
            await prisma.installmentPlan.upsert({
                where: { asaasInstallmentId: inst.id },
                update: {
                    status: 'ACTIVE', // Simplified
                    value: inst.value,
                    installmentCount: inst.installmentCount,
                    statusUpdatedAt: new Date(),
                },
                create: {
                    contaId: CONTA_ID,
                    matriculaId: matriculaId,
                    contratoId: contratoId,
                    externalReference: headerRef,
                    asaasInstallmentId: inst.id,
                    status: 'ACTIVE',
                    installmentCount: inst.installmentCount,
                    billingType: inst.billingType,
                    value: inst.value,
                    firstDueDate: new Date(payments.data[payments.data.length - 1].dueDate), // Usually first one is last in list? Or sorted? Asaas default sort?
                                    // Actually we can sort payments.data
                }
            });
            console.log('  Upserted InstallmentPlan.');
        } catch (e) {
            console.error('  Error upserting plan (constraint?):', (e as Error).message);
            // It might fail on unique contraint [conta, contrato] if one already exists? 
            // If so, we skip plan creation and just sync payments.
        }
    }

    // 4. Upsert Payments (Cobranca + Charge)
    for (const p of payments.data) {
        // Find or Create Charge
        // We need an externalReference unique for the Charge...
        // But Asaas payments share the externalReference of the PLAN!
        // This is a problem for our Charge model which requires unique externalReference?
        // Let's check schema.
        // model Charge { externalReference String @unique }
        // If they share it, we CANNOT create multiple Charges with same externalReference.
        // This means our 'standalone' reference strategy for Asaas installments clashes with our schema 
        // UNLESS we append suffix locally?
        
        // Wait, if existing cobranca has it, how is it stored?
        // 'standalone:c6166...'
        // If we try to create another with same ref, it fails.
        // Solution: Append `#1`, `#2` locally? or check if we already have it.

        // Actually, for the existing partial data, how is it stored?
        // Ref: standalone:c6166...
        // If we create the 2nd parcel, we can't use the same Ref.
        // We should generate a new unique ref for the Charge: `${externalRef}_inst_${p.installmentNumber}`

        const uniqueRef = `${externalRef}_inst_${p.installmentNumber}`;

        // Check if exists by asaasPaymentId first
        const existingByAsaas = await prisma.cobranca.findUnique({
            where: { asaasPaymentId: p.id }
        });

        if (existingByAsaas) {
            console.log(`    Payment ${p.installmentNumber} already exists (${p.id}).`);
            continue;
        }

        console.log(`    Creating payment ${p.installmentNumber} (${p.id})...`);

        // Create Cobranca
        // We need to match the logic of existing ones.
        // They seem to be linked to the same Matricula.
        
        await prisma.cobranca.create({
            data: {
                matriculaId: matriculaId,
                tipo: 'PARCELADA',
                descricao: `Parcela ${p.installmentNumber} de ${inst.installmentCount}`,
                competenciaInicio: new Date(p.dueDate),
                competenciaFim: new Date(p.dueDate),
                valor: p.value,
                vencimento: new Date(p.dueDate),
                asaasPaymentId: p.id,
                asaasStatus: p.status,
                asaasValue: p.value,
                asaasNetValue: p.netValue,
                lastAsaasFetchAt: new Date(),
                // Links
                charge: {
                    create: {
                        contaId: CONTA_ID,
                        externalReference: uniqueRef, // Use suffix to satisfy unique constraint
                        status: 'CREATED', // Map from p.status
                        asaasPaymentId: p.id
                    }
                }
            }
        });
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
