import axios from "axios";
import crypto from "crypto";

// 1) Buscar do banco (exemplo)
async function getEncryptedKeyFromDB() {
  // TODO: implemente sua query ao banco e retorne a string criptografada
  // ex: "ivHex:encryptedHex" ou o formato que você tem
  throw new Error("Implemente getEncryptedKeyFromDB()");
}

// 2) Descriptografar (AJUSTE ao seu formato real)
function decryptAes256Cbc_ivHex_encryptedHex(cipherText, encryptionKeyHex) {
  // Espera formato: ivHex:encryptedHex
  const [ivHex, encryptedHex] = cipherText.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Formato esperado: ivHex:encryptedHex");

  const key = Buffer.from(encryptionKeyHex, "hex"); // 32 bytes => 64 hex chars
  const iv = Buffer.from(ivHex, "hex");             // 16 bytes => 32 hex chars
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

async function main() {
  const customerId = "cus_000007456248";
  const baseURL = "https://sandbox.asaas.com/api/v3";

  // ENCRYPTION_KEY (hex) vem do seu runtime (env/secret manager)
  const encryptionKeyHex = process.env.ENCRYPTION_KEY_HEX;
  if (!encryptionKeyHex) throw new Error("Faltou ENCRYPTION_KEY_HEX no ambiente");

  const encryptedApiKey = await getEncryptedKeyFromDB();

  // Se o seu formato NÃO for ivHex:encryptedHex, NÃO use essa função.
  const asaasApiKey = decryptAes256Cbc_ivHex_encryptedHex(encryptedApiKey, encryptionKeyHex);

  // NÃO logue a chave; só use
  const api = axios.create({
    baseURL,
    headers: { access_token: asaasApiKey },
    timeout: 15000,
  });

  try {
    const res = await api.get(`/customers/${customerId}`);
    console.log("Customer encontrado:");
    console.log(res.data);
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error("Falha ao consultar customer:", status, data || err.message);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
