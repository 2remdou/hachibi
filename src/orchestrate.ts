/**
 * hachibi — moteur de build parallèle d'issues (worktrees isolés + claude headless).
 *
 * Ce module exporte `run()` ; il NE s'exécute pas tout seul à l'import. Il est consommé
 * par le wrapper `.hachibi/main.ts` (scaffoldé par `hachibi init`) lancé via tsx :
 *
 *   npx tsx .hachibi/main.ts <issuesDir> [options]
 *
 * Le wrapper fournit `promptsDir` (= .hachibi/prompts, éditable) et `configPath`
 * (= .hachibi/config.json). Livré en TypeScript pur, sans build : tsx le transpile, y
 * compris depuis node_modules (cf. docs/adr/0003).
 *
 * Présuppose un runtime Claude Code (CLI `claude` + skills /tdd, /review, /simplify) :
 * cf. docs/adr/0002.
 */

import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------
export type RunOptions = {
  /** Dossier des prompts (défaut : <repo>/.hachibi/prompts). */
  promptsDir?: string;
  /** Chemin du fichier de config par défaut (défaut : <repo>/.hachibi/config.json ; surchargé par --config). */
  configPath?: string;
  /** Arguments CLI (défaut : process.argv.slice(2)). */
  argv?: string[];
};

// ---------------------------------------------------------------------------
// Types internes
// ---------------------------------------------------------------------------
type Issue = {
  id: string; // tel quel depuis le nom de fichier, ex "01"
  num: number; // 1
  slug: string; // "01-organisations-liste-detail"
  file: string; // chemin absolu
  title: string;
  blockedBy: number[]; // numéros des bloqueurs
};

type Config = {
  issuesDir: string;
  packageManager: string; // "pnpm" | "npm" | "yarn"
  installCmd: string;
  typecheckCmd: string;
  lintCmd: string;
  testCmd: string;
  rulesFile: string; // chemin relatif au repo, "" si aucun
  // Modèles : `model` est le défaut global ; chaque knob ("" = hérite de `model`) cible
  // un processus distinct que hachibi lance lui-même.
  model: string; // défaut global (claude-sonnet-4-6)
  plannerModel: string; // planificateur (lecture seule)
  workerModel: string; // session worker (/tdd, /review, /simplify y tournent)
  adversarialReviewModel: string; // sous-agent frais de la revue adversariale (étape 4)
  maxParallel: number;
  maxAttempts: number;
  coAuthor: string;
  tddCmd: string;
  reviewCmd: string;
  simplifyCmd: string;
  workerTimeoutMs: number;
};

type WorkerResult = {
  issue: Issue;
  branch: string;
  worktree: string;
  ok: boolean; // un commit a été produit ET le worker s'est terminé proprement
  verdict: string; // PASS / FAIL / ? (auto-déclaré par le worker)
  reason: string;
  commits: number;
  logFile: string;
};

// `specific` s'il est non vide, sinon le défaut global.
function pickModel(specific: string, fallback: string): string {
  return specific || fallback;
}

// ---------------------------------------------------------------------------
// Petits utilitaires shell
// ---------------------------------------------------------------------------
function sh(cmd: string, cwd?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function git(args: string, cwd: string) {
  return sh(`git ${args}`, cwd);
}

function repoRoot(): string {
  const r = sh('git rev-parse --show-toplevel');
  if (!r.ok) throw new Error('Pas dans un dépôt git.');
  return r.out;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function sanitizeBranchPart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._/-]/g, '-').replace(/-+/g, '-');
}

// ---------------------------------------------------------------------------
// 1. Parsing des issues
// ---------------------------------------------------------------------------
function parseIssues(dir: string): Issue[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d+.*\.md$/.test(f) && f.toLowerCase() !== 'readme.md')
    .sort();
  const withRaw = files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf8');
    const slug = f.replace(/\.md$/, '');
    const id = (slug.match(/^(\d+)/) || ['', slug])[1];
    const num = parseInt(id, 10);
    const titleLine = (raw.match(/^#\s+(.+)$/m) || ['', slug])[1].trim();
    return { id, num, slug, file: join(dir, f), title: titleLine, blockedBy: [] as number[], raw };
  });

  const allNums = new Set(withRaw.map((i) => i.num));
  return withRaw.map(({ raw, ...issue }) => ({
    ...issue,
    blockedBy: parseBlockedBy(raw, issue.num, allNums),
  }));
}

