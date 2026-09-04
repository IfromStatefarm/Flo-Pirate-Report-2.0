import { execFileSync } from 'node:child_process';

const patterns = [
  'FloSports', 'flosports', 'FloReporter_logo', 'copyright@flosports.tv',
  'social@flosports.tv', '5122702356', '#ce0e2d', '#CE0E2D',
  'varsity', 'milesplit', '1kp5n1F0cO57P3mbUsgmssXTRIQ3UPdkO6vOKUjV_XvY'
];

const args = [
  '-n', '-i', '--hidden', '--glob', '!.git/**', '--glob', '!lib/**',
  '--glob', '!stabilization/**', '--glob', '!migrations/**', '--glob', '!tests/**',
  '--glob', '!docs/**', '--glob', '!scripts/audit_flosports_fallbacks.mjs',
  '--glob', '!config/customer_migration.json', '--glob', '!README.md', '--glob', '!package.json',
  patterns.join('|'), '.'
];

try {
  const output = execFileSync('rg', args, { encoding: 'utf8' });
  process.stdout.write(output);
  process.exitCode = 1;
} catch (error) {
  if (error.status === 1) {
    console.log('No FloSports-specific fallbacks remain outside the approved migration and inventory files.');
  } else {
    throw error;
  }
}
