import { applyMigrations } from '../server/migrations.js';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { provisionCustomer } from '../server/customer_provisioning.js';
import { applySubscriptionChange } from '../server/subscription_service.js';
export async function migrateTeamTestDatabase(pool) {
  if (process.env.TEST_DATABASE_ISOLATED !== 'true') throw new Error('An explicitly isolated test database is required.');
  await applyMigrations(pool);
}
export async function teamFixture(pool, caps = {total:6, employee:4, manager:2, admin:2}) {
  const config=JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json',import.meta.url),'utf8'));
  const id=`team-${crypto.randomUUID().slice(0,8)}`;
  config.destinations=Object.fromEntries(Object.keys(config.destinations).map(key=>[key,`${id}_${key}`]));
  config.customerId=id;config.stats.dashboardId=`stats_${id.replaceAll('-','_')}`;config.access.allowedEmailDomains=['example.test'];config.legal.companyName='Example Customer';
  const identity={email:`${id}-admin@example.test`,subject:`sub-${id}`};
  const input={customerId:id,planKey:'team-test',interval:'month',startsAt:new Date(Date.now()-86400000).toISOString(),paidThrough:new Date(Date.now()+86400000*30).toISOString(),paymentKind:'paid',paymentReference:'test-payment',cancelAtPeriodEnd:false,totalUserCap:caps.total,roleSeatCaps:{employee:caps.employee,manager:caps.manager,admin:caps.admin},enabledFeatures:config.capabilities.enabledFeatures,expectedRevision:0,expectedConfigVersion:1,idempotencyKey:crypto.randomUUID(),reason:'Isolated team test',active:true,operation:'save'};
  const initial=await provisionCustomer(pool,{config,initialAdministrator:{name:'Customer Admin',email:identity.email},operator:{email:'seller@example.test'}});
  await applySubscriptionChange(pool,input,'seller@example.test');
  return {id,identity,initial,email: suffix=>`${id}-${suffix}@example.test`};
}