function parseBlockedBy(raw: string, selfNum: number, allNums: Set<number>): number[] {
  const m = raw.match(/##\s*Blocked by\s*([\s\S]*?)(?:\n##\s|\n#\s|$)/i);
  if (!m) return [];
  const section = m[1];
  if (/none|aucun|immediat|can start/i.test(section)) return [];
  const nums = new Set<number>();
  for (const tok of section.match(/\d+/g) || []) {
    const n = parseInt(tok, 10);
    if (n !== selfNum && allNums.has(n)) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 2a. Vagues déterministes (tri topologique en couches — repli)
// ---------------------------------------------------------------------------
function topoWaves(issues: Issue[]): string[][] {
  const byNum = new Map(issues.map((i) => [i.num, i]));
  const done = new Set<number>();
  const waves: string[][] = [];
  let remaining = issues.slice();
  while (remaining.length) {
    const layer = remaining.filter((i) => i.blockedBy.every((b) => done.has(b) || !byNum.has(b)));
    if (!layer.length) {
      // cycle ou dépendance impossible : on dégrade en séquentiel sur le reste
      waves.push(remaining.map((i) => i.id));
      break;
    }
    waves.push(layer.map((i) => i.id));
    layer.forEach((i) => done.add(i.num));
    remaining = remaining.filter((i) => !done.has(i.num));
  }
  return waves;
}

// ---------------------------------------------------------------------------
// 2b. Planificateur LLM
// ---------------------------------------------------------------------------
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

function runPlanner(issues: Issue[], cfg: Config, root: string, promptsDir: string): string[][] | null {
  const tpl = readFileSync(join(promptsDir, 'planner-prompt.md'), 'utf8');
  const table = issues
    .map((i) => `- ${i.id} | ${i.slug} | ${i.title} | blockedBy: [${i.blockedBy.join(', ') || '—'}]`)
    .join('\n');
  const files = issues.map((i) => `- ${i.id}: ${i.file.replace(root + '/', '')}`).join('\n');
  const prompt = fill(tpl, { issuesDir: cfg.issuesDir, issuesTable: table, issuesFiles: files });

  console.log('\n⏳ Planificateur (claude -p, lecture seule)…');
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--allowedTools', 'Read', 'Grep', 'Glob',
    '--dangerously-skip-permissions',
  ];
  const model = pickModel(cfg.plannerModel, cfg.model);
  if (model) args.push('--model', model);
  const r = spawnSync('claude', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let text = r.stdout || '';
  let isError = r.status !== 0;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.result === 'string') text = obj.result;
    if (obj && obj.is_error) isError = true;
  } catch {
    /* stdout déjà du texte brut */
  }
  if (isError) {
    console.warn(`⚠️  Planificateur en échec (${(text || r.stderr || '').slice(0, 200)}) → repli déterministe.`);
    return null;
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('⚠️  Réponse planificateur non parsable, repli déterministe.');
    return null;
  }
  try {
    const plan = JSON.parse(jsonMatch[0]);
    if (Array.isArray(plan.waves) && plan.waves.every((w: unknown) => Array.isArray(w))) {
      if (plan.rationale) console.log('   rationale:', plan.rationale);
      return plan.waves as string[][];
    }
  } catch {
    /* tombe dans le repli */
  }
  console.warn('⚠️  Plan invalide, repli déterministe.');
  return null;
}

// ---------------------------------------------------------------------------
// Validation du plan (deps respectées + couverture exacte)
// ---------------------------------------------------------------------------
function validateWaves(waves: string[][], issues: Issue[]): { ok: boolean; reason: string } {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const numToWave = new Map<number, number>();
  for (let w = 0; w < waves.length; w++) {
    for (const id of waves[w]) {
      const issue = byId.get(id);
      if (!issue) return { ok: false, reason: `id inconnu dans le plan : ${id}` };
      if (seen.has(id)) return { ok: false, reason: `id en double : ${id}` };
      seen.add(id);
      numToWave.set(issue.num, w);
    }
  }
  if (seen.size !== issues.length) return { ok: false, reason: `couverture incomplète (${seen.size}/${issues.length})` };
  for (const it of issues) {
    const w = numToWave.get(it.num)!;
    for (const b of it.blockedBy) {
      const bw = numToWave.get(b);
      if (bw !== undefined && bw >= w) return { ok: false, reason: `${it.id} avant/au même niveau que son bloqueur ${b}` };
    }
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// 3. Worker (worktree isolé + claude -p)
// ---------------------------------------------------------------------------
function createWorktree(root: string, branch: string, baseRef: string, wtDir: string, cfg: Config): { ok: boolean; err: string } {
  const add = git(`worktree add -b ${branch} "${wtDir}" ${baseRef}`, root);
  if (!add.ok) return { ok: false, err: `worktree add: ${add.err}` };
  if (cfg.installCmd) {
    console.log(`   📦 ${basename(wtDir)} : ${cfg.installCmd}…`);
    const inst = sh(cfg.installCmd, wtDir);
    if (!inst.ok) return { ok: false, err: `install: ${inst.err.slice(-500)}` };
  }
  return { ok: true, err: '' };
}

function buildWorkerPrompt(issue: Issue, branch: string, cfg: Config, root: string, promptsDir: string): string {
  const tpl = readFileSync(join(promptsDir, 'worker-prompt.md'), 'utf8');
  const testCmd = cfg.testCmd || `${cfg.packageManager} test (cible UNIQUEMENT les fichiers touchés)`;
  return fill(tpl, {
    branch,
    label: issue.slug,
    specPath: issue.file.replace(root + '/', ''),
    rulesFile: cfg.rulesFile || '(aucun fichier de règles dédié)',
    tddCmd: cfg.tddCmd,
    reviewCmd: cfg.reviewCmd,
    simplifyCmd: cfg.simplifyCmd,
    typecheckCmd: cfg.typecheckCmd,
    lintCmd: cfg.lintCmd,
    testCmd: testCmd,
    maxAttempts: String(cfg.maxAttempts),
    adversarialReviewModel: pickModel(cfg.adversarialReviewModel, cfg.model),
    commitMsg: `wip(${issue.slug}): implémentation vérifiée`,
    coAuthor: cfg.coAuthor,
  });
}

function runWorker(issue: Issue, baseRef: string, cfg: Config, root: string, runDir: string, promptsDir: string): Promise<WorkerResult> {
  const branch = `${sanitizeBranchPart(basename(runDir))}/${sanitizeBranchPart(issue.slug)}`;
  const wtDir = join(runDir, sanitizeBranchPart(issue.slug));
  const logFile = join(runDir, `${issue.id}.log`);
  const base: WorkerResult = { issue, branch, worktree: wtDir, ok: false, verdict: '?', reason: '', commits: 0, logFile };

  return new Promise<WorkerResult>((res) => {
    const created = createWorktree(root, branch, baseRef, wtDir, cfg);
    if (!created.ok) {
      res({ ...base, reason: created.err });
      return;
    }
    const prompt = buildWorkerPrompt(issue, branch, cfg, root, promptsDir);
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    const model = pickModel(cfg.workerModel, cfg.model);
    if (model) args.push('--model', model);

    console.log(`   🤖 worker démarré : ${issue.slug}`);
    const child = spawn('claude', args, { cwd: wtDir });
    const logFd: string[] = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, cfg.workerTimeoutMs);

    child.stdout.on('data', (d) => logFd.push(d.toString()));
    child.stderr.on('data', (d) => logFd.push(d.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      const raw = logFd.join('');
      try {
        writeFileSync(logFile, raw);
      } catch { /* noop */ }

      let text = raw;
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.result === 'string') text = obj.result;
      } catch { /* stream/texte */ }

      const verdictMatch = text.match(/ORCHESTRATE_DONE\s+(PASS|FAIL)\s*(.*)/);
      const verdict = verdictMatch ? verdictMatch[1] : '?';
      const declaredReason = verdictMatch ? verdictMatch[2].trim() : (killed ? 'timeout worker' : 'pas de verdict émis');

      // Vérité terrain : un commit a-t-il été produit sur la branche ?
      const count = git(`rev-list --count ${baseRef}..HEAD`, wtDir);
      const commits = count.ok ? parseInt(count.out || '0', 10) : 0;
      const ok = commits > 0 && verdict !== 'FAIL' && !killed;

      res({ ...base, ok, verdict, reason: declaredReason, commits });
    });
  });
}

