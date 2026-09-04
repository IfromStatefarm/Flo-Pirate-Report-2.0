import './utils/theme_loader.js';

await globalThis.RightsReporterTheme.loadTheme();
await import('./popup/main.js');
