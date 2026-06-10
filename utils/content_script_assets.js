export const PLATFORM_REGISTRY_FILES = Object.freeze([
  'platforms/shared/platform_registry.js'
]);

export const SCRAPER_MODULE_FILES = Object.freeze([
  'platforms/scrapers/youtube.js',
  'platforms/scrapers/tiktok.js',
  'platforms/scrapers/twitter.js',
  'platforms/scrapers/instagram.js',
  'platforms/scrapers/facebook.js',
  'platforms/scrapers/kick.js',
  'platforms/scrapers/twitch.js',
  'platforms/scrapers/rumble.js',
  'platforms/scrapers/discord.js'
]);

export const AUTOFILL_MODULE_FILES = Object.freeze([
  'platforms/autofill/youtube.js',
  'platforms/autofill/tiktok.js',
  'platforms/autofill/twitter.js',
  'platforms/autofill/instagram.js',
  'platforms/autofill/facebook.js',
  'platforms/autofill/kick.js',
  'platforms/autofill/twitch.js',
  'platforms/autofill/rumble.js'
]);

export const CONTENT_SCRAPER_INJECTION_FILES = Object.freeze([
  ...PLATFORM_REGISTRY_FILES,
  ...SCRAPER_MODULE_FILES,
  'content_scraper.js'
]);

export const CONTENT_AUTOFILL_INJECTION_FILES = Object.freeze([
  ...PLATFORM_REGISTRY_FILES,
  ...AUTOFILL_MODULE_FILES,
  'content_autofill.js'
]);
