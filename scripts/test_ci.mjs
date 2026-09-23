import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
if(!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_ISOLATED!=='true') throw new Error('CI requires an explicitly isolated test database; database tests may not be skipped.');
const tests=fs.readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).map(name=>`tests/${name}`);
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests],{stdio:'inherit',env:process.env});
process.exitCode=result.status ?? 1;
