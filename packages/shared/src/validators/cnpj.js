export function isValidCnpj(cnpj) {
    const digits = (cnpj ?? '').replace(/\D/g, '');
    if (digits.length !== 14)
        return false;
    if (/^(\d)\1{13}$/.test(digits))
        return false;
    const calcDigit = (base, weights) => {
        let sum = 0;
        for (let i = 0; i < weights.length; i += 1) {
            sum += Number(base[i]) * weights[i];
        }
        const mod = sum % 11;
        return mod < 2 ? 0 : 11 - mod;
    };
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d1 = calcDigit(digits.slice(0, 12), weights1);
    const d2 = calcDigit(digits.slice(0, 13), weights2);
    return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}
