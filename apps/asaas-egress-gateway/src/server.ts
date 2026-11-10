import { createServer } from 'node:http';
import { handleRefundRequest, validateGatewaySecret } from './refund-gateway';

const secret = process.env.ASAAS_REFUND_GATEWAY_SECRET;
if (!secret || process.env.ASAAS_REFUND_GATEWAY_ENABLED !== 'true') throw new Error('Gateway disabled: configure opt-in environment variables.');
validateGatewaySecret(secret);
const nonceDirectory = process.env.ASAAS_REFUND_GATEWAY_NONCE_DIR ?? '/var/lib/alusa-asaas-gateway/nonces';
const port = Number(process.env.PORT ?? 8080);
createServer((req, res) => { void handleRefundRequest(req, res, { secret, nonceDirectory }); }).listen(port, '127.0.0.1');
