/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3001'
  }
};

export default config;
