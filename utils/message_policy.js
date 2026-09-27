// The server remains the authorization boundary. These checks reduce the
// authority a compromised content script can exercise through the worker.
const EXTENSION_PAGES = new Set(['/sidepanel.html','/popup.html','/options.html','/options/team.html']);
const CONTENT_ACTIONS = new Set([
  'getRuntimeTheme','checkAccess','getConfig','openPopup','checkWhitelist',
  'processNewItem','addToCart','initRogueTakedown','logToSheet','advanceRumbleQueue','validateRumbleSession',
  'clearCart','undoCart','compileMacro','patchSelectorConfig','startMacroSession','recordMacroStep',
  'botSearchComplete','botSearchFailed'
]);
export function assertMessageSender(request,sender,extensionId) {
  if(!request || typeof request!=='object' || Array.isArray(request) || typeof request.action!=='string' || request.action.length>80) throw new Error('Invalid extension message.');
  if(sender?.id!==extensionId) throw new Error('Message sender is not this extension.');
  let url; try { url=new URL(sender.url); } catch { throw new Error('Message sender URL is missing.'); }
  if(url.protocol==='chrome-extension:' && url.hostname===extensionId && EXTENSION_PAGES.has(url.pathname)) return;
  if(!['https:','http:'].includes(url.protocol) || !Number.isInteger(sender.tab?.id) || !CONTENT_ACTIONS.has(request.action)) throw new Error('This action must originate from an extension page.');
  const top=new URL(sender.tab.url);
  if(top.origin!==url.origin || url.username || url.password) throw new Error('Cross-origin frame messages are not accepted.');
  if(['processNewItem','addToCart','initRogueTakedown'].includes(request.action)) {
    if(sender.frameId!==0 || request.data?.url!==sender.tab.url) throw new Error('Capture must refer to the top-level source tab.');
  }
}
