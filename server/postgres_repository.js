import { advanceReportingStreak } from './reward_policy.js';
import { authoritativeReportAttributes, reportTargetKeys } from './report_policy.js';
import crypto from 'node:crypto';
import { ApiError, assert } from './api_error.js';
import { withCustomerTransaction } from './tenant_transaction.js';
import { validateCustomerConfig } from '../utils/customer_config.js';
import { domainAllowed, identityRows, resolveInside, utilization, reauthorizeActor } from './customer_authorization.js';
import { EVENT_PERMISSIONS, requireReportMode } from './access_policy.js';
import { createIntegrationJournal } from './integration_journal.js';
import { createTeamManagement } from './team_management.js';
import { authorizeEventPlatforms, requireUrlPlatforms, requirePlatforms, statisticsPlatforms } from './platform_policy.js';

function member(row) {
  return {
    memberId: row.member_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    version: Number(row.version),
    platforms: row.platforms || []
  };
}

function errorWithUtilization(code, message, currentUtilization) {
  throw new ApiError(409, code, message, { utilization: currentUtilization });
}

export function enforceMembershipPolicy(members, target, mutation, config, currentUtilization) {
  const nextRole = mutation.role || target.role;
  const nextStatus = mutation.action === 'disable' ? 'disabled' : 'active';
  if (nextStatus === 'active') {
    assert(config.access.enabledRoles.includes(nextRole), 409, 'role_disabled', 'The selected role is disabled.');
    assert(domainAllowed(config, target.email), 409, 'domain_not_allowed', 'The member email domain is not approved for this customer.');
  }
  const projected = members.map((row) => row.member_id === target.member_id ? { ...row, role: nextRole, status: nextStatus } : row);
  const active = projected.filter((row) => row.status === 'active');
  if (mutation.action !== 'disable' && active.length > config.access.totalUserCap) {
    errorWithUtilization('total_user_cap_exceeded', 'The active-user cap would be exceeded.', currentUtilization);
  }
  if (mutation.action !== 'disable' && active.filter((row) => row.role === nextRole).length > config.access.roleSeatCaps[nextRole]) {
    errorWithUtilization('role_seat_cap_exceeded', 'The role seat cap would be exceeded.', currentUtilization);
  }
  if (active.filter((row) => row.role === 'admin').length === 0) {
    errorWithUtilization('final_admin_required', 'The customer must retain an active administrator.', currentUtilization);
  }
  return { nextRole, nextStatus };
}

function rank(points, kind) {
  if (points > 1000) return `Level 3 ${kind}`;
  if (points > 500) return `Level 2 ${kind}`;
  return `Level 1 ${kind}`;
}

function scoreboard(events, actor) {
  const users = new Map();
  let teamTotal = 0;
  for (const row of events) {
    const attributes = row.attributes || {};
    const current = users.get(row.user_id) || { name: row.member_name || row.user_id, scout: 0, enforcer: 0 };
    current.scout += Number(attributes.scout_points || 0);
    current.enforcer += Number(attributes.enforcer_points || 0);
    users.set(row.user_id, current);
    if (row.event_type === 'report.submitted') teamTotal += Number(attributes.url_count || attributes.urls?.length || 1);
  }
  const rows = [...users.entries()].map(([userId, value]) => ({ userId, ...value, total: value.scout + value.enforcer }));
  const topScouts = [...rows].sort((a, b) => b.scout - a.scout).slice(0, 10).map((row) => ({ name: row.name, points: row.scout }));
  const topEnforcers = [...rows].sort((a, b) => b.enforcer - a.enforcer).slice(0, 10).map((row) => ({ name: row.name, points: row.enforcer }));
  const overallLeaderboard = [...rows].sort((a, b) => b.total - a.total).slice(0, 10).map((row) => ({ name: row.name, points: row.total }));
  const own = rows.find((row) => row.userId === actor.memberId) || { scout: 0, enforcer: 0, total: 0 };
  const mvpRow = [...rows].sort((a, b) => b.total - a.total)[0];
  return {
    scoutPoints: own.scout,
    enforcerPoints: own.enforcer,
    scoutRank: rank(own.scout, 'Scout Reporter'),
    enforcerRank: rank(own.enforcer, 'Enforcer'),
    teamTotal,
    topScouts,
    topEnforcers,
    overallLeaderboard,
    mvp: { name: mvpRow?.name || 'TBD', points: mvpRow?.total || 0 },
    isCurrentMvp: Boolean(mvpRow && mvpRow.userId === actor.memberId)
  };
}

