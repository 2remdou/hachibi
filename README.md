# hachibi 🐙

Tu as une liste de petites tâches à coder, chacune décrite dans un court fichier Markdown.
**hachibi confie chaque tâche à un agent Claude différent, qui la code tout seul dans une
copie isolée de ton projet — tous en même temps — puis rassemble le travail fini sur une
seule branche** que tu n'as plus qu'à relire et fusionner.

## Ce que fait hachibi, concrètement

**1. Tu fournis** un dossier de tâches : un fichier Markdown par tâche (on appelle ça une
*issue*). Le nom commence par un numéro, et une section `## Blocked by` dit de quelles autres
tâches elle dépend.

```
docs/issues/paiements/
├── 01-schema-paiement.md     →  "Créer le schéma de paiement"   (ne dépend de rien)
├── 02-page-checkout.md       →  "Page de paiement"              (dépend de 01)
└── 03-recu-email.md          →  "Email de reçu"                 (dépend de 01)
```

**2. hachibi travaille**, en une seule commande :

- il lit les tâches et voit lesquelles dépendent des autres (ici 02 et 03 attendent 01) ;
- il lance plusieurs **Claude en parallèle** — chacun code **une seule** tâche, seul, dans
  **sa propre copie de ton repo** (une copie de travail git jetable), sans se marcher dessus ;
- chaque Claude écrit le code **et les tests**, vérifie que tout passe, puis commite ;
- hachibi rassemble tous les commits réussis sur **une seule branche**.

**3. Tu obtiens** à la fin :

- une **branche** (ex. `orchestrate/paiements-…`) avec les tâches terminées, prêtes à relire ;
- un **rapport** : qui a réussi, qui a échoué et pourquoi ;
- **ton code de départ intact** — hachibi n'a jamais touché ta branche de travail : tout s'est
  passé dans des copies à part. Tu relis la branche produite, et si elle te convient, **c'est
  toi qui fusionnes**.

> En une phrase : *« code-moi ces tâches en parallèle, chacune dans son coin, et donne-moi une
> branche à relire ».*

## Ce qu'il te faut

- Être **dans un projet git** (hachibi travaille dans des copies de ce repo).
- Le **CLI `claude` installé et connecté** dans ton terminal — c'est lui qui code. hachibi
  s'appuie aussi sur tes commandes Claude `/tdd`, `/review`, `/simplify`
  ([détails](docs/adr/0002-assumes-claude-code-runtime.md)).
- **Node ≥ 18**.

## Installer et lancer

Trois étapes, **depuis ton projet** (un repo git) : installer, scaffolder, lancer.

```bash
cd ~/projets/mon-app                                  # ← ton projet

npm install --save-dev hachibi                        # 1. installe le moteur
npx hachibi init                                      # 2. crée .hachibi/ (main.ts, prompts/, config.json)

npx tsx .hachibi/main.ts docs/issues/paiements        # 3. affiche le PLAN (rien n'est codé) — sûr
npx tsx .hachibi/main.ts docs/issues/paiements --yes  # 4. code pour de vrai
```

Ce que fait chaque étape :

