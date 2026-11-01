#!/usr/bin/env node
/**
 * Documentation integrity checker for PixelXpert.
 *
 * Verifies that:
 *   1. Every relative Markdown link in docs/ and AGENTS.md resolves to a file
 *      that exists.
 *   2. Every backticked repo path that looks like a source file exists on disk.
 *   3. Every JSON file under docs/reference/data/ parses.
 *   4. Every doc under docs/ is reachable from docs/README.md (no orphans).
 *   5. No banned marketing words appear in docs/ prose.
 *   6. Every doc under docs/ (except the index) is linked from somewhere.
 *
 * Usage:  node scripts/check-docs.mjs [--verbose]
 * Exit:   0 = clean, 1 = problems found
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DOCS = join(ROOT, 'docs');
const VERBOSE = process.argv.includes('--verbose');

const problems = [];
const warnings = [];
const stats = { files: 0, links: 0, paths: 0, json: 0 };

function fail(file, message) {
  problems.push(`${rel(file)}: ${message}`);
}
function warn(file, message) {
  warnings.push(`${rel(file)}: ${message}`);
}
function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const mdFiles = [...walk(DOCS)];
const agentsMd = join(ROOT, 'AGENTS.md');
if (existsSync(agentsMd)) mdFiles.push(agentsMd);

if (mdFiles.length === 0) {
  console.error('check-docs: no Markdown files found under docs/');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Rule 1: relative links resolve                                      */
/* ------------------------------------------------------------------ */

const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;

for (const file of mdFiles) {
  stats.files++;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // Strip fenced-code awareness is overkill here; links in code fences are rare
    // and a false positive is more useful than a false negative.
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const target = m[2].trim();
      stats.links++;

      if (
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('mailto:') ||
        target.startsWith('#')
      ) {
        continue;
      }

      // Strip anchor
      const withoutAnchor = target.split('#')[0];
      if (withoutAnchor === '') continue;

      const resolved = resolve(dirname(file), withoutAnchor);
      if (!existsSync(resolved)) {
        fail(file, `line ${i + 1}: broken link -> ${target}`);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Rule 2: backticked source paths exist                               */
/* ------------------------------------------------------------------ */

// Only check things that unambiguously look like a repo file path.
const pathRe = /`([A-Za-z0-9_./-]+\.(?:kt|kts|xml|json|yml|yaml|sh|bat|md|toml|properties|pro|aidl|gradle))`/g;
const pathPrefixes = [
  'app/', 'buildSrc/', 'gradle/', 'modPackProcessor/', 'MagiskModBase/',
  '.github/', 'docs/', 'scripts/', '.editorconfig', 'AGENTS.md',
];
// Files that legitimately do not exist in the repo (build outputs, generated).
const generatedPrefixes = ['app/build/', 'output/', 'build/'];

for (const file of mdFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    let m;
    pathRe.lastIndex = 0;
    while ((m = pathRe.exec(line)) !== null) {
      const p = m[1];
      const looksRepoPath = pathPrefixes.some((pre) => p.startsWith(pre));
      if (!looksRepoPath) continue;
      if (generatedPrefixes.some((pre) => p.includes(pre))) continue;
      stats.paths++;
      if (!existsSync(join(ROOT, p))) {
        fail(file, `line ${i + 1}: referenced path does not exist -> ${p}`);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Rule 3: JSON companions parse                                       */
/* ------------------------------------------------------------------ */

const dataDir = join(DOCS, 'reference', 'data');
if (existsSync(dataDir)) {
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(dataDir, entry.name);
    stats.json++;
    try {
      const parsed = JSON.parse(readFileSync(full, 'utf8'));
      if (VERBOSE) {
        const shape = Array.isArray(parsed) ? `array(${parsed.length})` : 'object';
        console.log(`  json ok: ${rel(full)} ${shape}`);
      }
    } catch (e) {
      fail(full, `invalid JSON: ${e.message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule 4 & 6: reachability from the index                             */
/* ------------------------------------------------------------------ */

const index = join(DOCS, 'README.md');
const reachable = new Set();

if (existsSync(index)) {
  const indexText = readFileSync(index, 'utf8');
  const dir = dirname(index);
  let m;
  linkRe.lastIndex = 0;
  while ((m = linkRe.exec(indexText)) !== null) {
    const target = m[2].trim();
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue;
    const withoutAnchor = target.split('#')[0];
    if (!withoutAnchor) continue;
    reachable.add(resolve(dir, withoutAnchor));
  }
} else {
  fail(index, 'docs/README.md (the index) does not exist');
}

for (const file of mdFiles) {
  if (file === index || file === agentsMd) continue;
  if (!reachable.has(resolve(file))) {
    fail(file, 'not linked from docs/README.md (orphan doc)');
  }
}

/* ------------------------------------------------------------------ */
/* Rule 5: banned marketing language                                   */
/* ------------------------------------------------------------------ */

const banned = [
  'seamless', 'cutting-edge', 'cutting edge', 'revolutionary', 'game-changing',
  'world-class', 'best-in-class', 'state-of-the-art', 'effortlessly',
  'leverage', 'synergy', 'robust solution', 'powerful solution',
];
// Only prose outside code fences.
// DOC_STYLE.md necessarily quotes the banned words in order to ban them, so it
// is exempt from this rule.
const styleContract = join(DOCS, 'agent', 'DOC_STYLE.md');
for (const file of mdFiles) {
  if (resolve(file) === resolve(styleContract)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const lower = line.toLowerCase();
    for (const word of banned) {
      if (lower.includes(word)) {
        warn(file, `line ${i + 1}: banned marketing word "${word}"`);
      }
    }
    // Emoji check: common pictographic ranges
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line)) {
      warn(file, `line ${i + 1}: emoji found in prose`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

console.log('');
console.log('check-docs');
console.log('----------');
console.log(`  markdown files : ${stats.files}`);
console.log(`  relative links : ${stats.links}`);
console.log(`  source paths   : ${stats.paths}`);
console.log(`  json companions: ${stats.json}`);
console.log('');

if (warnings.length) {
  console.log(`WARNINGS (${warnings.length})`);
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log('');
}

if (problems.length) {
  console.log(`PROBLEMS (${problems.length})`);
  for (const p of problems) console.log(`  x ${p}`);
  console.log('');
  console.log('FAIL');
  process.exit(1);
}

console.log('OK');
process.exit(0);
