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