// Pool d'exécution borné
async function runPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function detectConfig(root: string, issuesDir: string, overrides: Partial<Config>): Config {
  let pkg: { scripts?: Record<string, string>; packageManager?: string } = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch { /* pas de package.json */ }
  const scripts = pkg.scripts || {};
  const hasPkg = existsSync(join(root, 'package.json'));
  const pm = (pkg.packageManager || '').split('@')[0] || (existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn' : 'npm');
  const run = (name: string) => `${pm} ${pm === 'npm' ? 'run ' : ''}${name}`;
  const rules = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'].find((f) => existsSync(join(root, f))) || '';
  // Pas de package.json => projet non-Node : pas d'install ni de commandes JS par défaut.
  const installCmd = !hasPkg
    ? ''
    : pm === 'pnpm' ? 'pnpm install --prefer-offline' : pm === 'yarn' ? 'yarn install' : 'npm install';

  const base: Config = {
    issuesDir,
    packageManager: pm,
    installCmd,
    typecheckCmd: scripts.typecheck ? run('typecheck') : `${pm === 'npm' ? 'npx' : pm === 'pnpm' ? 'pnpm exec' : 'yarn'} tsc --noEmit`,
    lintCmd: scripts.lint ? run('lint') : `${pm === 'npm' ? 'npx' : pm === 'pnpm' ? 'pnpm exec' : 'yarn'} eslint .`,
    testCmd: scripts.test ? run('test') : '',
    rulesFile: rules,
    // Défaut sonnet : bien moins cher pour N workers parallèles, largement accessible,
    // suffisant pour du code guidé par specs+TDD. Surchargeable via --model/config.
    model: 'claude-sonnet-4-6',
    plannerModel: '',
    workerModel: '',
    adversarialReviewModel: '',
    maxParallel: 3,
    maxAttempts: 3,
    coAuthor: 'Co-Authored-By: Claude <noreply@anthropic.com>',
    tddCmd: '/tdd',
    reviewCmd: '/review',
    simplifyCmd: '/simplify',
    workerTimeoutMs: 30 * 60 * 1000,
  };
  return { ...base, ...overrides };
}

function loadConfigFile(path: string): Partial<Config> {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Point d'entrée moteur — appelé par .hachibi/main.ts
// ---------------------------------------------------------------------------
export async function run(opts: RunOptions = {}): Promise<void> {
  const { values, positionals } = parseArgs({
    args: opts.argv ?? process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      'max-parallel': { type: 'string' },
      model: { type: 'string' },
      base: { type: 'string' },
      integration: { type: 'string' },
      'plan-only': { type: 'boolean' },
      'no-planner': { type: 'boolean' },
      'no-merge': { type: 'boolean' },
      'keep-worktrees': { type: 'boolean' },
      yes: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help || !positionals[0]) {
    console.log(`hachibi — build parallèle d'issues (worktrees isolés + claude headless)

Usage : npx tsx .hachibi/main.ts <issuesDir> [options]

  <issuesDir>            Dossier des issues Markdown (ex: docs/issues/ma-feature)

Options :
  --yes                  Lance réellement les workers (sinon : plan uniquement, sûr)
  --plan-only            Affiche le plan de vagues puis quitte
  --no-planner           Saute le planificateur LLM, utilise le tri topologique
  --max-parallel <n>     Workers simultanés par vague (défaut 3)
  --model <id>           Modèle par défaut (planner + workers, défaut claude-sonnet-4-6).
                         Réglage fin par étape (plannerModel/workerModel/
                         adversarialReviewModel) via .hachibi/config.json.
  --base <ref>           Ref de base de la branche d'intégration (défaut HEAD)
  --integration <name>   Nom de la branche d'intégration (défaut auto)
  --no-merge             Ne fusionne pas automatiquement (laisse branches + worktrees)
  --keep-worktrees       Conserve les worktrees même en cas de succès
  --config <path>        Fichier de config JSON (défaut: .hachibi/config.json)
`);
    if (!values.help) process.exitCode = 1;
    return;
  }

  const root = repoRoot();
  const issuesDir = resolve(positionals[0]);
  if (!existsSync(issuesDir)) {
    console.error(`Dossier introuvable : ${issuesDir}`);
    process.exitCode = 1;
    return;
  }

  // Prompts + config : par défaut dans <repo>/.hachibi/ (scaffoldé par `hachibi init`),
  // surchargeables via les options du wrapper.
  const hachibiDir = join(root, '.hachibi');
  const promptsDir = opts.promptsDir ?? join(hachibiDir, 'prompts');

  // Config : --config <path>, sinon le configPath par défaut (.hachibi/config.json).
  const cfgPath = values.config ? resolve(values.config) : (opts.configPath ?? join(hachibiDir, 'config.json'));
  const fileCfg = cfgPath && existsSync(cfgPath) ? loadConfigFile(cfgPath) : {};
  const overrides: Partial<Config> = { ...fileCfg };
  if (values['max-parallel']) overrides.maxParallel = parseInt(values['max-parallel'], 10);
  if (values.model) overrides.model = values.model;
  const cfg = detectConfig(root, issuesDir.replace(root + '/', ''), overrides);

  const issues = parseIssues(issuesDir);
  if (!issues.length) {
    console.error('Aucune issue trouvée (fichiers NN-*.md attendus).');
    process.exitCode = 1;
    return;
  }

  console.log(`\n📋 ${issues.length} issues dans ${cfg.issuesDir}`);
  console.log(`   pm=${cfg.packageManager} · typecheck="${cfg.typecheckCmd}" · lint="${cfg.lintCmd}" · règles=${cfg.rulesFile || '—'}`);

  // Plan
  let waves: string[][] | null = null;
  if (!values['no-planner']) waves = runPlanner(issues, cfg, root, promptsDir);
  if (waves) {
    const v = validateWaves(waves, issues);
    if (!v.ok) {
      console.warn(`⚠️  Plan LLM rejeté (${v.reason}) → repli déterministe.`);
      waves = null;
    }
  }
  if (!waves) waves = topoWaves(issues);

  const byId = new Map(issues.map((i) => [i.id, i]));
  console.log('\n🌊 Plan de vagues :');
  waves.forEach((w, i) => {
    console.log(`   Vague ${i + 1} (${w.length} en parallèle) :`);
    w.forEach((id) => console.log(`     - ${id} ${byId.get(id)?.title ?? ''}`));
  });

  if (values['plan-only'] || !values.yes) {
    console.log('\nℹ️  Mode plan uniquement. Relance avec --yes pour lancer les workers.');
    return;
  }

  // Branche + worktree d'intégration (l'arbre principal n'est jamais touché)
  const startRef = values.base || 'HEAD';
  const intBranch = values.integration || `orchestrate/${sanitizeBranchPart(basename(issuesDir))}-${nowStamp()}`;
  const runDir = join(root, '.hachibi', 'worktrees', `orch-${nowStamp()}`);
  mkdirSync(runDir, { recursive: true });
  const intWt = join(runDir, '_integration');

  console.log(`\n🔧 Branche d'intégration : ${intBranch} (base ${startRef})`);
  const mk = git(`worktree add -b ${intBranch} "${intWt}" ${startRef}`, root);
  if (!mk.ok) {
    console.error(`Échec création worktree d'intégration : ${mk.err}`);
    process.exitCode = 1;
    return;
  }

  const allResults: WorkerResult[] = [];
  for (let w = 0; w < waves.length; w++) {
    const waveIds = waves[w];
    const waveIssues = waveIds.map((id) => byId.get(id)!).filter(Boolean);
    const baseTip = git('rev-parse HEAD', intWt).out;
    console.log(`\n=== 🌊 Vague ${w + 1}/${waves.length} : ${waveIds.join(', ')} (base ${baseTip.slice(0, 8)}) ===`);

    const results = await runPool(waveIssues, cfg.maxParallel, (it) => runWorker(it, baseTip, cfg, root, runDir, promptsDir));
    allResults.push(...results);

    // Merge auto dans l'ordre des issues de la vague
    if (!values['no-merge']) {
      for (const r of results) {
        if (!r.ok) {
          console.log(`   ⏭️  ${r.issue.slug} : pas de merge (worker ${r.verdict} — ${r.reason})`);
          continue;
        }
        const m = git(`merge --no-ff --no-edit ${r.branch}`, intWt);
        if (m.ok) {
          console.log(`   ✅ merge ${r.issue.slug} → ${intBranch}`);
          if (!values['keep-worktrees']) git(`worktree remove --force "${r.worktree}"`, root);
        } else {
          git('merge --abort', intWt);
          console.log(`   ⚠️  CONFLIT en mergeant ${r.issue.slug} — branche ${r.branch} + worktree conservés pour résolution manuelle.`);
          r.reason = 'merge conflict';
          r.ok = false;
        }
      }
    }
  }

  // Rapport
  console.log('\n================ RAPPORT ================');
  for (const r of allResults) {
    const tag = r.ok ? '✅ PASS' : r.verdict === '?' ? '❓ INDÉT.' : '❌ ' + r.verdict;
    console.log(`${tag}  ${r.issue.slug}  (${r.commits} commit(s))  ${r.reason ? '— ' + r.reason : ''}`);
    if (!r.ok) console.log(`        log: ${r.logFile.replace(root + '/', '')}  ·  branche: ${r.branch}`);
  }
  const okCount = allResults.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${allResults.length} issues intégrées dans ${intBranch}.`);
  console.log(`Worktree d'intégration : ${intWt.replace(root + '/', '')}`);
  console.log('\n⚠️  RAPPEL : ces PASS sont auto-déclarés par des agents. Revérifie toi-même');
  console.log('   (typecheck/lint/tests rejoués + baseline avant/après) avant de fusionner');
  console.log(`   ${intBranch} dans ta branche de travail.`);
}
