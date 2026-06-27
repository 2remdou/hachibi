#!/usr/bin/env node
/**
 * hachibi (bin) — scaffolder + lanceur, en JavaScript pur (zéro build).
 *
 * Le bin npm est exécuté par `node` depuis node_modules ; or Node refuse le type-stripping
 * sous node_modules (cf. docs/adr/0001). Le bin reste donc en JS. Il fait trois choses :
 *
 *   npx hachibi init                     copie le template dans <repo>/.hachibi/
 *   npx hachibi update                   met à jour .hachibi/ sans rien écraser (.new)
 *   npx hachibi run <issuesDir> [opts]   lance .hachibi/main.ts via le tsx embarqué
 *
 * L'orchestration vit dans le moteur TypeScript (src/orchestrate.ts), transpilé par tsx
 * (cf. docs/adr/0003).
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const TEMPLATE_DIR = join(PKG_ROOT, 'template', '.hachibi');

const GITIGNORE =
  '# Artefacts d\'exécution hachibi (worktrees jetables, logs) — à ne pas committer.\n' +
  '# Le reste (main.ts, prompts/, config.json) est à versionner.\n' +
  'worktrees/\n*.log\n';

function version() {
  try {
    return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

// Liste récursive des chemins de fichiers (relatifs) sous `dir`.
function listFiles(dir, base = '') {
  const out = [];
  for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? join(base, e.name) : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

function help() {
  console.log(`hachibi v${version()} — build parallèle d'issues (worktrees isolés + claude headless)

  npm install --save-dev hachibi
  npx hachibi init                              # crée .hachibi/ (main.ts, prompts/, config.json)
  npx hachibi run docs/issues/x                 # affiche le PLAN (rien n'est codé) — sûr
  npx hachibi run docs/issues/x --yes           # code pour de vrai

Commandes :
  init                     Crée .hachibi/ (erreur si présent ; --force pour écraser)
  update                   Met à jour .hachibi/ SANS rien écraser : crée les nouveaux
                           fichiers, écrit les modifiés en ".new" à comparer, préserve
                           ton config.json
  run <issuesDir> [opts]   Lance .hachibi/main.ts via le tsx EMBARQUÉ dans hachibi
                           (marche même si ton projet n'a pas tsx). Options : voir
                           "npx hachibi run --help"
  --version                Affiche la version
  --help                   Cette aide

Alternative équivalente à "run" si tu as tsx : npx tsx .hachibi/main.ts <issuesDir> [opts]
`);
}

function doInit(force) {
  const dest = join(repoRoot(), '.hachibi');
  if (existsSync(dest) && !force) {
    console.error(`⚠️  ${dest} existe déjà. Relance avec --force pour écraser, "npx hachibi update" pour mettre à jour sans écraser, ou édite-le à la main.`);
    process.exit(1);
  }
  cpSync(TEMPLATE_DIR, dest, { recursive: true });
  writeFileSync(join(dest, '.gitignore'), GITIGNORE); // npm exclut les .gitignore des packages
  console.log(`✅ Scaffold créé : .hachibi/ (main.ts, prompts/, config.json)

Prochaines étapes :
  1. (optionnel) édite .hachibi/config.json et .hachibi/prompts/*.md
  2. npx hachibi run docs/issues/ma-feature          # plan (sûr)
  3. npx hachibi run docs/issues/ma-feature --yes     # pour de vrai`);
}

// Met à jour .hachibi/ sans rien détruire : nouveaux fichiers créés, fichiers modifiés
// déposés en "<fichier>.new" (à comparer/fusionner), identiques ignorés. config.json préservé.
function doUpdate() {
  const dest = join(repoRoot(), '.hachibi');
  if (!existsSync(dest)) {
    console.error('⚠️  Pas de .hachibi/ — lance d\'abord : npx hachibi init');
    process.exit(1);
  }
  if (!existsSync(join(dest, '.gitignore'))) writeFileSync(join(dest, '.gitignore'), GITIGNORE);

  let created = 0, proposed = 0, same = 0;
  const news = [];
  for (const rel of listFiles(TEMPLATE_DIR)) {
    const tpl = readFileSync(join(TEMPLATE_DIR, rel), 'utf8');
    const target = join(dest, rel);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tpl);
      created++;
    } else if (readFileSync(target, 'utf8') === tpl) {
      same++;
    } else {
      writeFileSync(`${target}.new`, tpl);
      proposed++;
      news.push(`.hachibi/${rel}.new`);
    }
  }
  console.log(`✅ update : ${created} ajout(s), ${proposed} mise(s) à jour proposée(s), ${same} inchangé(s).`);
  if (news.length) {
    console.log('Compare puis remplace si tu veux (ton fichier actuel n\'a pas été touché) :');
    for (const n of news) console.log(`   ${n}`);
  }
}

// Lance .hachibi/main.ts via le tsx embarqué dans hachibi (résolu depuis ce package), pour ne
// pas dépendre d'un tsx présent dans le projet (utile en npm link / install file:).
function doRun(passthrough) {
  const wrapper = join(repoRoot(), '.hachibi', 'main.ts');
  if (!existsSync(wrapper)) {
    console.error('⚠️  .hachibi/main.ts introuvable — lance d\'abord : npx hachibi init');
    process.exit(1);
  }
  let tsxCli;
  try {
    const require = createRequire(import.meta.url);
    const tsxPkg = require.resolve('tsx/package.json');
    const bin = JSON.parse(readFileSync(tsxPkg, 'utf8')).bin;
    tsxCli = join(dirname(tsxPkg), typeof bin === 'string' ? bin : bin.tsx);
  } catch {
    console.error('tsx introuvable dans hachibi. Réinstalle hachibi, ou lance : npx tsx .hachibi/main.ts <issuesDir>');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [tsxCli, wrapper, ...passthrough], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(version());
} else if (args[0] === 'init') {
  doInit(args.includes('--force'));
} else if (args[0] === 'update') {
  doUpdate();
} else if (args[0] === 'run') {
  doRun(args.slice(1));
} else {
  help();
  if (!(args.includes('--help') || args.includes('-h') || args.length === 0)) process.exit(1);
}
