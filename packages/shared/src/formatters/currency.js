/**
 * Formata valor para moeda brasileira
 */
export function formatCurrency(value) {
    if (value === null || value === undefined)
        return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
}
/**
 * Converte string de moeda para número
 */
export function parseCurrency(value) {
    if (!value)
        return 0;
    const cleaned = value.replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}
