import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createYoutubeAccountResolver, protectedYoutubeChannelId } from '../integrations/youtube_accounts.js';

// Read-only: never rewrite a customer's protection list from mutable handles.
export async function youtubePreflight({ apiKey, videoUrl, channelId, whitelist, fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('YOUTUBE_DATA_API_KEY is required for this API-key deployment smoke test.');
  if (!videoUrl || !channelId) throw Error('Set YOUTUBE_SMOKE_VIDEO_URL and YOUTUBE_SMOKE_CHANNEL_ID to an independently verified staging video/owner pair.');
  const expected = protectedYoutubeChannelId(channelId);
  if (!Array.isArray(whitelist) || whitelist.length === 0) throw Error('Provide a nonempty reviewed whitelist conversion manifest.');
  const entries = whitelist.map(entry => {
    if (!entry || typeof entry.originalAccount !== 'string' || !entry.originalAccount.trim()) throw Error('Each whitelist entry requires originalAccount and channelId.');
    return { originalAccount: entry.originalAccount, channelId: protectedYoutubeChannelId(entry.channelId) };
  });
  const resolver = createYoutubeAccountResolver({ apiKey, fetchImpl });
  if (await resolver.resolveTargetAccount(videoUrl) !== expected) throw Error('Staging video owner differs from the expected stable channel ID.');
  for (const entry of entries) {
    if (await resolver.resolveAccount(entry.channelId) !== entry.channelId ||
        await resolver.resolveAccount(entry.originalAccount) !== entry.channelId) {
      throw Error('Whitelist conversion mismatch; review ownership before rollout.');
    }
  }
  return { ownerLookup: 'passed', verifiedWhitelistEntries: entries.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.YOUTUBE_WHITELIST_FILE) throw Error('Set YOUTUBE_WHITELIST_FILE to the reviewed JSON conversion manifest.');
    const result = await youtubePreflight({ apiKey: process.env.YOUTUBE_DATA_API_KEY,
      videoUrl: process.env.YOUTUBE_SMOKE_VIDEO_URL, channelId: process.env.YOUTUBE_SMOKE_CHANNEL_ID,
      whitelist: JSON.parse(await fs.readFile(process.env.YOUTUBE_WHITELIST_FILE, 'utf8')) });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Provider errors deliberately omit request URLs and API credentials.
    console.error(error.message);
    process.exitCode = 1;
  }
}