- **`npm install --save-dev hachibi`** — ajoute le moteur aux dépendances de dev de ton projet.
- **`npx hachibi init`** — dépose un dossier **`.hachibi/`** à la racine : `main.ts` (le point
  d'entrée), `prompts/` (les consignes données aux agents) et `config.json`. **Tout est
  éditable**, et se versionne avec ton projet.
- **`npx tsx .hachibi/main.ts <issuesDir>`** — lance hachibi. `tsx` exécute le TypeScript
  directement (aucun build). `<issuesDir>` est l'**argument** : le dossier de tâches à coder,
  pas un réglage d'installation.

Sans `--yes`, hachibi montre seulement le plan et s'arrête : **commence toujours par là.**

> **Raccourci** — fige la commande dans un script de ton `package.json` :
> `"scripts": { "issues": "tsx .hachibi/main.ts docs/issues/paiements" }`,
> puis `npm run issues` (plan) ou `npm run issues -- --yes` (pour de vrai).

> **Avant publication npm** — installe depuis GitHub puis `init` comme d'habitude :
> `npm i -D github:2remdou/hachibi` (épingle une version avec `#main` ou `#v0.1.0`).

## Exemples d'utilisation des options

Les options se passent à `.hachibi/main.ts` (après `npx hachibi init`) :

```bash
# Plan seul (comportement par défaut, sans --yes) — sûr, à faire en premier
npx tsx .hachibi/main.ts docs/issues/paiements

# Lancer pour de vrai (workers claude en parallèle + merge auto)
npx tsx .hachibi/main.ts docs/issues/paiements --yes

# Démarrage prudent : 1 worker à la fois, sans planificateur LLM (tri topologique déterministe)
npx tsx .hachibi/main.ts docs/issues/paiements --yes --max-parallel 1 --no-planner

# Plus de parallélisme : 5 workers par vague
npx tsx .hachibi/main.ts docs/issues/paiements --yes --max-parallel 5

# Modèle plus puissant pour planner + workers
npx tsx .hachibi/main.ts docs/issues/paiements --yes --model claude-opus-4-8

# Repartir d'une autre base et nommer la branche d'intégration
npx tsx .hachibi/main.ts docs/issues/paiements --yes --base develop --integration feat/paiements

# Ne PAS fusionner automatiquement — inspecter chaque branche de worker avant
npx tsx .hachibi/main.ts docs/issues/paiements --yes --no-merge

# Conserver les worktrees même en cas de succès (debug)
npx tsx .hachibi/main.ts docs/issues/paiements --yes --keep-worktrees

# Utiliser un fichier de config à un autre emplacement que .hachibi/config.json
npx tsx .hachibi/main.ts docs/issues/paiements --yes --config config/hachibi.prod.json
```

### Toutes les options

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
| `--config <path>` | Fichier de config JSON (défaut `.hachibi/config.json`) |

> Le **bin** `hachibi` (séparé du moteur) ne sert qu'au scaffolding : `npx hachibi init`
> (crée `.hachibi/`, `--force` pour écraser) et `npx hachibi --version`.

## Configuration — `.hachibi/config.json`

`npx hachibi init` a déjà créé **`.hachibi/config.json`** : tu n'as qu'à l'éditer. Tout est
**auto-détecté** depuis le `package.json` de ton projet (gestionnaire de paquets, scripts
`typecheck`/`lint`/`test`, fichier de règles) — ne renseigne une clé que pour **surcharger**.

Toutes les clés sont optionnelles. Référence complète annotée :

```jsonc
{
  // Parallélisme et robustesse
  "maxParallel": 3,                 // workers simultanés par vague
  "maxAttempts": 3,                 // tentatives max de la boucle gate ↔ revue adversariale
  "workerTimeoutMs": 1800000,       // tue un worker bloqué après 30 min

  // Modèles — `model` est le défaut ; chaque knob hérite de `model` s'il est vide
  "model": "claude-sonnet-4-6",
  "plannerModel": "",               // planificateur (lecture seule)
  "workerModel": "",                // session worker (/tdd, /review, /simplify y tournent)
  "adversarialReviewModel": "",     // sous-agent frais de la revue adversariale (étape 4)

  // Commandes du projet (sinon auto-détectées depuis package.json)
  "installCmd": "pnpm install --prefer-offline",
  "typecheckCmd": "pnpm typecheck",
  "lintCmd": "pnpm lint",
  "testCmd": "",                    // vide = le worker cible lui-même les tests touchés
  "rulesFile": "CLAUDE.md",         // règles projet lues par chaque worker

  // Skills invoquées par le worker (cf. prérequis)
  "tddCmd": "/tdd",
  "reviewCmd": "/review",
  "simplifyCmd": "/simplify",

  "coAuthor": "Co-Authored-By: Claude <noreply@anthropic.com>"
}
```

> Le `.json` réel n'accepte pas les commentaires `//` (ici en `jsonc` pour l'explication). Le
> `.hachibi/config.json` généré par `init` est un JSON **valide** : les commandes
> (`installCmd`/`typecheckCmd`/…) y sont **omises** (donc auto-détectées) et fournies en
> exemples sous des clés préfixées `_` (inertes). `--model` en ligne de commande l'emporte sur
> le `model` du fichier.

