import './utils/theme_loader.js';
import './utils/assistant_preference.js';
import './sidepanel/main.js';

// The neutral theme is applied synchronously by theme_loader.js. Do not make
// access bootstrap depend on the service worker answering the first theme
// request: a newly-starting MV3 worker can leave that request pending.
void globalThis.RightsReporterTheme.loadTheme();
