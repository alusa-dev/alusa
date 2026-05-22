export type PersonType = 'PF' | 'PJ' | 'UNKNOWN';
export declare function onlyDigits(value: string): string;
export declare function normalizeCpfCnpjDigits(value: string | null | undefined): string;
export declare function detectPersonType(cpfCnpj: string | null | undefined): PersonType;
//# sourceMappingURL=cpf-cnpj.d.ts.map