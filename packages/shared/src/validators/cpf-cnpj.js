export function onlyDigits(value) {
    return value.replace(/\D/g, '');
}
export function normalizeCpfCnpjDigits(value) {
    return onlyDigits(value ?? '');
}
export function detectPersonType(cpfCnpj) {
    const digits = normalizeCpfCnpjDigits(cpfCnpj);
    if (digits.length === 11)
        return 'PF';
    if (digits.length === 14)
        return 'PJ';
    return 'UNKNOWN';
}
