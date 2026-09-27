import { observedViews, reportReward } from './reward_policy.js';
import crypto from 'node:crypto';
import { assert } from './api_error.js';
import { requireUrlPlatforms } from './platform_policy.js';

// YouTube ownership is resolved server-side. Other platforms and view counts
// remain operator observations; this does not prove copyright ownership.
export async function verifyReportPolicy(actor, report, adapter) {
  const platforms = requireUrlPlatforms(actor, report.items.map(item => item.url));
  assert(platforms.length === 1, 400, 'invalid_report', 'A report must contain one platform.');
  assert(new Set(reportTargetKeys(report).map(item => item.targetKey)).size === report.items.length, 400, 'invalid_report', 'Duplicate evidence URLs are not allowed.');
  const config = await adapter.fetchConfig();
  const vertical = config.verticals?.find(item => item.name?.toLowerCase() === report.vertical.toLowerCase());
  assert(vertical, 403, 'rights_policy_denied', 'This vertical is not in the customer catalog.');
  const catalog = await adapter.getEventData(vertical.name);
  const event = catalog.eventMap?.[report.eventName.toLowerCase()];
  assert(event, 403, 'rights_policy_denied', 'This event is not in the customer catalog.');
  assert(report.handle && !['unknown','n/a'].includes(report.handle.toLowerCase()), 400, 'invalid_report', 'A target account is required.');
  const targetAccountIds = [];
  if (platforms[0] === 'youtube') {
    assert(typeof adapter.resolveYoutubeTargetAccount === 'function' && typeof adapter.resolveYoutubeAccount === 'function',
      403, 'target_account_unverified', 'YouTube account verification is unavailable.');
    for (const item of report.items) {
      const accountId = await adapter.resolveYoutubeTargetAccount(item.url);
      assert(/^UC[A-Za-z0-9_-]{22}$/.test(accountId), 403, 'target_account_unverified', 'The target account could not be verified.');
      if (!targetAccountIds.includes(accountId)) {
        assert(!(await adapter.checkIfAuthorized('youtube', accountId)), 403, 'authorized_target', 'This account is on the customer authorized-account list.');
      }
      targetAccountIds.push(accountId);
    }
    const declaredId = await adapter.resolveYoutubeAccount(report.handle);
    assert(targetAccountIds.every(id => id === declaredId), 403, 'target_account_mismatch', 'The supplied account does not own every target URL.');
  } else {
    const handles = new Set([report.handle]);
    for (const item of report.items) {
      const match = new URL(item.url).pathname.match(/^\/@([^/]+)/);
      if (match) handles.add(decodeURIComponent(match[1]));
    }
    for (const handle of handles) assert(!(await adapter.checkIfAuthorized(platforms[0], handle)), 403, 'authorized_target', 'This account is on the customer authorized-handle list.');
  }
  const xpEvent = vertical.events?.find(item => String(item.eventName || item.name).toLowerCase() === report.eventName.toLowerCase());
  const expires = Date.parse(xpEvent?.double_xp_expires_at);
  const multiplier = xpEvent?.double_xp === true && Number.isFinite(expires) && expires > Date.now() ? 2 : 1;
  return { version: 1, platform: platforms[0], multiplier, checkedAt: Date.now(), eventName: event.name,
    ...(targetAccountIds.length ? { targetAccountIds } : {}) };
}

export function authoritativeReportAttributes(report, policy, claimed, rewardContext={}) {
  const urls = report.items.map(item => item.url);
  const reward=reportReward({itemCount:urls.length,items:report.items,multiplier:policy.multiplier,...rewardContext});
  return {
    platform: policy.platform, urls, handle: report.handle,
    source_event_name: report.eventName, vertical: report.vertical, report_id: report.reportId,
    estimated_views: Math.min(1000000000,report.items.reduce((sum,item)=>sum+observedViews(item.views),0)),
    mode: claimed.mode === 'scout' ? 'scout' : 'enforcer', url_count: urls.length,
    // Formula version is explicit; client awards/streaks can never change the ledger.
    scout_points: reward.scoutPoints,
    enforcer_points: reward.enforcerPoints,
    pdf_url: claimed.pdf_url,
    content_type: claimed.content_type || 'VOD',
    provenance: 'server_report', scoring_version: reward.scoringVersion,
    outcome: 'operator_prepared'
  };
}

export function reportTargetKeys(report) {
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const workKey=digest(JSON.stringify([report.vertical.trim().toLowerCase(),report.eventName.trim().toLowerCase()]));
  return report.items.map(item=>{
    const url=new URL(item.url);url.hostname=url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');url.hash='';
    // TikTok video identity is in the path; share/tracking parameters do not
    // identify another video. Preserve query strings for other URL shapes.
    if ((url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com')) && /^\/@[^/]+\/video\/\d+\/?$/.test(url.pathname)) {
      url.search = '';
    }
    const youtubeId=url.hostname==='youtu.be'?url.pathname.slice(1):(url.hostname==='youtube.com'||url.hostname.endsWith('.youtube.com'))?(url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1]):'';
    const key=youtubeId?`youtube:${youtubeId}`:`${url.origin}${url.pathname.replace(/\/$/,'')}${url.search}`;
    return {workKey,targetKey:digest(key)};
  });
}
