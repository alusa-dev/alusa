/**
 * Carrega credenciais descriptografadas do Asaas
 */
export declare function loadAsaasCredentials(contaId: string): Promise<{
    apiKey: string;
    webhookSecret: string | null;
} | null>;
/**
 * Verifica se Asaas está habilitado para conta
 */
export declare function isAsaasEnabled(contaId: string): Promise<boolean>;
//# sourceMappingURL=conta.repository.d.ts.map