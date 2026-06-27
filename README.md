# hachibi 🐙

**Build parallèle d'issues Markdown** via worktrees git isolés + agents `claude` headless.
Stack-agnostique, installable avec **`npx` dans n'importe quel projet git**.

Prend un dossier de fichiers `NN-*.md` (la sortie typique de `/to-issues`) et l'implémente
**en parallèle** : un planificateur découpe en vagues, puis chaque issue est confiée à un
`claude` headless isolé dans son propre worktree git, qui suit la discipline
« implement-verified » (`/tdd` → gate objectif → revue adversariale fraîche → `/review` →
`/simplify` → commit). Les branches réussies sont fusionnées dans une branche d'intégration.

S'insère après une chaîne locale type : `/grill-with-docs` → `/to-prd` → `/to-issues` → **`hachibi`**.

## ⚠️ Prérequis — hachibi est un outil Claude Code

hachibi **présuppose un runtime Claude Code** (il ne dégrade pas si absent — cf.
[ADR 0002](docs/adr/0002-assumes-claude-code-runtime.md)) :

- **`claude` CLI** sur le `PATH`, **authentifié dans ton terminal** : hachibi lance des
  sous-processus `claude -p` qui réutilisent ton auth.
- Les skills **`/tdd`, `/review`, `/simplify`** disponibles dans ton install claude — le
  worker les invoque. (Renommables/désactivables via config, mais c'est le mode supporté.)
- **Node ≥ 18** et le projet cible est un **dépôt git** (hachibi travaille dans des
  worktrees ; l'arbre principal n'est **jamais** touché, tes modifs non commitées restent).

## Installation

hachibi se lance dans la racine du **projet git que tu veux outiller** (pas dans hachibi lui-même).

### Depuis npm (recommandé)

Sans rien installer, à la demande :

```bash
npx hachibi docs/issues/ma-feature
```

Ou en dépendance de dev du projet (évite le re-téléchargement à chaque appel) :

```bash
npm i -D hachibi
npx hachibi docs/issues/ma-feature
# ou via un script package.json : "issues": "hachibi docs/issues/ma-feature"
```

### Depuis GitHub (avant publication npm, ou pour une version non publiée)

```bash
# Dernier commit de la branche par défaut
npx github:2remdou/hachibi docs/issues/ma-feature

# Épingler une branche, un tag ou un commit
npx github:2remdou/hachibi#main docs/issues/ma-feature
npx github:2remdou/hachibi#v0.1.0 docs/issues/ma-feature
```

> `npx github:…` clone et **build** le package (script `prepare`, via `tsc`) — la première
> exécution est plus lente que via npm. Nécessite un accès au dépôt.

## Exemples d'utilisation

```bash
# 1. Voir le plan de vagues — AUCUN worker lancé, totalement sûr. À faire en premier.
npx hachibi docs/issues/ma-feature

# 2. Lancer pour de vrai (lance les workers claude en parallèle)
npx hachibi docs/issues/ma-feature --yes

# 3. Démarrage prudent : 1 worker à la fois, plan déterministe (sans planificateur LLM)
npx hachibi docs/issues/ma-feature --yes --max-parallel 1 --no-planner

# 4. Forcer un modèle plus puissant pour planner + workers
npx hachibi docs/issues/ma-feature --yes --model claude-opus-4-8

# 5. Partir d'une autre base et nommer la branche d'intégration
npx hachibi docs/issues/ma-feature --yes --base develop --integration feat/ma-feature

# 6. Ne pas fusionner automatiquement (inspecter chaque branche avant)
npx hachibi docs/issues/ma-feature --yes --no-merge

# 7. Générer un fichier de config à éditer (modèles par étape, commandes…), puis lancer
npx hachibi --init
npx hachibi docs/issues/ma-feature --yes
```

### Options

| Flag | Effet |
|------|-------|
| `--yes` | Lance réellement les workers (sinon : plan uniquement, sûr) |
| `--plan-only` | Affiche le plan puis quitte |
| `--no-planner` | Saute le planificateur LLM, utilise le tri topologique déterministe |
| `--max-parallel <n>` | Workers simultanés par vague (défaut 3) |
| `--model <id>` | Modèle par défaut planner + workers (défaut `claude-sonnet-4-6`) |
| `--base <ref>` | Base de la branche d'intégration (défaut `HEAD`) |
| `--integration <name>` | Nom de la branche d'intégration (défaut auto-horodaté) |
| `--no-merge` | Ne fusionne pas automatiquement (laisse branches + worktrees) |
| `--keep-worktrees` | Conserve les worktrees même en cas de succès |
| `--config <path>` | Fichier de config JSON (défaut `<repo>/hachibi.config.json`) |
| `--init` | Écrit un `hachibi.config.json` exemple dans le repo courant |
| `--version` | Affiche la version |

### Modèles par étape

`--model` fixe le défaut global. Le **réglage fin par étape** se fait dans
`hachibi.config.json` (chaque champ hérite de `model` si vide) :

| Champ config | Processus ciblé |
|--------------|-----------------|
| `plannerModel` | Le planificateur (lecture seule) |
| `workerModel` | La session worker (`/tdd`, `/review`, `/simplify` y tournent) |
| `adversarialReviewModel` | Le sous-agent frais de la revue adversariale (étape 4) |

Génère un fichier de config à éditer : `npx hachibi --init`.

## Format des issues (contrat d'entrée)

Un fichier par issue, nommé `NN-slug.md` (ex. `01-organisations-liste.md`). hachibi lit :

- Le **titre** : la première ligne `# ...`.
- Les **dépendances** : la section `## Blocked by` (les numéros y sont extraits ;
  `none`/`aucun`/absence de section = aucune dépendance). Exemple :

```markdown
# Organisations — liste & détail

## Blocked by
- 02 (schéma partagé)

## Critères d'acceptation
- ...
```

## Comment ça marche

1. **Parsing** — lit chaque `NN-*.md`, extrait titre + dépendances → DAG.
2. **Planificateur** (`claude -p`, lecture seule) — propose des **vagues** respectant les
   dépendances **et la contention de fichiers**. Repli déterministe (tri topologique) si le
   LLM échoue ou produit un plan invalide.
3. **Workers** — par vague, jusqu'à `maxParallel` issues en parallèle. Chaque worker :
   `git worktree add` + install, puis un `claude -p` qui exécute `prompts/worker-prompt.md`.
4. **Merge auto** — chaque branche réussie est fusionnée dans la branche d'intégration. Un
   conflit → `merge --abort`, branche + worktree conservés, signalé dans le rapport.

Le **succès** d'un worker est mesuré sur la **vérité terrain** (un commit a-t-il été produit
sur sa branche ?), pas uniquement sur ce qu'il déclare.

