import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Replace only the named settings. Never print or overwrite unrelated secrets.
export async function saveLocalSettings(values, filename = path.resolve('.env.local')) {
  let contents = await fs.readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z_]+$/.test(key) || /[\r\n"]/.test(value)) throw new Error('Invalid local setting.');
    const line = `${key}="${value}"`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    contents = regex.test(contents) ? contents.replace(regex, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  const temp = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, filename);
  } finally { await fs.unlink(temp).catch(() => {}); }
}
