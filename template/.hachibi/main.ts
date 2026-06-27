#!/usr/bin/env -S npx tsx
/**
 * Point d'entrée hachibi pour CE projet.
 *
 *   npx tsx .hachibi/main.ts <issuesDir>          # affiche le plan (rien n'est codé) — sûr
 *   npx tsx .hachibi/main.ts <issuesDir> --yes    # code pour de vrai
 *   npx tsx .hachibi/main.ts --help               # toutes les options
 *
 * La logique vient du package `hachibi` (devDependency). Les prompts (.hachibi/prompts/*.md)
 * et la config (.hachibi/config.json) sont lus depuis ce dossier — édite-les librement.
 *
 * Usage avancé : run() accepte { promptsDir, configPath, argv } si tu veux pointer ailleurs.
 */
import { run } from 'hachibi';

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
