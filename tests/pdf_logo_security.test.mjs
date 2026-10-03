import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePdfLogo } from '../utils/pdf_logo.js';
import { generatePDF } from '../server/report_pdf.js';
import { generateIntelligencePDF } from '../utils/pdf_gen.js';
import { buildRuntimeTheme } from '../utils/runtime_theme.js';

const tinyPng = `data:image/png;base64,${readFileSync(new URL('../images/rights-reporter-icon-16.png', import.meta.url)).toString('base64')}`;
const tinyGif = `data:image/gif;base64,${Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex').toString('base64')}`;
const theme = buildRuntimeTheme();
const report = { handle: 'fixture', reporterName: 'QA Fixture', eventName: 'Fixture', vertical: 'Test', items: [] };
const stats = {
  startDate: '2026-09-01', endDate: '2026-09-30', platformTotals: [], rawReportedNum: 0,
  totalUrls: 0, topScouts: [], topEnforcers: [], teamStats: [], eventViews: []
};

async function pdfText(blob) {
  assert.equal(blob.type, 'application/pdf');
  const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.match(text, /^%PDF-/);
  return text;
}

test('logo preflight bounds compressed bytes, dimensions and decoded RGBA bytes', () => {
  assert.deepEqual([validatePdfLogo(tinyPng).width, validatePdfLogo(tinyPng).height], [16, 16]);
  const hugeGif = Buffer.from('GIF89a\xff\xff\xff\xff\x80\x00\x00', 'latin1');
  assert.throws(() => validatePdfLogo(`data:image/gif;base64,${hugeGif.toString('base64')}`), /decoded dimensions/);
  assert.deepEqual([validatePdfLogo(tinyGif).width, validatePdfLogo(tinyGif).height], [1, 1]);
  const hugeFrame = Buffer.from(tinyGif.split(',')[1], 'base64');
  hugeFrame.writeUInt16LE(0xffff, 24); // GIF image descriptor width, despite a 1x1 canvas
  assert.throws(() => validatePdfLogo(`data:image/gif;base64,${hugeFrame.toString('base64')}`), /decoded dimensions/);
  assert.throws(() => validatePdfLogo(tinyPng.replace('image/png', 'image/gif')), /invalid image header/);
  assert.throws(() => validatePdfLogo(`data:image/png;base64,${'A'.repeat(1_400_000)}`), /exceeds 1 MB/);

  const hugePng = Buffer.from(tinyPng.split(',')[1], 'base64');
  hugePng.writeUInt32BE(2049, 16);
  assert.throws(() => validatePdfLogo(`data:image/png;base64,${hugePng.toString('base64')}`), /decoded dimensions/);
});

test('server report renders a bounded logo and skips a hostile GIF', async () => {
  const safe = await pdfText(await generatePDF({ ...report, customerContext: { ...theme, logoDataUrl: tinyPng } }));
  assert.ok(/\/Subtype \/Image\b/.test(safe), 'the report should embed its bounded logo');
  const gif = await pdfText(await generatePDF({ ...report, customerContext: { ...theme, logoDataUrl: tinyGif } }));
  assert.ok(/\/Subtype \/Image\b/.test(gif), 'the report should still embed a bounded GIF');
  const harmful = Buffer.from('GIF89a\xff\xff\xff\xff\x80\x00\x00', 'latin1');
  const hostile = await pdfText(await generatePDF({ ...report, customerContext: {
    ...theme, logoDataUrl: `data:image/gif;base64,${harmful.toString('base64')}`
  } }));
  assert.ok(!/\/Subtype \/Image\b/.test(hostile), 'the report should skip the hostile logo');
});

test('local briefing renders a bounded logo and skips a hostile GIF', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { storage: { sync: { get: async () => ({}) } } };
  try {
    const safe = await pdfText(await generateIntelligencePDF(stats, { ...theme, logoDataUrl: tinyPng }));
    assert.ok(/\/Subtype \/Image\b/.test(safe), 'the briefing should embed its bounded logo');
    const harmful = Buffer.from('GIF89a\xff\xff\xff\xff\x80\x00\x00', 'latin1');
    const hostile = await pdfText(await generateIntelligencePDF(stats, {
      ...theme, logoDataUrl: `data:image/gif;base64,${harmful.toString('base64')}`
    }));
    assert.ok(!/\/Subtype \/Image\b/.test(hostile), 'the briefing should skip the hostile logo');
  } finally {
    globalThis.chrome = previousChrome;
  }
});
