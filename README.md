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

## Démarrage rapide dans ton projet

hachibi se lance **depuis la racine du projet git que tu veux outiller** (pas depuis hachibi
lui-même). Flux complet, de zéro :

```bash
# 1. Place-toi dans TON projet (celui dont tu veux implémenter les issues)
cd ~/projets/mon-app

# 2. Il te faut un dossier d'issues au format NN-*.md (typiquement la sortie de /to-issues).
#    Sinon, crée-en un à la main :
mkdir -p docs/issues/paiements
cat > docs/issues/paiements/01-schema-paiement.md <<'MD'
# Schéma de paiement

## Blocked by
none

## Critères d'acceptation
- Une transaction a un montant, une devise et un statut
MD

# 3. (optionnel) Installe hachibi en dépendance de dev du projet
npm i -D hachibi

# 4. Visualise le plan de vagues — AUCUN worker lancé, totalement sûr
npx hachibi docs/issues/paiements

# 5. Quand le plan te convient, lance pour de vrai
npx hachibi docs/issues/paiements --yes
```

À la fin, hachibi affiche un rapport et le nom de la **branche d'intégration** (ex.
`orchestrate/paiements-20260627143000`) où les issues réussies ont été fusionnées — ta
branche de travail n'a pas bougé. Revérifie cette branche (typecheck/lint/tests), puis
fusionne-la toi-même.

## Installation — 3 façons

> **`<issuesDir>`** (ci-dessous `docs/issues/ma-feature`) n'est pas un paramètre
> d'installation : c'est l'**argument d'exécution** — le dossier d'issues à implémenter. La
> commande `npx hachibi <issuesDir>` **installe ET lance** en une fois. La seule install
> *pure* (sans rien exécuter) est `npm i -D hachibi`.

| Méthode | Installer | Lancer |
|---------|-----------|--------|
| **npx à la demande** | rien (téléchargé au vol) | `npx hachibi docs/issues/ma-feature` |
| **dépendance de dev** | `npm i -D hachibi` | `npx hachibi docs/issues/ma-feature` |
| **GitHub** | rien (cloné au vol) | `npx github:2remdou/hachibi docs/issues/ma-feature` |

- **npx à la demande** — essai ponctuel, rien à installer.
- **dépendance de dev** — usage régulier : épingle la version dans ton `package.json`.
- **GitHub** — avant publication npm, ou pour une version non publiée.

En **dépendance de dev**, tu peux exposer un script dans le `package.json` de ton projet (le
dossier d'issues est figé dans le script) :

```json
{
  "scripts": {
    "issues": "hachibi docs/issues/paiements"
  }
}
```

puis `npm run issues` (plan) ou `npm run issues -- --yes` (exécution).

Depuis **GitHub**, tu peux épingler une branche, un tag ou un commit (le `#ref` porte sur la
version de hachibi, pas sur ton dossier d'issues) :

```bash
npx github:2remdou/hachibi#main docs/issues/ma-feature      # branche
npx github:2remdou/hachibi#v0.1.0 docs/issues/ma-feature    # tag
```

> `npx github:…` clone et **build** le package (script `prepare`, via `tsc`) : la première
> exécution est plus lente que via npm, et nécessite un accès au dépôt.

## Exemples d'utilisation des options

```bash
# Plan seul (comportement par défaut, sans --yes) — sûr, à faire en premier
npx hachibi docs/issues/paiements

# Lancer pour de vrai (workers claude en parallèle + merge auto)
npx hachibi docs/issues/paiements --yes

# Démarrage prudent : 1 worker à la fois, sans planificateur LLM (tri topologique déterministe)
npx hachibi docs/issues/paiements --yes --max-parallel 1 --no-planner

# Plus de parallélisme : 5 workers par vague
npx hachibi docs/issues/paiements --yes --max-parallel 5

# Modèle plus puissant pour planner + workers
npx hachibi docs/issues/paiements --yes --model claude-opus-4-8

# Repartir d'une autre base et nommer la branche d'intégration
npx hachibi docs/issues/paiements --yes --base develop --integration feat/paiements

# Ne PAS fusionner automatiquement — inspecter chaque branche de worker avant
npx hachibi docs/issues/paiements --yes --no-merge

# Conserver les worktrees même en cas de succès (debug)
npx hachibi docs/issues/paiements --yes --keep-worktrees

# Utiliser un fichier de config à un emplacement non standard
npx hachibi docs/issues/paiements --yes --config config/hachibi.prod.json
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
| `--config <path>` | Fichier de config JSON (défaut `<repo>/hachibi.config.json`) |
| `--init` | Écrit un `hachibi.config.json` exemple dans le repo courant |
| `--version` | Affiche la version |

## Configuration — `hachibi.config.json`

Tout est **auto-détecté** depuis le `package.json` de ton projet (gestionnaire de paquets,
scripts `typecheck`/`lint`/`test`, fichier de règles). Tu ne crées un `hachibi.config.json`
**à la racine de ton projet** que pour **surcharger** ce qui ne convient pas. Génère un
squelette prêt à éditer :

```bash
npx hachibi --init      # écrit hachibi.config.json à la racine du projet courant
```

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

> Un `.json` réel n'accepte pas les commentaires `//` (ici en `jsonc` pour l'explication).
> `npx hachibi --init` génère un fichier JSON **valide** (commentaires portés par des clés
> `_comment`). `--model` en ligne de commande l'emporte sur le `model` du fichier.

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