## Stack-agnostique (multi-projets)

Rien n'est codé en dur pour un repo. `detectConfig` lit le `package.json` du projet cible :
gestionnaire de paquets (`pnpm`/`npm`/`yarn`), scripts `typecheck`/`lint`/`test`, fichier de
règles (`CLAUDE.md`/`AGENTS.md`/`.cursorrules`). Sur un projet **non-Node** (pas de
`package.json`), l'install est sautée — surcharge tout via `hachibi.config.json` ou les flags.

## ⚠️ Limites à connaître

- **Coût** : N×`claude` en parallèle + un install par worktree. Commence avec
  `--max-parallel 2` et une seule vague.
- **Conflits** : le planificateur réduit la contention mais ne la supprime pas. Attends-toi à
  des conflits de merge à résoudre à la main sur des lots qui touchent beaucoup de fichiers
  partagés — ils sont signalés, pas écrasés.
- **Les PASS sont auto-déclarés** par des agents. **Revérifie toi-même** (typecheck/lint/tests
  rejoués + baseline avant/après) la branche d'intégration avant de la fusionner.

## Développement (contributeurs)

Source TypeScript dans `src/`, compilée vers `dist/` par `tsc` (cf.
[ADR 0001](docs/adr/0001-typescript-compile-to-dist.md)) — un `.ts` ne peut pas être exécuté
sous `node_modules`, d'où le build.

```bash
npm install
npm run build      # tsc -p . → dist/
npm run dev        # tsc --watch
```

Le glossaire du domaine est dans [CONTEXT.md](CONTEXT.md), les décisions dans [docs/adr/](docs/adr/).

## Licence

MIT
