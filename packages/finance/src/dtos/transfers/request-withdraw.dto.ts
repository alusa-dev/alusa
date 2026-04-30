import { z } from 'zod';

/**
 * DTO de entrada para solicitação de saque/transferência
 * Campos monetários como STRING para evitar problemas de precisão JSON
 */

const pixDestinationSchema = z.object({
  type: z.literal('PIX'),
  pixAddressKey: z.string().min(1, 'Chave PIX é obrigatória'),
  pixAddressKeyType: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']),
  saveRecipient: z.boolean().optional(),
});

const bankAccountDestinationSchema = z.object({
  type: z.literal('BANK_ACCOUNT'),
  bank: z.object({ code: z.string().min(1, 'Código do banco é obrigatório') }),
  accountName: z.string().min(1, 'Nome da conta é obrigatório').optional(),
  ownerName: z.string().min(1, 'Nome do titular é obrigatório'),
  ownerBirthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD')
    .optional(),
  cpfCnpj: z.string().min(11, 'CPF/CNPJ inválido'),
  agency: z.string().min(1, 'Agência é obrigatória'),
  account: z.string().min(1, 'Conta é obrigatória'),
  accountDigit: z.string().min(1, 'Dígito da conta é obrigatório'),
  bankAccountType: z.enum(['CONTA_CORRENTE', 'CONTA_POUPANCA']).optional(),
  ispb: z.string().min(1, 'ISPB inválido').optional(),
});

export const requestWithdrawDTOSchema = z
  .object({
    /** Valor em string decimal, ex: "150.00" */
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Formato inválido. Use ex: "150.00"')
      .refine((v) => parseFloat(v) > 0, 'Valor deve ser maior que zero'),
    destination: z.discriminatedUnion('type', [pixDestinationSchema, bankAccountDestinationSchema]),
    description: z.string().max(140).optional(),
    /** Data agendada no formato YYYY-MM-DD */
    scheduleDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD')
      .optional(),
  })
  .strict();

export type RequestWithdrawDTO = z.infer<typeof requestWithdrawDTOSchema>;

export type PixDestinationDTO = z.infer<typeof pixDestinationSchema>;
export type BankAccountDestinationDTO = z.infer<typeof bankAccountDestinationSchema>;
export type WithdrawDestinationDTO = PixDestinationDTO | BankAccountDestinationDTO;