function intelligence(events, query) {
  const reports = events.filter((row) => row.event_type === 'report.submitted');
  const byPlatform = new Map();
  const byEvent = new Map();
  const byTarget = new Map();
  const byUser = new Map();
  const timelineData = {};
  let totalUrls = 0;
  for (const row of reports) {
    const a = row.attributes || {};
    const urlCount = Number(a.url_count || a.urls?.length || 1);
    const views = Number(a.estimated_views || 0);
    const platform = String(a.platform || 'other').toLowerCase();
    const eventName = String(a.source_event_name || 'Unknown Event');
    const handle = String(a.handle || 'Unknown').replace(/^@/, '');
    const date = new Date(row.occurred_at).toISOString().slice(0, 10);
    totalUrls += urlCount;
    const p = byPlatform.get(platform) || { name: platform, reports: 0, urls: 0 };
    p.reports += 1; p.urls += urlCount; byPlatform.set(platform, p);
    const ev = byEvent.get(eventName) || { name: eventName, views: 0 };
    ev.views += views; byEvent.set(eventName, ev);
    const target = byTarget.get(handle) || { handle, reports: 0, urls: 0, platforms: new Set() };
    target.reports += 1; target.urls += urlCount; target.platforms.add(platform); byTarget.set(handle, target);
    const user = byUser.get(row.user_id) || { name: row.member_name || row.user_id, scout: 0, enforced: 0, urlsResolved: 0, resolvedPct: 0, wBurndown: 0, uwBurndown: 0, days: new Set() };
    user.scout += Number(a.scout_points || 0); user.enforced += Number(a.enforcer_points || 0); user.days.add(date); byUser.set(row.user_id, user);
    timelineData[date] = { count: Number(timelineData[date]?.count || 0) + 1 };
  }
  for(const row of events.filter(event=>event.attributes?.provenance==='server_reward')) {
    const user=byUser.get(row.user_id)||{name:row.member_name||row.user_id,scout:0,enforced:0,urlsResolved:0,resolvedPct:0,wBurndown:0,uwBurndown:0,days:new Set()};
    user.enforced+=Number(row.attributes.enforcer_points||0);byUser.set(row.user_id,user);
  }
  const topPirates = [...byTarget.values()].map((item) => ({ ...item, platforms: [...item.platforms].join(', ') })).sort((a, b) => b.urls - a.urls);
  const topPiratesByPlatform = {};
  for (const target of topPirates) for (const platform of target.platforms.split(', ').filter(Boolean)) (topPiratesByPlatform[platform] ||= []).push(target);
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    rawReportedNum: reports.length,
    totalUrls,
    globalUnweightedResolvedNum: null,
    globalWeightedResolvedNum: null,
    globalWeightedBurndown: null,
    globalUnweightedBurndown: null,
    platformTotals: [...byPlatform.values()].sort((a, b) => b.urls - a.urls),
    eventViews: [...byEvent.values()].sort((a, b) => b.views - a.views),
    topPirates,
    topPiratesByPlatform,
    timelineData,
    teamStats: [...byUser.values()].map((item) => ({
      name: item.name,
      urls: 0,
      scouted: item.scout,
      enforced: item.enforced,
      resolvedNum: null,
      resolvedRate: 'N/A',
      wBurndown: item.wBurndown || 'N/A',
      uwBurndown: item.uwBurndown || 'N/A',
      daysReported: item.days.size
    })),
    topScouts: [...byUser.values()]
      .sort((a, b) => b.scout - a.scout)
      .map((item) => ({ name: item.name, count: item.scout })),
    topEnforcers: [...byUser.values()]
      .sort((a, b) => b.enforced - a.enforced)
      .map((item) => ({ name: item.name, count: item.enforced })),
    mvp: (() => {
      const item = [...byUser.values()].sort((a, b) => (b.scout + b.enforced) - (a.scout + a.enforced))[0];
      return item ? { name: item.name, total: item.scout + item.enforced } : null;
    })()
  };
}

