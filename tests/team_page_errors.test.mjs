import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { hasPermission, PERMISSIONS } from '../utils/access_control.js';
import { TEAM_ROLES, TEAM_ROLE_DESCRIPTIONS, validateTeamRequest } from '../utils/team_access.js';

const source = (await readFile(new URL('../options/team.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('void task(refresh);', '');

function setup(errorCode) {
  const elements = new Map(), listeners = new Map();
  const element = () => ({ hidden: true, value: '', textContent: '', disabled: false,
    classList: { toggle() {} }, append() {}, replaceChildren() {}, addEventListener() {} });
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const profile = {schemaVersion:1,expiresAt:Date.now()+600000,permissions:['settings.adminAccess'],
    status:'ready',verification:'verified',role:'admin',customerId:'test',email:'admin@example.test'};
  const context = vm.createContext({ hasPermission, PERMISSIONS, TEAM_ROLES, TEAM_ROLE_DESCRIPTIONS, validateTeamRequest,
    document: {getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:()=>null},
    window: {addEventListener:(name,handler)=>listeners.set(name,handler)},
    chrome: {runtime:{sendMessage:async ({action})=>action==='refreshAccessProfile'
      ? {success:true,profile} : {success:false,error:'Fixture membership failure',errorCode}}}
  });
  vm.runInContext(source, context);
  return {get,context,listeners};
}

test('invalid requests preserve verified Team & Access and do not show the administrator warning', async () => {
  const h = setup('invalid_request');
  await vm.runInContext('refresh()',h.context);
  assert.equal(h.get('workspace').hidden,false);
  assert.equal(h.get('access-help').hidden,true);
  assert.equal(h.get('message').textContent,'Fixture membership failure');
  assert.equal(vm.runInContext('state.profile.role',h.context),'admin');
  h.listeners.get('focus')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('workspace').hidden,false);
  assert.equal(h.get('access-help').hidden,true);
});

test('authoritative membership authorization failures still lock Team & Access', async () => {
  for (const code of ['not_authorized','identity_error','subscription_suspended']) {
    const h = setup(code);
    await vm.runInContext('refresh()',h.context);
    assert.equal(h.get('workspace').hidden,true);
    assert.equal(h.get('access-help').hidden,false);
    assert.equal(vm.runInContext('state.profile',h.context),null);
  }
});
