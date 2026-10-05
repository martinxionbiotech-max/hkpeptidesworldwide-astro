#!/usr/bin/env node
/**
 * generate-markdown.mjs — build-time Markdown mirrors for ALL sitemap pages.
 *
 * Runs AFTER `astro build`. Reads dist HTML for every sitemap URL, extracts
 * <main>, converts to Markdown, writes:
 *   - dist/markdown/<path>.md   (e.g. /markdown/products/tirzepatide-15mg-high-purity-research-peptide.md)
 *   - dist/markdown/index.md    (listing of all mirrors)
 *   - dist/llms-full.txt        (entire corpus in one file)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const SITE = 'https://hkpeptides.net';
const DIST = 'dist';
const MD_ROOT = join(DIST, 'markdown');
const GENERATED_ON = new Date().toISOString().slice(0, 10);

const nhm = new NodeHtmlMarkdown({ keepDataImages: false, useInlineLinks: true });

function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');
}

function extractMain(html) {
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return m ? stripNoise(m[1]) : '';
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&minus;/g, '\u2212')
    .replace(/&deg;/g, '\u00b0')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function titleFromHtml(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return decodeEntities(t[1].replace(/\s+/g, ' ').trim());
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return decodeEntities(h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  return '';
}

function collectSitemapUrls() {
  const candidates = ['sitemap-0.xml', 'sitemap-index.xml'];
  for (const f of candidates) {
    const p = join(DIST, f);
    if (!existsSync(p)) continue;
    const xml = readFileSync(p, 'utf8');
    if (f === 'sitemap-index.xml') {
      const inner = xml.match(/<loc>([^<]+)<\/loc>/);
      if (!inner) continue;
      const innerFile = join(DIST, inner[1].replace(/^\/|\/$/g, '').split('/').pop());
      if (existsSync(innerFile)) {
        const innerXml = readFileSync(innerFile, 'utf8');
        return [...innerXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      }
    }
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }
  return [];
}

function htmlPathForUrl(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/') return join(DIST, 'index.html');
  return join(DIST, pathname.slice(1).replace(/\/$/, ''), 'index.html');
}

function relPathForUrl(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/') return 'home';
  return pathname.slice(1).replace(/\/$/, '');
}

function main() {
  const urls = collectSitemapUrls();
  if (urls.length === 0) {
    console.error('[md-gen] no sitemap found in dist/ — run `astro build` first.');
    process.exit(1);
  }

  if (existsSync(MD_ROOT)) rmSync(MD_ROOT, { recursive: true, force: true });
  mkdirSync(MD_ROOT, { recursive: true });

  const entries = [];
  const seen = new Set();

  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (!url.startsWith(SITE)) continue;
    if (url.endsWith('/home/')) continue; // legacy 301 URL, not a real page

    const htmlPath = htmlPathForUrl(url);
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, 'utf8');
    const mainHtml = extractMain(html);
    if (!mainHtml) continue;

    const title = titleFromHtml(html);
    const body = decodeEntities(nhm.translate(mainHtml)).replace(/\n{3,}/g, '\n\n').trim();
    if (body.length < 80) continue;

    const rel = relPathForUrl(url);
    const md = `---\ntitle: ${JSON.stringify(title)}\nsource: ${url}\nlanguage: en\ngenerated: ${GENERATED_ON}\n---\n\n> Source: ${url}\n\n${body}\n`;

    const outPath = join(MD_ROOT, rel + '.md');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, md, 'utf8');
    entries.push({ url, title, rel });
  }

  // Listing index
  const listing = [
    '# HK Peptides Worldwide — Markdown Mirrors',
    '',
    `> Source: ${SITE} — generated ${GENERATED_ON}, ${entries.length} mirrors.`,
    '> Full corpus in one file: [llms-full.txt](/llms-full.txt)',
    '',
    ...entries.map((e) => `- [${e.rel}](/${e.rel === 'home' ? '' : 'markdown/' + e.rel + '.md'})`),
    '',
  ].join('\n');
  writeFileSync(join(MD_ROOT, 'index.md'), listing, 'utf8');

  // Full corpus
  const fullParts = [
    `# HK Peptides Worldwide — Full Markdown Corpus`,
    '',
    `> Source: ${SITE}`,
    `> Generated: ${GENERATED_ON}`,
    '',
  ];
  for (const e of entries) {
    const content = readFileSync(join(MD_ROOT, e.rel + '.md'), 'utf8').split('\n').slice(5).join('\n');
    fullParts.push(`\n---\n\n# ${e.title}\n\n> Source: ${e.url}\n\n${content}`);
  }
  const full = fullParts.join('\n');
  writeFileSync(join(DIST, 'llms-full.txt'), full, 'utf8');

  console.log(
    `[md-gen] ${entries.length} mirrors -> /markdown/ ; llms-full.txt ${(full.length / 1024).toFixed(0)}KB`
  );
}

main();
