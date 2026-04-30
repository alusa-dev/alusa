/**
 * Formata data para dd/MM/yyyy
 */
export function formatDate(date) {
    if (!date)
        return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime()))
        return null;
    return d.toLocaleDateString('pt-BR');
}
/**
 * Formata data para yyyy-MM-dd (ISO)
 */
export function formatDateISO(date) {
    if (!date)
        return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime()))
        return null;
    return d.toISOString().split('T')[0];
}
/**
 * Adiciona dias a uma data
 */
export function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
/**
 * Adiciona meses a uma data
 */
export function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}
