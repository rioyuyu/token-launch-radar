// The token radar's program (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every rankable pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, writes the
// dashboard's data beside the page as /output/data.js, copies this
// repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// Strict on purpose: a missing or incomplete dashboard/ or screenshots/
// exits non-zero instead of writing a half entry. The dashboard and the
// screenshots are part of the entry, not optional extras.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`);
}

/** Every regular file under `dir`, relative paths, skipping dot names and dot directories. */
function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    const full = rel === '' ? dir : join(dir, rel);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const p = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) found.push(p);
    }
  };
  walk('');
  return found.sort();
}

const dashboardDir = join(here, 'dashboard');
if (!existsSync(dashboardDir) || !statSync(dashboardDir).isDirectory()) {
  fail('dashboard/ is missing: hand in the dashboard with the program');
}
const dashboardFiles = listFiles(dashboardDir);
const hasIndex = dashboardFiles.includes('index.html');
const hasCss = dashboardFiles.some((f) => f.endsWith('.css'));
const hasJs = dashboardFiles.some((f) => f.endsWith('.js'));
if (!hasIndex || !hasCss || !hasJs) {
  fail(
    `dashboard/ is incomplete: index.html ${hasIndex ? 'present' : 'missing'}, ` +
      `a .css file ${hasCss ? 'present' : 'missing'}, a .js file ${hasJs ? 'present' : 'missing'}`,
  );
}

const screenshotsDir = join(here, 'screenshots');
if (!existsSync(screenshotsDir) || !statSync(screenshotsDir).isDirectory()) {
  fail('screenshots/ is missing: hand in 3 screenshots, the board, a detail view and a filtered view');
}
const shots = readdirSync(screenshotsDir, { withFileTypes: true })
  .filter((e) => e.isFile() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
if (shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: hand in at most 4`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory tree's regular files into `to`, skipping dot names. */
function copyTree(from: string, to: string): void {
  for (const rel of listFiles(from)) {
    const dest = join(to, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(join(from, rel), dest);
  }
}

copyTree(dashboardDir, join(out, 'dashboard'));
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const name of shots) {
  copyFileSync(join(screenshotsDir, name), join(out, 'screenshots', name));
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
let dossier: Uint8Array;
try {
  dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
} catch (err) {
  fail(`dossier.json could not be written: ${err instanceof Error ? err.message : String(err)}`);
}
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
