const createDomainMatcher = (domains) => {
  const normalizedDomains = Object.freeze(domains.map((domain) => String(domain).toLowerCase()));
  return (url) => normalizedDomains.some((domain) => String(url || '').toLowerCase().includes(domain));
};

const platform = (definition) => ({
  ...definition,
  matches: createDomainMatcher(definition.domains || [])
});

export const PLATFORM_CATALOG = Object.freeze([
  platform({
    key: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com', 'youtu.be', 'studio.youtube.com'],
    reportUrl: 'https://www.youtube.com/copyright_complaint_form',
    buildChannelUrl: (handle) => `https://www.youtube.com/@${handle}`
  }),
  platform({
    key: 'tiktok',
    label: 'TikTok',
    domains: ['tiktok.com', 'tiktokforbusiness.com'],
    reportUrl: 'https://www.tiktok.com/legal/report/Copyright',
    buildChannelUrl: (handle) => `https://www.tiktok.com/@${handle}`
  }),
 platform({
   key: 'twitter',
   label: 'X / Twitter',
   domains: ['x.com', 'twitter.com', 'help.x.com'],
    reportUrl: 'https://help.x.com/en/forms/ipi/dmca/authorized-rep',
   buildChannelUrl: (handle) => `https://x.com/${handle}`
 }),
  platform({
    key: 'instagram',
    label: 'Instagram',
    domains: ['instagram.com', 'help.instagram.com'],
    reportUrl: 'https://help.instagram.com/contact/552695131608132',
    buildChannelUrl: (handle) => `https://www.instagram.com/${handle}`
  }),
  platform({
    key: 'facebook',
    label: 'Facebook',
    domains: ['facebook.com'],
    reportUrl: 'https://www.facebook.com/help/contact/copyrightform',
    buildChannelUrl: (handle) => `https://www.facebook.com/${handle}`
  }),
  platform({
    key: 'kick',
    label: 'Kick',
    domains: ['kick.com'],
    reportUrl: null,
    buildChannelUrl: (handle) => `https://kick.com/${String(handle || '').trim().replace(/^@/, '')}`
  }),
  platform({
    key: 'twitch',
    label: 'Twitch',
    domains: ['twitch.tv'],
    reportUrl: 'https://www.twitch.tv/copyright-claims',
    buildChannelUrl: (handle) => `https://www.twitch.tv/${handle}`
  }),
  platform({
    key: 'rumble',
    label: 'Rumble',
    domains: ['rumble.com'],
    reportUrl: null,
    buildChannelUrl: (handle) => {
      const normalizedHandle = String(handle || '').trim().replace(/^@/, '').replace(/^\/+/, '');
      if (!normalizedHandle) return '';
      if (/^https?:\/\//i.test(normalizedHandle)) return normalizedHandle;
      if (/^(c|user|channel)\//i.test(normalizedHandle)) return `https://rumble.com/${normalizedHandle}`;
      return `https://rumble.com/c/${normalizedHandle}`;
    }
  }),
  platform({ key: 'trovo', label: 'Trovo', domains: ['trovo.live'], reportUrl: null }),
  platform({ key: 'dlive', label: 'DLive', domains: ['dlive.tv'], reportUrl: null }),
  platform({ key: 'sooplive', label: 'SOOP Korea / AfreecaTV', domains: ['sooplive.co.kr', 'afreecatv.com'], reportUrl: null }),
  platform({ key: 'chzzk', label: 'CHZZK', domains: ['chzzk.naver.com'], reportUrl: null }),
  platform({ key: 'bigolive', label: 'Bigo Live', domains: ['bigo.tv'], reportUrl: null }),
  platform({ key: 'nimotv', label: 'NimoTV', domains: ['nimo.tv'], reportUrl: null }),
  platform({ key: 'huya', label: 'Huya', domains: ['huya.com'], reportUrl: null }),
  platform({ key: 'douyu', label: 'Douyu', domains: ['douyu.com'], reportUrl: null }),
  platform({ key: 'younow', label: 'YouNow', domains: ['younow.com'], reportUrl: null }),
  platform({ key: 'twitcasting', label: 'TwitCasting', domains: ['twitcasting.tv'], reportUrl: null }),
  platform({ key: 'tango', label: 'Tango', domains: ['tango.me'], reportUrl: null }),
  platform({ key: 'mildom', label: 'Mildom', domains: ['mildom.com'], reportUrl: null }),
  platform({ key: 'mirrativ', label: 'Mirrativ', domains: ['mirrativ.com'], reportUrl: null }),
  platform({ key: 'nonolive', label: 'Nonolive', domains: ['nonolive.com'], reportUrl: null }),
  platform({ key: 'rooter', label: 'Rooter', domains: ['rooter.gg'], reportUrl: null }),
  platform({ key: 'snapchat', label: 'Snapchat (Spotlight)', domains: ['snapchat.com'], reportUrl: null }),
  platform({ key: 'threads', label: 'Threads', domains: ['threads.net'], reportUrl: null }),
  platform({ key: 'linkedin', label: 'LinkedIn', domains: ['linkedin.com'], reportUrl: null }),
  platform({ key: 'pinterest', label: 'Pinterest', domains: ['pinterest.com'], reportUrl: null }),
  platform({ key: 'bluesky', label: 'Bluesky', domains: ['bsky.app'], reportUrl: null }),
  platform({ key: 'truthsocial', label: 'Truth Social', domains: ['truthsocial.com'], reportUrl: null }),
  platform({ key: 'likee', label: 'Likee', domains: ['likee.video'], reportUrl: null }),
  platform({ key: 'triller', label: 'Triller', domains: ['triller.co'], reportUrl: null }),
  platform({ key: 'tumblr', label: 'Tumblr', domains: ['tumblr.com'], reportUrl: null }),
  platform({ key: 'gab', label: 'Gab', domains: ['gab.com'], reportUrl: null }),
  platform({ key: 'gettr', label: 'Gettr', domains: ['gettr.com'], reportUrl: null }),
  platform({ key: 'vk', label: 'VKontakte / VK', domains: ['vk.com'], reportUrl: null }),
  platform({ key: 'ok', label: 'Odnoklassniki', domains: ['ok.ru'], reportUrl: null }),
  platform({ key: 'bilibili', label: 'Bilibili', domains: ['bilibili.tv', 'bilibili.com'], reportUrl: null }),
  platform({ key: 'kuaishou', label: 'Kuaishou / Kwai', domains: ['kuaishou.com'], reportUrl: null }),
  platform({ key: 'niconico', label: 'Niconico', domains: ['nicovideo.jp'], reportUrl: null }),
  platform({ key: 'navertv', label: 'Naver TV', domains: ['tv.naver.com'], reportUrl: null }),
  platform({ key: 'kakaotv', label: 'KakaoTV', domains: ['tv.kakao.com'], reportUrl: null }),
  platform({ key: 'rutube', label: 'Rutube', domains: ['rutube.ru'], reportUrl: null }),
  platform({ key: 'wechatchannels', label: 'WeChat Channels', domains: ['wechat.com'], reportUrl: null }),
  platform({ key: 'moj', label: 'Moj', domains: ['mojapp.in'], reportUrl: null }),
  platform({ key: 'yandexvideo', label: 'Yandex Video', domains: ['yandex.com/video', 'yandex.com', 'yandex.ru'], reportUrl: null }),
  platform({ key: 'reddit', label: 'Reddit', domains: ['reddit.com'], reportUrl: null }),
  platform({ key: 'telegram', label: 'Telegram Web', domains: ['web.telegram.org', 'telegram.org'], reportUrl: null }),
  platform({ key: 'discord', label: 'Discord', domains: ['discord.com'], reportUrl: null }),
  platform({ key: 'whatsapp', label: 'WhatsApp Web', domains: ['web.whatsapp.com', 'whatsapp.com'], reportUrl: null }),
  platform({ key: 'signal', label: 'Signal', domains: ['signal.org'], reportUrl: null }),
  platform({ key: 'line', label: 'Line', domains: ['line.me'], reportUrl: null }),
  platform({ key: 'mastodon', label: 'Mastodon', domains: ['joinmastodon.org'], reportUrl: null }),
  platform({ key: 'viber', label: 'Viber', domains: ['viber.com'], reportUrl: null }),
  platform({ key: 'band', label: 'Band', domains: ['band.us'], reportUrl: null }),
  platform({ key: 'dailymotion', label: 'Dailymotion', domains: ['dailymotion.com'], reportUrl: null }),
  platform({ key: 'vimeo', label: 'Vimeo', domains: ['vimeo.com'], reportUrl: null }),
  platform({ key: 'streamable', label: 'Streamable', domains: ['streamable.com'], reportUrl: null }),
  platform({ key: 'odysee', label: 'Odysee', domains: ['odysee.com'], reportUrl: null }),
  platform({ key: 'bitchute', label: 'BitChute', domains: ['bitchute.com'], reportUrl: null }),
  platform({ key: 'locals', label: 'Locals', domains: ['locals.com'], reportUrl: null }),
  platform({ key: 'veoh', label: 'Veoh', domains: ['veoh.com'], reportUrl: null }),
  platform({ key: 'mega', label: 'Mega', domains: ['mega.nz'], reportUrl: null }),
  platform({ key: 'googledrive', label: 'Google Drive', domains: ['drive.google.com'], reportUrl: null }),
  platform({ key: 'archiveorg', label: 'Internet Archive', domains: ['archive.org'], reportUrl: null }),
  platform({ key: 'peertube', label: 'PeerTube', domains: ['joinpeertube.org'], reportUrl: null }),
  platform({ key: 'dtube', label: 'DTube', domains: ['d.tube'], reportUrl: null }),
  platform({ key: 'mediafire', label: 'MediaFire', domains: ['mediafire.com'], reportUrl: null }),
  platform({ key: 'other', label: 'Other / Rogue Sites', domains: [], reportUrl: null })
]);

export const PLATFORM_CATALOG_BY_KEY = Object.freeze(
  Object.fromEntries(PLATFORM_CATALOG.map((entry) => [entry.key, entry]))
);
