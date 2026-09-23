// Local-only browser harness. Never packaged or deployed. Real repository and
// database operations; synthetic identity replaces the Chrome/Google handshake.
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';
if (process.env.TEST_DATABASE_ISOLATED !== 'true' || !process.env.TEST_DATABASE_URL) throw new Error('Use an explicitly isolated test database.');
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
await migrateTeamTestDatabase(pool);
const f=await teamFixture(pool,{total:12,employee:8,manager:3,admin:2});
const repository=createPostgresRepository({pool});
const service=createCustomerApiService({repository,verifyIdentity:async()=>f.identity,allowedExtensionIds:new Set(['browser-test'])});
const changes=[['jamie','Jamie Lee','employee'],['alex','Alex Rivera','employee'],['morgan','Morgan Chen','manager']].map(([suffix,name,role])=>({action:'add',email:f.email(suffix),name,role}));
const preview=await service.memberships({}, {protocolVersion:1,operation:'team_preview',requestId:crypto.randomUUID(),changes});
await service.memberships({}, {protocolVersion:1,operation:'team_commit',requestId:preview.requestId});
const files=new Set(['/options/team.html','/options/team.css','/options/team.js','/utils/team_access.js']);
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  try {
    if(path==='/runtime.js') {res.setHeader('Content-Type','text/javascript');res.end("globalThis.chrome={runtime:{sendMessage:async message=>{const response=await fetch('/__message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});return response.json();}}};");return;}
    if(path==='/__message'&&req.method==='POST') {
      const origin=req.headers.origin;if(origin!=='http://127.0.0.1:4187') throw new Error('Same-origin test requests only.');
      let data='';for await(const chunk of req){data+=chunk;if(data.length>65536)throw new Error('Too large');}
      const msg=JSON.parse(data);let result;
      if(msg.action==='refreshAccessProfile') {
        const {profile}=await service.bootstrap({}, {protocolVersion:1,identity:{email:f.identity.email},extension:{id:'browser-test',version:'3.4.0'}});
        result={profile:{...profile,status:'ready',verification:'verified'}};
      } else if(msg.action==='teamAccess') result=await service.memberships({}, {protocolVersion:1,...msg.payload});
      else throw new Error('Unsupported test action.');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,...result}));return;
    }
    if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(!files.has(path)){res.writeHead(404);res.end();return;}
    let content=await fs.readFile(new URL(`..${path}`,import.meta.url),'utf8');
    if(path.endsWith('.html'))content=content.replace('</head>','<script src="/runtime.js"></script></head>');
    res.setHeader('Content-Type',path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript');res.end(content);
  } catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:error.message,errorCode:error.code||'test_error'}));}
});
server.listen(4187,'127.0.0.1',()=>console.log(`Isolated team browser test: http://127.0.0.1:4187/options/team.html\nTest email prefix: ${f.id}`));
process.on('SIGINT',()=>server.close(async()=>{await pool.end();process.exit(0);}));
