#!/usr/bin/env node
/**
 * hachibi (bin) — scaffolder en JavaScript pur (zéro build).
 *
 * Le bin npm est exécuté par `node` depuis node_modules ; or Node refuse le type-stripping
 * sous node_modules (cf. docs/adr/0001). Le bin est donc en JS, et se limite au scaffolding :
 *
 *   npx hachibi init        copie le template dans <repo>/.hachibi/
 *
 * L'orchestration elle-même vit dans le moteur TypeScript (src/orchestrate.ts), lancé via tsx
 * depuis le wrapper scaffoldé (.hachibi/main.ts) — cf. docs/adr/0003.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const TEMPLATE_DIR = join(PKG_ROOT, 'template');

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

function help() {
  console.log(`hachibi v${version()} — build parallèle d'issues (worktrees isolés + claude headless)

Installe puis scaffolde, et lance via tsx :

  npm install --save-dev hachibi
  npx hachibi init                              # crée .hachibi/ (main.ts, prompts/, config.json)
  npx tsx .hachibi/main.ts docs/issues/x        # affiche le PLAN (rien n'est codé) — sûr
  npx tsx .hachibi/main.ts docs/issues/x --yes  # code pour de vrai

Commandes du bin :
  init        Copie le template dans <repo>/.hachibi/
  --force     Avec init : écrase un .hachibi/ existant
  --version   Affiche la version
  --help      Cette aide

Options d'exécution (passées à .hachibi/main.ts) : voir
  npx tsx .hachibi/main.ts --help
`);
}

function doInit(force) {
  const root = repoRoot();
  const dest = join(root, '.hachibi');
  if (existsSync(dest) && !force) {
    console.error(`⚠️  ${dest} existe déjà. Relance avec --force pour écraser, ou édite-le à la main.`);
    process.exit(1);
  }
  cpSync(join(TEMPLATE_DIR, '.hachibi'), dest, { recursive: true });
  // npm exclut les fichiers .gitignore des packages → on l'écrit ici.
  writeFileSync(
    join(dest, '.gitignore'),
    '# Artefacts d\'exécution hachibi (worktrees jetables, logs) — à ne pas committer.\n' +
      '# Le reste (main.ts, prompts/, config.json) est à versionner.\n' +
      'worktrees/\n*.log\n',
  );
  console.log(`✅ Scaffold créé : .hachibi/ (main.ts, prompts/, config.json)

Prochaines étapes :
  1. (optionnel) édite .hachibi/config.json et .hachibi/prompts/*.md
  2. npx tsx .hachibi/main.ts docs/issues/ma-feature          # plan (sûr)
  3. npx tsx .hachibi/main.ts docs/issues/ma-feature --yes     # pour de vrai`);
}

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(version());
} else if (args[0] === 'init') {
  doInit(args.includes('--force'));
} else {
  help();
  // help explicite => 0 ; commande inconnue => 1
  if (!(args.includes('--help') || args.includes('-h') || args.length === 0)) process.exit(1);
}
