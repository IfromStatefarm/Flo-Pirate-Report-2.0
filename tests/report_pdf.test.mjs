import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePDF } from '../server/report_pdf.js';
import { getJsPdfConstructor } from '../utils/pdf_common.js';

const mm = 72 / 25.4;
const metrics = new (getJsPdfConstructor())();
const fixture = {
  handle: 'fixture_reported_channel',
  reporterName: 'QA Fixture (not submitted)',
  eventName: 'Fixture Event',
  vertical: 'Test',
  reportId: 'QA-PDF-ONLY'
};

// Read the actual uncompressed jsPDF output, including escaped PDF literals.
// This intentionally supports only the single-line text/link operators used here.
const literal = String.raw`((?:\\[\s\S]|[^\\()])*)`;
const number = String.raw`(-?[\d.]+)`;
const unescapeLiteral = value => value.replace(/\\([\\()])/g, '$1');

async function readReport(items, overrides = {}) {
  const blob = await generatePDF({ ...fixture, items, ...overrides });
  assert.equal(blob.type, 'application/pdf', 'must not silently return fallback text');
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  const objects = new Map([...pdf.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)]
    .map(match => [match[1], match[2]]));
  return [...objects.values()].filter(object => /\/Type \/Page\b/.test(object)).map(object => {
    const [, width, height] = object.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).map(Number);
    const content = objects.get(object.match(/\/Contents (\d+) 0 R/)[1]);
    const texts = [...content.matchAll(/BT\n([\s\S]*?)\nET/g)].map(([, block]) => {
      const position = block.match(new RegExp(`${number} ${number} Td`));
      const text = block.match(new RegExp(`\\(${literal}\\) Tj`));
      assert.ok(position && text, 'unexpected text operator: update the test reader');
      const [, font, size] = block.match(/\/(F\d+) ([\d.]+) Tf/);
      return { text: unescapeLiteral(text[1]), x: +position[1], y: +position[2], font, size: +size };
    });
    const links = [...object.matchAll(new RegExp(
      `/Rect \\[${number} ${number} ${number} ${number}\\][^\\n]*?/URI \\(${literal}\\)`, 'g'
    ))].map(match => ({ rect: match.slice(1, 5).map(Number), url: unescapeLiteral(match[5]) }));
    return { width, height, texts, links };
  });
}

function assertCompleteTargets(pages, items) {
  for (const { url } of items) {
    const fragments = [];
    for (const page of pages) {
      for (const link of page.links.filter(link => link.url === url)) {
        const [left, top, right, bottom] = link.rect;
        assert.ok(left >= 15 * mm && right <= 121 * mm, 'URL link must stay in its column');
        assert.ok(bottom >= 15 * mm && top <= page.height - 15 * mm, 'link must stay on page');
        const text = page.texts.find(text => Math.abs(text.x - left) < 0.01 && text.y < top && text.y > bottom);
        assert.ok(text, 'each target link must annotate visible URL text');
        fragments.push(text.text);
      }
    }
    assert.equal(fragments.join(''), url, 'visible linked text must preserve the entire target');
  }
}

function assertLayout(pages) {
  for (const page of pages) {
    for (const text of page.texts) {
      metrics.setFont('helvetica', text.font === 'F2' ? 'bold' : 'normal');
      metrics.setFontSize(text.size);
      assert.ok(text.x >= 15 * mm - 0.1, `left clipping: ${text.text}`);
      assert.ok(text.x + metrics.getTextWidth(text.text) * mm <= page.width - 15 * mm + 0.1,
        `right clipping: ${text.text}`);
      assert.ok(text.y >= 15 * mm && text.y <= page.height - 15 * mm, `vertical clipping: ${text.text}`);
    }
    if (page.links.some(link => Math.abs(link.rect[0] - 17 * mm) < 0.01)) {
      for (const heading of ['URL', 'VIEWS', 'SCREENSHOT']) {
        assert.equal(page.texts.filter(text => text.text === heading).length, 1, 'repeat table headers on evidence pages');
      }
    }
  }
}

test('full target text and URI survive length boundaries, long handles and URL punctuation', async () => {
  const base = 'https://example.test/';
  const items = [54, 55, 56, 74, 200, 2048].map(length => ({
    url: base + 'x'.repeat(length - base.length), views: '1K'
  }));
  items.push({
    url: 'https://www.tiktok.com/@fixture_reported_channel/video/1234567890123456789',
    views: '2M', screenshotLink: 'https://example.test/evidence/fixture'
  }, {
    url: `https://example.test/@${'long_handle_'.repeat(30)}/video/987654321?tag=(fixture)&next=%2Fpath%3Fa%3D1#end`,
    views: 'N/A'
  });
  const pages = await readReport(items, { handle: 'long_handle_'.repeat(30) });
  assertCompleteTargets(pages, items);
  assertLayout(pages);
  assert.ok(pages.flatMap(page => page.links).some(link => link.url === items[6].screenshotLink));
  assert.ok(pages.flatMap(page => page.texts).some(text => text.text === 'TOTAL VIEWS AFFECTED: 2,006,000'));
});

test('large batches keep wrapped rows together and retain every target across page breaks', async () => {
  const items = Array.from({ length: 150 }, (_, index) => ({
    url: `https://www.tiktok.com/@${'fixture_handle_'.repeat(1 + index % 8)}/video/${String(index).padStart(19, '0')}`,
    views: String(index + 1),
    screenshotLink: index % 2 ? `https://example.test/evidence/${index}` : ''
  }));
  const pages = await readReport(items);
  assert.ok(pages.length > 5);
  assertCompleteTargets(pages, items);
  assertLayout(pages);
  for (const item of items) {
    const evidencePages = pages.filter(page => page.links.some(link => link.url === item.url));
    assert.equal(evidencePages.length, 1, 'ordinary wrapped rows should not split across pages');
    const page = evidencePages[0];
    const firstLink = page.links.find(link => link.url === item.url);
    const details = page.texts.filter(text => text.y < firstLink.rect[1] && text.y > firstLink.rect[3]);
    assert.ok(details.some(text => text.text === item.views && Math.abs(text.x - 125 * mm) < 0.01));
    assert.ok(details.some(text => text.text === (item.screenshotLink ? 'View Evidence' : 'No Image')));
  }
  assert.ok(pages.flatMap(page => page.texts).some(text => text.text === 'TOTAL VIEWS AFFECTED: 11,325'));
});

test('a URL taller than a page continues without clipping or losing characters', async () => {
  const item = {
    url: `https://example.test/${'wide_W_'.repeat(1500)}?last=complete`,
    views: '42', screenshotLink: 'https://example.test/evidence/oversized'
  };
  const pages = await readReport([item, { url: 'https://example.test/final-target', views: '1' }]);
  assertCompleteTargets(pages, [item, { url: 'https://example.test/final-target' }]);
  assertLayout(pages);
  const evidencePages = pages.filter(page => page.links.some(link => link.url === item.url));
  assert.ok(evidencePages.length > 2);
  for (const page of evidencePages) {
    assert.ok(page.texts.some(text => text.text === '42'));
    assert.ok(page.links.some(link => link.url === item.screenshotLink));
  }
});

test('an empty evidence table still produces a valid report', async () => {
  const pages = await readReport([]);
  assertLayout(pages);
  assert.ok(pages.flatMap(page => page.texts).some(text => text.text === 'TOTAL VIEWS AFFECTED: 0'));
});
