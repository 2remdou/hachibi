# 0002 — hachibi présuppose un runtime Claude Code (CLI + skills), sans dégradation

hachibi est publié sur npm public mais **présuppose**, sans dégrader, un environnement
Claude Code complet : le CLI `claude` authentifié sur le `PATH`, et les skills `/tdd`,
`/review`, `/simplify` disponibles. Le `worker-prompt.md` les invoque en dur. Si elles
manquent, le worker échoue — il n'y a pas de repli « instructions inline ».

**Pourquoi** : ces skills encapsulent une discipline (red-green-refactor, revue de
correctness, simplification) qu'on ne veut pas ré-inliner et maintenir en double dans les
prompts. hachibi est assumé comme un outil pour **utilisateurs Claude Code avancés**, pas
comme un orchestrateur agent-agnostique grand public. C'est la frontière de scope : hachibi
est **stack-agnostique** (auto-détecte pm/typecheck/lint/règles du projet) mais
**runtime-spécifique** (Claude Code).

**Conséquence** : le README doit annoncer ces prérequis fort et en premier. Rendre les
étapes configurables (vider `tddCmd`/`reviewCmd`/`simplifyCmd`) reste possible côté config,
mais ce n'est pas un mode supporté de premier ordre.