async function acceptPreparedReport(client,actor,event,rewardContext) {
  requireReportMode(actor, event.attributes.mode);
  const stored=(await client.query('SELECT user_id,report_data,pdf FROM generated_reports WHERE customer_id=$1 AND report_id=$2 FOR UPDATE',[actor.customerId,event.attributes.report_id])).rows[0];
  assert(stored?.user_id===actor.memberId && stored.report_data?.eventId===event.event_id,409,'report_required','Generate this report before recording it.');
  const report=stored.report_data;
  assert(JSON.stringify(report.items.map(item=>item.url))===JSON.stringify(event.attributes.urls),409,'report_conflict','Reported URLs differ from the generated report.');
  const uploaded=await client.query("SELECT file_id FROM integration_uploaded_files WHERE customer_id=$1 AND user_id=$2 AND event_id=$3 AND web_url=$4 AND mime_type='application/pdf' AND content_sha256=$5",[actor.customerId,actor.memberId,event.event_id,event.attributes.pdf_url,crypto.createHash('sha256').update(stored.pdf).digest('hex')]);
  assert(uploaded.rows.length===1,403,'evidence_scope_mismatch','Upload the generated PDF before recording this report.');
  for(const key of reportTargetKeys(report)) {
    const existing=await client.query('INSERT INTO reported_targets(customer_id,work_key,target_key,report_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING report_id',[actor.customerId,key.workKey,key.targetKey,report.reportId]);
    assert(existing.rows.length===1,409,'duplicate_report_target','This target has already been recorded for the same work.');
  }
  return authoritativeReportAttributes(report,report.policy,event.attributes,rewardContext);
}

async function advanceRewardState(client,actor,acceptedAt) {
  const stored=(await client.query("SELECT to_char(last_report_date,'YYYY-MM-DD') AS last_report_date,streak_count,freezes FROM customer_reward_state WHERE customer_id=$1 AND user_id=$2 FOR UPDATE",[actor.customerId,actor.memberId])).rows[0];
  const state=advanceReportingStreak(stored?{lastReportDate:stored.last_report_date,streakCount:stored.streak_count,freezes:stored.freezes}:null,acceptedAt);
  await client.query(`INSERT INTO customer_reward_state(customer_id,user_id,last_report_date,streak_count,freezes) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(customer_id,user_id) DO UPDATE SET last_report_date=EXCLUDED.last_report_date,streak_count=EXCLUDED.streak_count,freezes=EXCLUDED.freezes,updated_at=now()`,[actor.customerId,actor.memberId,state.lastReportDate,state.streakCount,state.freezes]);
  return state;
}

async function recordUploadedFileInside(client, actor, eventId, mimeType, file, contentHash) {
  assert(file?.id && typeof file.webViewLink === 'string', 502, 'upload_failed', 'Google did not return an evidence file.');
  const url = new URL(file.webViewLink);
  assert(url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname), 502, 'upload_failed', 'Invalid Google file URL.');
  return client.query('INSERT INTO integration_uploaded_files(customer_id,file_id,user_id,event_id,mime_type,web_url,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
    [actor.customerId, file.id, actor.memberId, eventId, mimeType, file.webViewLink, contentHash]);
}

