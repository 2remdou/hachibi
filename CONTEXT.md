# hachibi

Orchestrateur de build parallèle : implémente un lot d'issues Markdown en parallèle via
des agents `claude` headless isolés dans des worktrees git, puis fusionne les réussites
dans une branche d'intégration.

## Language

**Issue**:
Une unité de travail livrable, décrite par un fichier `NN-slug.md` (un titre `#` et une
section `## Blocked by`). C'est l'unité atomique qu'un worker implémente.
_Avoid_: ticket, tâche, story (dans le code/la doc de hachibi)

**Blocked by**:
La section d'une issue qui déclare ses dépendances (les numéros d'autres issues qui
doivent être terminées avant). Absence de section ou « none »/« aucun » = sans dépendance.
_Avoid_: dependencies, depends-on, requires

**Issue faite** (`## Status`):
Une issue dont la section `## Status` vaut `done`/`fait`/`terminé` (ou `✅`/`[x]`). hachibi
l'**écarte** de la sélection avant de planifier ; ses dépendants la traitent comme un bloqueur
satisfait. hachibi **pose lui-même** ce marqueur sur les issues qu'il intègre (dans la branche
d'intégration ; désactivable par `--no-mark-done`). À distinguer de `--skip` (écart ad hoc,
non persistant) et du verdict **PASS** d'un worker (résultat d'un run, pas un état d'entrée).
_Avoid_: done (en anglais dans la doc FR), terminée/fermée employées sans le marqueur

**Wave** (Vague):
Un ensemble d'issues implémentables **en parallèle** sans se bloquer (dépendances) ni se
marcher dessus (contention de fichiers). Les vagues sont exécutées en série, les issues
d'une vague en parallèle.
_Avoid_: batch, lot, étape, round

**Contention de fichiers**:
Le risque que deux issues modifient les mêmes fichiers (types partagés, index de service,
layout…). Le planificateur sépare les issues en contention dans des vagues différentes
pour éviter les conflits de merge.
_Avoid_: collision, conflit (réserver « conflit » au conflit de merge git effectif)

**Planificateur** (Planner):
Le processus `claude -p` en **lecture seule** qui lit les specs et regroupe les issues en
vagues, en respectant dépendances + contention. Repli déterministe (tri topologique) s'il
échoue.
_Avoid_: scheduler, planner (en français dans la doc)

**Worker**:
Un processus `claude -p` headless qui implémente **une seule** issue, seul dans son propre
worktree git, en suivant la discipline « implement-verified ». Tourne au `workerModel`.
_Avoid_: agent (trop général), runner, builder

**Revue adversariale** (Adversarial review):
L'étape où le worker lance un **sous-agent frais** dont la consigne est de **réfuter** que
l'issue est finie (preuve `fichier:ligne` par critère, chasse aux anti-tells). Défaut =
FAIL en cas de doute. Peut tourner à son propre modèle (`adversarialReviewModel`).
_Avoid_: review (réservé à la skill `/review` de finition), QA

**Branche d'intégration** (Integration branch):
La branche dans laquelle les branches de workers réussis sont fusionnées, dans un worktree
d'intégration dédié. **L'arbre de travail principal n'est jamais touché.**
_Avoid_: branche cible, main, trunk

**Vérité terrain** (Ground truth):
Le critère de succès d'un worker : **un commit a-t-il réellement été produit** sur sa
branche — et non le verdict PASS/FAIL que l'agent déclare lui-même.
_Avoid_: résultat, statut déclaré

**Discipline « implement-verified »**:
La méthode imposée au worker : scout → `/tdd` → gate objectif (typecheck/lint/test) → revue
adversariale → `/review` → `/simplify` → commit. « Terminé » = mesuré et jugé par autre
chose que celui qui a écrit le code.
_Avoid_: workflow, process

**Stack-agnostique**:
hachibi auto-détecte le gestionnaire de paquets, les commandes typecheck/lint/test et le
fichier de règles du **projet cible** — il ne présuppose aucun framework. À distinguer du
**runtime** qu'il présuppose, lui, fixe : le CLI `claude` + les skills `/tdd`, `/review`,
`/simplify` (cf. ADR 0002).
_Avoid_: générique (trop vague — préciser stack-agnostique vs runtime-spécifique)

**Scaffold** (`hachibi init`):
L'action de déposer le dossier `.hachibi/` dans le projet cible (depuis le `template/` du
package). C'est le seul rôle du **bin**.
_Avoid_: génération, install (l'install, c'est `npm i -D hachibi` ; le scaffold, c'est `init`)

**`.hachibi/`**:
Le dossier déposé dans le projet par `init` : `main.ts` (wrapper), `prompts/`, `config.json`
— **éditables et versionnés**. Le sous-dossier `worktrees/` (artefacts d'exécution) est, lui,
gitignoré.
_Avoid_: dossier de config, .config

**Wrapper** (`.hachibi/main.ts`):
Le point d'entrée fin, propre au projet, lancé par `tsx`. Il importe le **moteur** depuis le
package et le démarre. Éditable par l'utilisateur.
_Avoid_: main, entrypoint (en anglais), script

**Moteur** (engine):
La logique d'orchestration, livrée par le package en TypeScript (`src/orchestrate.ts`,
exporte `run()`), transpilée par tsx. À distinguer du **bin** (JS, scaffolding seul).
_Avoid_: core, lib, orchestrateur (réserver « orchestrateur » au produit entier)
