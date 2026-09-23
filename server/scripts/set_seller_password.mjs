import { hashPassword } from '../seller_auth.js';
import { saveLocalSettings } from '../local_credentials.js';

if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal. Passwords are never accepted in command arguments.');
const password = await new Promise(resolve => {
  process.stdout.write('New seller password (at least 14 characters): ');
  let value = '';
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  function read(chunk) {
    for (const char of chunk) {
      if (char === '\u0003') process.exit(130);
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', read); process.stdout.write('\n'); resolve(value); return;
      }
      if (char === '\u007f') value = value.slice(0, -1);
      else if (char >= ' ' && value.length < 256) value += char;
    }
  }
  process.stdin.on('data', read);
});
if (password.length < 14) throw new Error('Use at least 14 characters.');
await saveLocalSettings({ CUSTOMER_SETUP_PASSWORD_HASH: await hashPassword(password), CUSTOMER_SETUP_PASSWORD_MUST_CHANGE: 'false' });
console.log('Seller password saved. Restart Customer Setup to invalidate old sessions.');
