import '@testing-library/jest-dom';

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
