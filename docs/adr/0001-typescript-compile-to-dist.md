# 0001 — Source TypeScript compilée vers dist/ (pas d'exécution directe du .ts)

L'orchestrateur d'origine (dans triton) tournait en `.ts` exécuté directement par Node,
sans build, grâce au type-stripping natif — un argument de vente assumé (« aucun build »).
Pour hachibi nous compilons au contraire la source TypeScript vers `dist/*.js` (via `tsc`)
et le `bin` pointe sur `dist/`.

**Pourquoi** : un package installé via npm vit sous `node_modules/`, et Node **refuse le
type-stripping pour tout fichier sous `node_modules`** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
Livrer un `.ts` rendrait donc `npx hachibi` non exécutable chez le consommateur — l'astuce
« .ts direct » ne marche que hors `node_modules` (cas de triton). Compiler vers du JS réel
est la seule façon de tourner sous `node_modules` tout en gardant un typage strict pour les
contributeurs.

**Considéré et écarté** : (a) livrer du JS écrit à la main → perte du type-check ;
(b) bundler esbuild → ne type-check pas seul, deux devDeps pour un fichier unique sans
dépendances à bundler. `tsc` type-check ET émet en une commande.
