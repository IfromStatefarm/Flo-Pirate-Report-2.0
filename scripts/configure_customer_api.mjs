import fs from 'node:fs/promises';

const settingsUrl = new URL('../config/customer_bootstrap.json', import.meta.url);
const argument = String(process.argv[2] || '').trim();

if (!argument) {
  throw new Error('Usage: npm run configure:api -- https://YOUR-DEPLOYMENT.example');
}

if (argument === '--clear') {
  await fs.writeFile(settingsUrl, `${JSON.stringify({
    schemaVersion: 1,
    bootstrapEndpoint: '',
    membershipEndpoint: '',
    dataEndpoint: ''
  }, null, 2)}\n`);
  console.log('Customer API endpoints cleared. The extension will fail closed until reconfigured.');
  process.exit(0);
}

let base;
try {
  base = new URL(argument);
} catch {
  throw new Error('The deployment address is not a valid URL.');
}

if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
  throw new Error('Use a credential-free HTTPS deployment address without a query or fragment.');
}
if (!['', '/'].includes(base.pathname)) {
  throw new Error('Pass only the deployment origin, for example https://rights-reporter-api.vercel.app.');
}

const endpoint = (path) => new URL(path, base.origin).href;
const settings = {
  schemaVersion: 1,
  bootstrapEndpoint: endpoint('/api/v1/extension/bootstrap'),
  membershipEndpoint: endpoint('/api/v1/extension/memberships'),
  dataEndpoint: endpoint('/api/v1/extension/data')
};

await fs.writeFile(settingsUrl, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`Customer API endpoints configured for ${base.origin}.`);
