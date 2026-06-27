# 0003 — Distribution par scaffold `.hachibi/` + exécution via tsx (pas de build)

hachibi s'installe en devDependency, puis `npx hachibi init` dépose un dossier **`.hachibi/`**
dans le projet (`main.ts` wrapper fin, `prompts/`, `config.json`), et l'orchestration se lance
par **`npx tsx .hachibi/main.ts <issuesDir>`**. Le wrapper importe le moteur du package
(`import { run } from 'hachibi'`). Remplace le modèle « bin compilé » de l'ADR 0001.

**Pourquoi** :

- **Éditabilité** — les prompts et la config vivent dans le projet (versionnés, modifiables),
  pas enfouis dans `node_modules`. C'était l'intérêt clé recherché.
- **Aucun build** — vérifié : `tsx` transpile le TypeScript **y compris depuis `node_modules`**
  (contrairement au type-stripping natif de Node, qui le refuse). Le package livre donc du
  `.ts` (`exports: "./src/orchestrate.ts"`) consommé tel quel par tsx ; `tsc --noEmit` ne sert
  qu'au type-check des contributeurs.

**Conséquences / contraintes** :

- Le **bin** `hachibi` (pour `init`) reste du **JavaScript** : il est lancé par `node` depuis
  `node_modules`, qui refuse le TS (cf. ADR 0001). Il fournit `init`, `update` (refresh non
  destructif via `.new`) et `run` — ce dernier lance le wrapper avec le `tsx` résolu depuis les
  dépendances de hachibi, de sorte que le projet consommateur **n'a pas besoin de `tsx`** (cas
  `npm link`/`file:`, où les deps du package lié ne sont pas hissées chez le consommateur).
- Le wrapper `.hachibi/main.ts` **n'utilise ni top-level `await` ni `import.meta`** : selon le
  `type` du `package.json` du projet, tsx peut le transpiler en CJS, où ces deux constructions
  échouent. Le moteur résout donc lui-même `<repo>/.hachibi/{prompts,config.json}` par défaut.
- `npm` **exclut les fichiers `.gitignore`** des packages : le `.hachibi/.gitignore` est écrit
  par `init` (et non copié depuis le template).

**Considéré et écarté** : wrapper « code complet vendoré » (autonome mais figé à l'init, pas de
maj via npm) — préféré le wrapper fin qui garde la logique dans le package, mise à jour par
`npm update`.