export function createPostgresRepository({ pool } = {}) {
  const transact = (work, options = {}) => withCustomerTransaction(work, { pool, retries: 3, ...options });
  return {
    teamOperation: createTeamManagement({ transact, resolveInside }),
    async claimIntegrationResources(actor) {
      return transact(async client => {
        const current = await reauthorizeActor(client, actor);
        for (const [purpose, resourceId] of Object.entries(current.customerConfig.destinations)) {
          if (!resourceId) continue;
          const owner = (await client.query("SELECT customer_id FROM customer_integration_resources WHERE customer_id=$1 AND provider='google' AND resource_id=$2", [current.customerId, resourceId])).rows[0];
          assert(owner, 409, 'resource_already_assigned', 'This integration resource is unavailable.');
        }
        return current;
      });
    },
    async verifyGoogleResourceScope(actor, resourceIds, permission) {
      assert(typeof permission === 'string' && permission, 500, 'configuration_error', 'A provider operation permission is required.');
      assert(Array.isArray(resourceIds) && resourceIds.length >= 1 && resourceIds.length <= 32 &&
        resourceIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(id)),
        403, 'scope_mismatch', 'Invalid Google resource scope.');
      return transact(async client => {
        const current = await reauthorizeActor(client, actor, permission);
        assert(Object.entries(current.customerConfig.destinations).every(([key, value]) => actor.customerConfig.destinations[key] === value) &&
          Array.isArray(actor.platforms) && actor.platforms.every(platform => current.platforms.includes(platform)),
          409, 'access_changed', 'Customer integration access changed. Refresh before retrying.');
        const result = await client.query('SELECT rr_private.google_resources_available($1::text[]) AS available', [resourceIds]);
        assert(result.rows[0]?.available === true, 403, 'scope_mismatch', 'The Google resource is unavailable in this customer scope.');
        return current;
      });
    },
    async requireUploadFolder(actor, folderId) {
      return transact(async client => {
        const current = await reauthorizeActor(client, actor, 'sidepanel.report');
        if (folderId === current.customerConfig.destinations.driveRootFolderId) return;
        const issued = await client.query(`SELECT 1 FROM integration_operations
          WHERE customer_id=$1 AND status='completed'
            AND name IN ('ensureRogueScreenshotFolder','ensureYearlyReportFolder','ensureDailyScreenshotFolder','ensureBriefingFolder')
            AND result=to_jsonb($2::text) LIMIT 1`, [current.customerId, folderId]);
        assert(issued.rows.length === 1, 403, 'scope_mismatch', 'The Google resource is unavailable in this customer scope.');
      });
    },
    ...createIntegrationJournal({ transact, recordUpload: recordUploadedFileInside }),
    async recordScannerResolutions(actor,rowKey,urls) {
      return transact(async client=>{
        actor = await reauthorizeActor(client, actor, 'sidepanel.automate');
        const entries=urls.map(url=>({targetKey:crypto.createHash('sha256').update(url).digest('hex'),platform:requireUrlPlatforms(actor,[url])[0]}));
        for(const entry of entries) await client.query('INSERT INTO scanner_resolutions(customer_id,row_key,target_key,platform,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[actor.customerId,rowKey,entry.targetKey,entry.platform,actor.memberId]);
      });
    },
    async reserveScannerBonus(actor,rowKey) {
      return transact(async client=>{
        const current = await reauthorizeActor(client, actor, 'sidepanel.automate');
        const rows=(await client.query('SELECT * FROM scanner_resolutions WHERE customer_id=$1 AND row_key=$2 AND rewarded_at IS NULL ORDER BY observed_at,target_key FOR UPDATE',[actor.customerId,rowKey])).rows;
        if(!rows.length) return null;
        requirePlatforms(current,rows.map(row=>row.platform));
        const assigned=rows.find(row=>row.award_id)?.award_id;
        const selected=assigned?rows.filter(row=>row.award_id===assigned):rows;
        const awardId=assigned || 'bonus_'+crypto.createHash('sha256').update(JSON.stringify([rowKey,selected.map(row=>row.target_key).sort()])).digest('hex');
        if(!assigned) await client.query('UPDATE scanner_resolutions SET award_id=$3 WHERE customer_id=$1 AND row_key=$2 AND rewarded_at IS NULL AND award_id IS NULL',[actor.customerId,rowKey,awardId]);
        return {awardId,points:selected.length*15,platforms:[...new Set(selected.map(row=>row.platform))]};
      },{isolation:'SERIALIZABLE'});
    },
    async completeScannerBonus(actor,rowKey,awardId,rowIndex) {
      return transact(async client=>{
        actor = await reauthorizeActor(client, actor, 'sidepanel.automate');
        const rows=(await client.query('SELECT * FROM scanner_resolutions WHERE customer_id=$1 AND row_key=$2 AND award_id=$3 AND rewarded_at IS NULL FOR UPDATE',[actor.customerId,rowKey,awardId])).rows;
        if (rows.length) requirePlatforms(actor, rows.map(row => row.platform));
        const groups=new Map();
        for(const row of rows) {
          const key=JSON.stringify([row.user_id,row.platform]);
          const group=groups.get(key)||{userId:row.user_id,platform:row.platform,count:0};group.count++;groups.set(key,group);
        }
        for(const [key,group] of groups) {
          const eventId='sys_bonus_'+crypto.createHash('sha256').update(JSON.stringify([awardId,key])).digest('hex');
          const attributes={platform:group.platform,row_index:rowIndex+1,enforcer_points:group.count*15,resolved_count:group.count,new_status:'Resolved',provenance:'server_reward',reason:'operator_observed_resolution'};
          const hash=crypto.createHash('sha256').update(JSON.stringify(attributes)).digest('hex');
          await client.query("INSERT INTO customer_events(customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash) VALUES($1,$2,$3,'automation.row_status_changed',now(),$4,$5)",[actor.customerId,eventId,group.userId,attributes,hash]);
        }
        await client.query('UPDATE scanner_resolutions SET rewarded_at=now() WHERE customer_id=$1 AND row_key=$2 AND award_id=$3 AND rewarded_at IS NULL',[actor.customerId,rowKey,awardId]);
      });
    },
    async finalizeReportBatch(actor,batch,acceptedAt) {
      const requestHash=crypto.createHash('sha256').update(JSON.stringify(batch)).digest('hex');
      return transact(async client=>{
        const current = await reauthorizeActor(client, actor, 'sidepanel.report');
        for (const report of batch.reports) requireReportMode(current, report.mode);
        const prior=(await client.query('SELECT * FROM report_batches WHERE customer_id=$1 AND batch_id=$2 FOR UPDATE',[actor.customerId,batch.batchId])).rows[0];
        if(prior) {
          assert(prior.user_id===actor.memberId && prior.request_hash===requestHash,409,'batch_conflict','This batch ID was already used.');
          // Recheck platform access even on a stored-result retry.
          for(const submission of batch.reports) {
            const report=(await client.query('SELECT report_data FROM generated_reports WHERE customer_id=$1 AND report_id=$2',[actor.customerId,submission.reportId])).rows[0]?.report_data;
            requireUrlPlatforms(current,report?.items.map(item=>item.url)||[]);
          }
          return prior.result;
        }
        const reports=[];let batchSize=0;
        for(const submission of batch.reports) {
          const stored=(await client.query('SELECT user_id,report_data FROM generated_reports WHERE customer_id=$1 AND report_id=$2 FOR UPDATE',[actor.customerId,submission.reportId])).rows[0];
          assert(stored?.user_id===actor.memberId && stored.report_data?.eventId===submission.eventId,409,'report_required','All batch reports must already be generated by this operator.');
          const report=stored.report_data;
          requireUrlPlatforms(current,report.items.map(item=>item.url));
          batchSize+=report.items.length;
          assert(batchSize<=100,400,'batch_too_large','A report batch supports up to 100 targets.');
          reports.push({submission,report});
        }
        const state=await advanceRewardState(client,current,acceptedAt);
        const receipts=[];
        for(const {submission,report} of reports) {
          const event={event_id:submission.eventId,customer_id:actor.customerId,user_id:actor.memberId,event_type:'report.submitted',occurred_at:acceptedAt,attributes:{report_id:submission.reportId,urls:report.items.map(item=>item.url),pdf_url:submission.pdfUrl,mode:submission.mode,content_type:submission.contentType}};
          const existing=await client.query('SELECT event_id FROM customer_events WHERE customer_id=$1 AND event_id=$2',[actor.customerId,event.event_id]);
          assert(existing.rows.length===0,409,'report_already_accepted','This report is already part of an accepted operation.');
          const attributes=await acceptPreparedReport(client,current,event,{batchSize,streakCount:state.streakCount});
          const hash=crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
          await client.query("INSERT INTO customer_events(customer_id,event_id,user_id,event_type,occurred_at,observed_at,attributes,payload_hash) VALUES($1,$2,$3,'report.submitted',to_timestamp($4/1000.0),to_timestamp($4/1000.0),$5,$6)",[actor.customerId,event.event_id,actor.memberId,acceptedAt,attributes,hash]);
          await client.query('INSERT INTO report_projection_jobs(customer_id,report_id) VALUES($1,$2)',[actor.customerId,report.reportId]);
          receipts.push({reportId:report.reportId,eventId:report.eventId,scoutPoints:attributes.scout_points,enforcerPoints:attributes.enforcer_points});
        }
        const result={customerId:actor.customerId,userId:actor.memberId,batchId:batch.batchId,acceptedAt,reports:receipts,streak:state};
        await client.query('INSERT INTO report_batches(customer_id,batch_id,user_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',[actor.customerId,batch.batchId,actor.memberId,requestHash,result]);
        return result;
      },{isolation:'SERIALIZABLE'});
    },
    async projectReport(actor,reportId,work) {
      const job=await transact(async client=>{
        const current = await reauthorizeActor(client, actor, 'sidepanel.report');
        const row=(await client.query(`SELECT j.*,e.attributes,e.occurred_at,g.user_id FROM report_projection_jobs j
          JOIN generated_reports g USING(customer_id,report_id)
          JOIN customer_events e ON e.customer_id=g.customer_id AND e.event_id=g.report_data->>'eventId'
          WHERE j.customer_id=$1 AND j.report_id=$2 FOR UPDATE OF j`,[actor.customerId,reportId])).rows[0];
        assert(row && row.user_id===actor.memberId,404,'report_required','No accepted report is awaiting projection.');
        requireUrlPlatforms(current,row.attributes.urls);
        if(row.status==='completed') return null;
        await client.query("UPDATE report_projection_jobs SET attempts=attempts+1,updated_at=now() WHERE customer_id=$1 AND report_id=$2",[actor.customerId,reportId]);
        return {reportId,attributes:row.attributes,createdAt:row.occurred_at,reporterName:current.name,email:current.email,reconcileOnly:row.status==='uncertain'};
      });
      if(!job) return;
      // Reads, header repair and provider authorization can fail safely. Only
      // an append dispatched after this durable claim has an unknown outcome.
      // The conditional update also fences concurrent attempts that both read
      // a pending job before either reached the provider write boundary.
      const beforeAppend=()=>transact(async client=>{
        const current=await reauthorizeActor(client,actor,'sidepanel.report');
        requireUrlPlatforms(current,job.attributes.urls);
        const claimed=await client.query("UPDATE report_projection_jobs SET status='uncertain',updated_at=now() WHERE customer_id=$1 AND report_id=$2 AND status='pending' RETURNING report_id",[actor.customerId,reportId]);
        assert(claimed.rowCount===1,409,'projection_uncertain','Another attempt may have appended this report. Retry to reconcile its Google row.');
      });
      await work(job,{reconcileOnly:job.reconcileOnly,beforeAppend});
      await transact(async client => {
        await reauthorizeActor(client, actor, 'sidepanel.report');
        await client.query("UPDATE report_projection_jobs SET status='completed',updated_at=now() WHERE customer_id=$1 AND report_id=$2",[actor.customerId,reportId]);
      });
    },
    async recordUploadedFile(actor,eventId,mimeType,file,contentHash) {
      return transact(async client => {
        actor = await reauthorizeActor(client, actor, 'sidepanel.report');
        return recordUploadedFileInside(client, actor, eventId, mimeType, file, contentHash);
      });
    },
    async generateReport(actor, report, render, policy) {
      return transact(async client => {
        const current = await reauthorizeActor(client, actor, 'sidepanel.report');
        requireUrlPlatforms(current, report.items.map(item => item.url));
        assert(policy && policy.version === 1, 403, 'rights_policy_denied', 'The report policy must be verified.');
        for (const item of report.items) if (item.screenshotLink) {
          const evidence = await client.query(`SELECT file_id FROM integration_uploaded_files WHERE customer_id=$1 AND user_id=$2 AND event_id=$3 AND web_url=$4 AND mime_type IN ('image/jpeg','image/png')`, [actor.customerId,actor.memberId,report.eventId,item.screenshotLink]);
          assert(evidence.rows.length === 1,403,'evidence_scope_mismatch','Evidence must be uploaded by this operator for this report.');
        }
        const digest = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
        const stored = (await client.query('SELECT user_id, request_hash, pdf FROM generated_reports WHERE customer_id=$1 AND report_id=$2', [actor.customerId, report.reportId])).rows[0];
        let bytes;
        if (stored) {
          assert(stored.user_id === actor.memberId && stored.request_hash === digest, 409, 'report_conflict', 'This report ID was already used.');
          bytes = stored.pdf;
        } else {
          const count = (await client.query("SELECT count(*)::int AS used FROM generated_reports WHERE customer_id=$1 AND created_at > now()-interval '1 day'", [actor.customerId])).rows[0].used;
          assert(count < 1000, 429, 'report_quota_exceeded', 'Daily organization report limit reached. Contact the seller.');
          const config = current.customerConfig;
          const blob = await render({ ...report, reporterName: current.name, dataScope: { customerId: current.customerId, userId: current.memberId, eventId: report.eventId }, customerContext: { product: config.product, colors: config.theme.colors, legal: config.legal } });
          assert(blob.type === 'application/pdf' && blob.size <= 4 * 1024 * 1024, 500, 'report_generation_failed', 'The PDF could not be generated.');
          bytes = Buffer.from(await blob.arrayBuffer());
          await client.query('INSERT INTO generated_reports(customer_id,report_id,user_id,request_hash,pdf,report_data,config_version) VALUES ($1,$2,$3,$4,$5,$6,$7)', [actor.customerId, report.reportId, actor.memberId, digest, bytes, {...report,policy},actor.configVersion]);
        }
        return { customerId: actor.customerId, userId: actor.memberId, reportId: report.reportId, pdf: bytes.toString('base64') };
      }, { isolation: 'SERIALIZABLE', retries: 3 });
    },
    async resolveActiveMembership(identity) {
      return transact(async (client) => {
        const result = await identityRows(client, identity, { lock: true });
        if (result.rows.length !== 1) return { count: result.rows.length };
        const row = result.rows[0];
        if (row.email.toLowerCase() !== identity.email) return { count: 0 };
        const configResult = validateCustomerConfig(row.config);
        assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
        assert(configResult.config.configVersion === Number(row.config_version), 500, 'configuration_error', 'Stored configuration versions do not match.');
        if (!configResult.config.access.enabledRoles.includes(row.role) || !domainAllowed(configResult.config, row.email)) return { count: 0 };
        const actor = await resolveInside(client, identity, { allowOverCap: true, allowManagement: true });
        return { count: 1, member: member(row), customerConfig: configResult.config, entitlementExpiresAt: actor.entitlementExpiresAt, overCap: actor.overCap, managementOnly: actor.managementOnly };
      });
    },

    requireActiveMember(identity) {
      return transact((client) => resolveInside(client, identity));
    },

    requireMemberPermission(identity, permission, options = {}) {
      return transact((client) => resolveInside(client, identity, { ...options, permission }));
    },

    async listMembers(actor, query) {
      return transact(async client => {
      actor = await reauthorizeActor(client, actor, 'settings.adminAccess', { permission: 'settings.adminAccess', allowOverCap: true });
      const configResult = validateCustomerConfig(actor.customerConfig);
      assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
      const values = [actor.customerId];
      const filter = query ? 'AND (lower(email) LIKE $2 OR lower(name) LIKE $2)' : '';
      if (query) values.push(`%${query.toLowerCase()}%`);
      const result = await client.query(`SELECT * FROM customer_memberships WHERE customer_id = $1 ${filter} ORDER BY lower(name), lower(email) LIMIT 1000`, values);
      return {
        protocolVersion: 1,
        customerId: actor.customerId,
        configVersion: actor.configVersion,
        members: result.rows.map(member).map(({ platforms, ...item }) => item),
        utilization: await utilization(client, configResult.config)
      };
      });
    },

    mutateMembership(actor, mutation, occurredAt) {
      return transact(async (client) => {
        await reauthorizeActor(client, actor, 'settings.adminAccess', { permission: 'settings.adminAccess', allowOverCap: mutation.action === 'disable' });
        const customer = await client.query('SELECT * FROM customers WHERE customer_id = $1 AND active = TRUE FOR UPDATE', [actor.customerId]);
        assert(customer.rows.length === 1, 404, 'member_not_found', 'The customer is inactive or missing.');
        const configResult = validateCustomerConfig(customer.rows[0].config);
        assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
        const config = configResult.config;
        const members = await client.query('SELECT * FROM customer_memberships WHERE customer_id = $1 FOR UPDATE', [actor.customerId]);
        const target = members.rows.find((row) => row.member_id === mutation.memberId);
        assert(target, 404, 'member_not_found', 'The selected customer member was not found.');
        assert(Number(target.version) === mutation.expectedVersion, 409, 'stale_member_version', 'The membership changed elsewhere.');
        const currentUtilization = await utilization(client, config);
        const { nextRole, nextStatus } = enforceMembershipPolicy(members.rows, target, mutation, config, currentUtilization);
        const updated = await client.query(`UPDATE customer_memberships SET role = $1, status = $2, version = version + 1, updated_at = now() WHERE customer_id = $3 AND member_id = $4 RETURNING *`, [nextRole, nextStatus, actor.customerId, target.member_id]);
        const auditId = `audit_${crypto.randomUUID().replaceAll('-', '')}`;
        await client.query(`INSERT INTO membership_audit (audit_id, customer_id, actor_member_id, actor_email, target_member_id, action, before_state, after_state, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9 / 1000.0))`, [auditId, actor.customerId, actor.memberId, actor.email, target.member_id, mutation.action, target, updated.rows[0], occurredAt]);
        return {
          protocolVersion: 1,
          customerId: actor.customerId,
          configVersion: Number(customer.rows[0].config_version),
          member: (({ platforms, ...item }) => item)(member(updated.rows[0])),
          utilization: await utilization(client, config),
          audit: { auditId, action: mutation.action, actorEmail: actor.email, targetMemberId: target.member_id, occurredAt }
        };
      }, { isolation: 'SERIALIZABLE', retries: 2 });
    },

    async recordEvent(actor, event, acceptedAt) {
      const eventPlatform = String(event.attributes?.platform || '').trim().toLowerCase();
      if (eventPlatform) {
        assert(
          actor.customerConfig.capabilities.enabledPlatforms.includes(eventPlatform),
          403,
          'scope_mismatch',
          'The event platform is not enabled for this customer.'
        );
      }
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
      return transact(async (client) => {
        const refreshed = await reauthorizeActor(client, actor, EVENT_PERMISSIONS[event.event_type]);
        assert(EVENT_PERMISSIONS[event.event_type], 400, 'invalid_event', 'Unsupported event type.');
        assert(event.customer_id===actor.customerId && event.user_id===actor.memberId,403,'scope_mismatch','Event scope does not match the verified actor.');
        authorizeEventPlatforms(refreshed, event);
        if (event.event_type === 'report.submitted') requireReportMode(refreshed, event.attributes.mode);
        const existing = await client.query('SELECT payload_hash FROM customer_events WHERE customer_id = $1 AND event_id = $2 FOR UPDATE', [actor.customerId, event.event_id]);
        if (existing.rows.length) assert(existing.rows[0].payload_hash === payloadHash, 409, 'event_conflict', 'The event ID was already used with different contents.');
        else {
          let attributes = {...event.attributes, provenance: 'operator_observation'};
          delete attributes.scout_points; delete attributes.enforcer_points;
          if(event.event_type==='report.submitted') {
            const rewardState=await advanceRewardState(client,refreshed,acceptedAt);
            attributes=await acceptPreparedReport(client,refreshed,event,{streakCount:rewardState.streakCount});
          }
          await client.query(`INSERT INTO customer_events (customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash,observed_at) VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0),$6,$7,to_timestamp($8 / 1000.0))`, [actor.customerId, event.event_id, actor.memberId, event.event_type, acceptedAt, attributes, payloadHash,event.occurred_at]);
          if(event.event_type==='report.submitted') await client.query('INSERT INTO report_projection_jobs(customer_id,report_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.customerId,event.attributes.report_id]);
        }
        return { protocol_version: 1, event_id: event.event_id, customer_id: actor.customerId, user_id: actor.memberId, accepted_at: acceptedAt };
      });
    },

    async queryStatistics(actor, queryType, query, generatedAt, legacy = false) {
      return transact(async client => {
      assert(['scoreboard', 'intelligence'].includes(queryType), 400, 'invalid_query', 'Unsupported statistics query.');
      const refreshed = await reauthorizeActor(client, actor, queryType === 'scoreboard' ? 'sidepanel.scoreboard' : 'sidepanel.intel');
      actor = refreshed;
      const dashboardId = actor.customerConfig.stats.dashboardId;
      assert(query.dashboard_id === dashboardId, 403, 'scope_mismatch', 'The requested dashboard is outside the customer scope.');
      const allowedPlatforms = statisticsPlatforms(refreshed, query.platforms);
      let start;
      let end;
      if (queryType === 'scoreboard') {
        start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
        end = new Date(); end.setUTCMonth(end.getUTCMonth() + 1, 1); end.setUTCHours(0, 0, 0, 0);
      } else {
        start = new Date(`${query.start_date}T00:00:00.000Z`);
        end = new Date(`${query.end_date}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
      }
      const result = await client.query(`
        SELECT e.*, m.name AS member_name
        FROM customer_events e
        LEFT JOIN customer_memberships m ON m.customer_id = e.customer_id AND m.member_id = e.user_id
        WHERE e.customer_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
          AND e.attributes->>'platform' = ANY($4::text[])
        ORDER BY e.occurred_at
        LIMIT 50001
      `, [actor.customerId, start, end, allowedPlatforms]);
      assert(result.rows.length <= 50000, 422, 'query_too_large', 'Choose a shorter statistics date range.');
      let events = result.rows;
      if (queryType === 'intelligence' && Array.isArray(query.platforms) && query.platforms.length) {
        const allowed = new Set(query.platforms);
        events = events.filter((row) => !row.attributes?.platform || allowed.has(row.attributes.platform));
      }
      const data = queryType === 'scoreboard' ? scoreboard(events, actor) : intelligence(events, query);
      assert(!legacy, 400, 'independent_source_required', 'Legacy statistics must be read from the Google adapter.');
      data._provenance = {source:'customer_events',version:1};
      return { protocol_version: 1, customer_id: actor.customerId, user_id: actor.memberId, dashboard_id: dashboardId, query_type: queryType, generated_at: generatedAt, data };
      });
    }
  };
}