### Scénarios de config concrets

**Monorepo pnpm avec scripts custom** — surcharger les commandes auto-détectées :

```json
{
  "installCmd": "pnpm install --frozen-lockfile",
  "typecheckCmd": "pnpm -w typecheck",
  "lintCmd": "pnpm -w lint",
  "testCmd": "pnpm vitest run --changed"
}
```

**Modèles distincts par étape** — opus pour implémenter et réviser, sonnet (hérité) pour
planifier, afin d'équilibrer coût et qualité :

```json
{
  "model": "claude-sonnet-4-6",
  "workerModel": "claude-opus-4-8",
  "adversarialReviewModel": "claude-opus-4-8"
}
```

**Projet non-Node (Go, Python…)** — pas de `package.json`, on déclare tout explicitement :

```json
{
  "installCmd": "",
  "typecheckCmd": "go vet ./...",
  "lintCmd": "golangci-lint run",
  "testCmd": "go test ./...",
  "rulesFile": "AGENTS.md"
}
```

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
   `git worktree add` + install, puis un `claude -p` qui exécute `.hachibi/prompts/worker-prompt.md`.
4. **Merge auto** — chaque branche réussie est fusionnée dans la branche d'intégration. Un
   conflit → `merge --abort`, branche + worktree conservés, signalé dans le rapport.

Le **succès** d'un worker est mesuré sur la **vérité terrain** (un commit a-t-il été produit
sur sa branche ?), pas uniquement sur ce qu'il déclare.

## Stack-agnostique (multi-projets)

Rien n'est codé en dur pour un repo. `detectConfig` lit le `package.json` du projet cible :
gestionnaire de paquets (`pnpm`/`npm`/`yarn`), scripts `typecheck`/`lint`/`test`, fichier de
règles (`CLAUDE.md`/`AGENTS.md`/`.cursorrules`). Sur un projet **non-Node** (pas de
`package.json`), l'install est sautée — surcharge tout via `.hachibi/config.json` ou les flags.

## ⚠️ Limites à connaître

- **Coût** : N×`claude` en parallèle + un install par worktree. Commence avec
  `--max-parallel 2` et une seule vague.
- **Conflits** : le planificateur réduit la contention mais ne la supprime pas. Attends-toi à
  des conflits de merge à résoudre à la main sur des lots qui touchent beaucoup de fichiers
  partagés — ils sont signalés, pas écrasés.
- **Les PASS sont auto-déclarés** par des agents. **Revérifie toi-même** (typecheck/lint/tests
  rejoués + baseline avant/après) la branche d'intégration avant de la fusionner.

## Architecture & développement (contributeurs)

**Aucun build.** Le package livre directement du TypeScript ; `tsx` le transpile à la volée,
y compris depuis `node_modules` (cf. [ADR 0003](docs/adr/0003-scaffold-and-tsx.md)). Deux
morceaux :

- **`bin/hachibi.js`** (JavaScript pur) — le scaffolder : `hachibi init` copie `template/.hachibi/`
  dans le projet. En JS car le bin npm est lancé par `node` depuis `node_modules`, qui refuse
  le TypeScript ([ADR 0001](docs/adr/0001-typescript-compile-to-dist.md), désormais *superseded*).
- **`src/orchestrate.ts`** (TypeScript) — le moteur, exporté via `exports` et importé par
  `.hachibi/main.ts` (lancé par `tsx`).

```bash
npm install
npm run typecheck   # tsc --noEmit (aucun artefact émis)
```

Le glossaire du domaine est dans [CONTEXT.md](CONTEXT.md), les décisions dans [docs/adr/](docs/adr/).

## Licence

MIT
