// md-negotiation: build-time Markdown generation from final dist HTML.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const DIST = 'dist';
const SKIP_DIRS = new Set(['_astro', 'images', '_md']);

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name === '_md') continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.name.endsWith('.html')) {
      yield path.join(dir, e.name);
    }
  }
}

function isEligible(html) {
  if (/<meta\s+http-equiv=["']refresh/i.test(html)) return { ok: false, reason: 'redirect' };
  if (/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) return { ok: false, reason: 'noindex' };
  return { ok: true };
}

function extractMain(html) {
  const m = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!m) return null;
  return m[1].replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

const manifest = {};
let generated = 0;
const skipped = [];
const warnings = [];

for await (const file of walk(DIST)) {
  const rel = path.relative(DIST, file).split(path.sep);
  if (rel.join('/') === '404.html' || rel[0] === '404.html') { skipped.push(['404.html', 'error-page']); continue; }
  const html = await readFile(file, 'utf8');
  const elig = isEligible(html);
  if (!elig.ok) { skipped.push([rel.join('/'), elig.reason]); continue; }
  const mainHtml = extractMain(html);
  if (!mainHtml || mainHtml.trim().length < 80) { skipped.push([rel.join('/'), 'no-main-content']); continue; }
  let md = NodeHtmlMarkdown.translate(mainHtml, { keepDataImages: false }).trim();
  if (md.length < 40) { skipped.push([rel.join('/'), 'empty-after-conversion']); continue; }
  const mdFile = file.replace(/\.html$/, '.md');
  await writeFile(mdFile, md + '\n', 'utf8');
  let pub = '/' + rel.slice(0, -1).join('/');
  if (rel[rel.length - 1] !== 'index.html') pub += '/' + rel[rel.length - 1].replace(/\.html$/, '');
  const key = pub === '' ? '/' : pub.endsWith('/') ? pub : pub + '/';
  manifest[key] = key === '/' ? '/index.md' : key + 'index.md';
  generated++;
}

let missing = 0;
for (const [k, v] of Object.entries(manifest)) {
  const f = path.join(DIST, v.replace(/^\//, ''));
  try { await readFile(f, 'utf8'); } catch { missing++; delete manifest[k]; warnings.push(`missing md for ${k}`); }
}

await mkdir(path.join(DIST, '_md'), { recursive: true });
await writeFile(path.join(DIST, '_md', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`[md-negotiation] generated=${generated} skipped=${skipped.length} missing=${missing}`);
for (const [p, why] of skipped.slice(0, 20)) console.log(`  skip ${p} (${why})`);
for (const w of warnings) console.log(`  warn: ${w}`);
if (generated === 0 || Object.keys(manifest).length === 0 || missing > 0) {
  console.error('[md-negotiation] critical integrity error — build fails');
  process.exit(1);
}
