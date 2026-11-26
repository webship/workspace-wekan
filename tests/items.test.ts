/**
 * The AI items this plugin carries (ai/ in the package, the manifest's `ai` block): three agents, a skill,
 * a command and two prompts, each placed by the installer in the workspace folder of its kind.
 *
 * What is checked here is what a person relies on once they are installed: each item has the shape its
 * folder lists and Claude Code loads, and names nothing that does not exist — every flag of a cmd-*.sh is one
 * the command takes, every settings key is in its settings template, and every step phrase of the skill and its
 * features is one the step pack defines (its own check runs them).
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const P: string = manifest.name;

// The kinds the workspace knows, and the folder each one lands in (core/workspace-app/plugin-install.js).
const KINDS: Record<string, string> = { agents: 'ai-agents', skills: 'ai-skills', commands: 'ai-commands', prompts: 'ai-prompts' };

/** Every file of the package under a path: the file itself, or all the files of a folder (a skill is a folder). */
function filesUnder(rel: string): string[] {
  const abs = path.join(PKG, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((e) => filesUnder(`${rel}/${e}`));
}
const ITEM_FILES: string[] = Object.keys(KINDS).flatMap((kind) => (manifest.ai[kind] || []).flatMap(filesUnder));
const MAIN_FILES: string[] = [...manifest.ai.agents, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.ai.skills.map((s: string) => `${s}/SKILL.md`)];
const frontmatter = (src: string) => (src.startsWith('---\n') ? src.split('\n---\n')[0] : '');
const bodyOf = (src: string) => (src.startsWith('---\n') ? src.split('\n---\n').slice(1).join('\n---\n') : src);
// The plugins the manifest needs: a list alone, or the `plugins` of the object that also carries the commands.
const neededPlugins: unknown[] = Array.isArray(manifest.needs) ? manifest.needs : (manifest.needs.plugins || []);

test('the manifest carries one list per kind, each item under ai/<kind>/, and needs the folder each kind lands in', () => {
  assert.deepStrictEqual(Object.keys(manifest.ai).sort(), Object.keys(KINDS).sort(), 'agents, skills, commands, prompts');
  for (const [kind, folder] of Object.entries(KINDS)) {
    const list: string[] = manifest.ai[kind];
    assert.ok(list.length > 0, `the plugin ships at least one of ${kind}`);
    for (const f of list) {
      assert.strictEqual(path.dirname(f), `ai/${kind}`, `${f} is in ai/${kind}/`);
      assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
      assert.match(path.basename(f), new RegExp(`^${P}-[a-z0-9-]+(\\.md)?$`), `${f} carries the plugin's name, so it never takes the name of another plugin's item`);
    }
    assert.ok(neededPlugins.includes(folder), `it ships ${kind}, so it needs ${folder}`);
  }
  assert.ok(pkg.files.includes('ai'), 'ai/ is published with the package');
  const names = (kind: string, ext = '.md') => manifest.ai[kind].map((f: string) => path.basename(f, ext));
  assert.deepStrictEqual(names('agents'), AGENTS);
  assert.deepStrictEqual(names('skills', ''), SKILLS);
  assert.deepStrictEqual(names('commands'), AI_COMMANDS);
  assert.deepStrictEqual(names('prompts'), PROMPTS);
  // Commands and prompts share one destination in Claude Code (~/.claude/commands): a name used by both is lost.
  assert.strictEqual(new Set([...AI_COMMANDS, ...PROMPTS]).size, AI_COMMANDS.length + PROMPTS.length, 'no command and prompt share a name');
});

test('an agent is named after its file, says when to use it, and names its model and tools', () => {
  for (const f of manifest.ai.agents) {
    const head = frontmatter(read(f));
    assert.match(head, new RegExp(`^name: ${path.basename(f, '.md')}$`, 'm'));
    assert.match(head, /^description: Use this agent .{80,}$/m, `${f} says what it does and when to use it`);
    assert.match(head, /^model: fable$/m);
    assert.match(head, /^tools:\n( {2}- \S+\n?)+/m, `${f} lists its tools`);
  }
});

test('a skill is a folder with a SKILL.md named after it, and says when to use it', () => {
  for (const f of manifest.ai.skills) {
    assert.ok(fs.statSync(path.join(PKG, f)).isDirectory(), `${f} is a folder`);
    const head = frontmatter(read(`${f}/SKILL.md`));
    assert.match(head, new RegExp(`^name: ${path.basename(f)}$`, 'm'));
    assert.match(head, /^description: .{80,}$/m, `${f} says what it does and when to use it`);
    assert.match(head, /Use when/, `${f} names the requests it answers to`);
  }
});

test('a command is a slash command: a description, an argument hint, and $ARGUMENTS where what was typed goes', () => {
  for (const f of manifest.ai.commands) {
    const src = read(f);
    const head = frontmatter(src);
    assert.match(head, /^description: .{40,}$/m, `${f} is described in the command list`);
    assert.match(head, /^argument-hint: .+$/m, `${f} says what to type after it`);
    assert.doesNotMatch(head, /^name:/m, `${f} is named by its file`);
    assert.ok(src.includes('$ARGUMENTS'), `${f} reads what was typed after the command`);
  }
});

// The book's folder is a path, not an assistant: webship/webship-js-ai-agent, webship/webship-js-skills and
// webship/ai-agents install the book in <root>/.claude/automated-functional-testing-recipes/ for every AI CLI (Codex,
// Gemini and Copilot too). An item may give that folder; nothing else of one assistant.
const BOOK_FOLDER = /(?:~\/)?\.claude\/automated-functional-testing-recipes\//g;

test('the body of every item is plain Markdown: it names no tool or feature of one AI command-line assistant', () => {
  for (const f of ITEM_FILES.filter((x) => x.endsWith('.md'))) {
    // What is left once the default launch line of a prompt is taken out: the words an assistant is asked to follow.
    const body = bodyOf(read(f)).replace(/^\s*claude --permission-mode bypassPermissions """\s*$/m, '').replace(BOOK_FOLDER, '');
    for (const m of body.matchAll(/\b(Bash|Read|Write|Edit|Grep|Glob|Task|Agent|Skill|TodoWrite|WebFetch) tool\b|\bsubagents?\b|bypassPermissions|\bClaude\b|\bclaude -p\b|\.claude\/|\bMCP\b|mcp__/g)) {
      assert.fail(`${f}: "${m[0]}" belongs to one AI assistant; the body is for any of them`);
    }
  }
});

test('Claude Code stays the default shape: a prompt says its text works in another assistant, a command says its arguments in words', () => {
  for (const f of manifest.ai.prompts) {
    assert.match(read(f), /^\s*claude --permission-mode bypassPermissions """\s*$/m, `${f} keeps the default launch command`);
    assert.match(read(f), /^The text between the triple quotes is plain: it can be given to another AI command-line assistant as it is\.$/m, `${f} says its text is not tied to one assistant`);
  }
  for (const f of manifest.ai.commands) {
    assert.ok(read(f).includes('$ARGUMENTS'), `${f} reads what was typed after the command`);
    assert.match(bodyOf(read(f)), /The (first word|argument) is /, `${f} says in words what the arguments are, for an assistant that does not fill $ARGUMENTS in`);
  }
});

// Other AI command-line assistants read the frontmatter with a strict YAML parser: a value such a parser
// cannot read is lost there (the item arrives with an empty description). The default assistant is lenient,
// so the items are held to the strict reading here.

test('the frontmatter of every item is YAML a strict parser reads', () => {
  const ai = JSON.parse(read('package.json')).workspacePlugin.ai || {};
  const files: string[] = [...(ai.agents || []), ...(ai.commands || []), ...(ai.skills || []).map((s: string) => `${s}/SKILL.md`)];
  let seen = 0;
  for (const f of files) {
    const head = frontmatter(read(f));
    assert.ok(head, `${f} has frontmatter`);
    for (const line of head.split('\n').slice(1)) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/);
      if (!m) {
        assert.match(line, /^ +(- )?\S/, `${f}: "${line}" is neither a key nor a part of the key above it`);
        continue;
      }
      const value = (m[2] || '').trim();
      seen += 1;
      if (value === '') continue; // a list follows
      if (value.startsWith("'")) { assert.match(value, /^'(?:[^']|'')*'$/, `${f}: the value of ${m[1]} is not a closed single-quoted value`); continue; }
      if (value.startsWith('"')) { assert.doesNotThrow(() => JSON.parse(value), `${f}: the value of ${m[1]} is not a closed double-quoted value`); continue; }
      if (/^\[.*\]$/.test(value)) continue; // a list on one line
      assert.doesNotMatch(value, /: |:$| #/, `${f}: the value of ${m[1]} holds ": " or " #". A strict YAML parser stops there, and the assistant that uses one gets no ${m[1]}: reword it, or quote the value`);
      assert.doesNotMatch(value, /^(?:[[\]{}>|*&!%@\`#,]|[-?:] )/, `${f}: the value of ${m[1]} starts with a sign YAML keeps for itself: quote the value`);
    }
  }
  assert.ok(seen > 0, 'the items carry frontmatter');
});

// When the work touches automated functional testing, the items send the reader to the book Automated Functional
// Testing Recipes first: every agent and skill carries the same section "The book", the tester and the scenarios
// skill of a platform also name the chapters to start with, and a command or a prompt that runs the suite points to it.
const BOOK_WHERE = [
  '.claude/automated-functional-testing-recipes/',
  '~/.claude/automated-functional-testing-recipes/',
  'https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes',
];

test('the items point to the book Automated Functional Testing Recipes, and say where to find it, in order', () => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const inOrder = (f: string, text: string) => {
    let at = -1;
    for (const where of BOOK_WHERE) {
      const next = text.indexOf(where, at + 1);
      assert.ok(next > at, `${f} gives ${where}, after the place before it`);
      at = next;
    }
  };
  const platform = (manifest.ai.skills || []).some((s: string) => path.basename(s) === `${manifest.name}-scenarios`);
  const sections = new Set<string>();
  const chapters = new Set<string>();
  for (const f of [...(manifest.ai.agents || []), ...(manifest.ai.skills || []).map((s: string) => `${s}/SKILL.md`)]) {
    const src = read(f);
    const start = src.indexOf('\n## The book\n');
    assert.ok(start > 0, `${f} has the section "The book"`);
    const rest = src.slice(start + 1);
    const end = rest.indexOf('\n## ', 1);
    const [base, startWith] = (end < 0 ? rest : rest.slice(0, end)).split('\n- **For ');
    assert.ok(flat(base).includes('read the book *Automated Functional Testing Recipes* first.'), `${f} says to read the book first`);
    inOrder(f, base);
    assert.ok(flat(base).includes('Its `README.md` first, then the chapter that matches the task'), `${f} says how to read it`);
    assert.ok(flat(base).includes('source of truth for step phrasing. When they differ from the book, follow them and say so.'), `${f} says what wins over the book`);
    sections.add(flat(base));
    const item = path.basename(f) === 'SKILL.md' ? path.basename(path.dirname(f)) : path.basename(f, '.md');
    if (platform && [`${manifest.name}-tester`, `${manifest.name}-scenarios`].includes(item)) {
      const named = (startWith || '').match(/`ch\d{2}-[a-z0-9-]+\.md`/g) || [];
      assert.ok(named.length >= 2 && named.length <= 4, `${f} names two to four chapters to start with`);
      chapters.add(named.join(' '));
    } else {
      assert.strictEqual(startWith, undefined, `${f}: only the tester and the scenarios skill of a platform name chapters`);
    }
  }
  assert.strictEqual(sections.size, 1, 'the section is the same in every agent and skill');
  assert.ok(chapters.size <= 1, 'the tester and the scenarios skill name the same chapters');
  for (const f of [...(manifest.ai.commands || []), ...(manifest.ai.prompts || [])]) {
    const src = read(f);
    if (!src.includes('cmd-tools-testing.sh')) continue;
    assert.ok(/the book \*?Automated Functional Testing Recipes/.test(flat(src)), `${f} runs the suite, so it points to the book`);
    inOrder(f, src);
  }
});

test('a prompt is a line that says what it is for, then the whole launch command the New screen form reads', () => {
  for (const f of manifest.ai.prompts) {
    const src = read(f);
    assert.doesNotMatch(src, /^---\n/, `${f} has no frontmatter: it is not installed as a command`);
    assert.match(src.split('\n')[0], /^[A-Z].{20,}\.$/, `${f} opens with one sentence`);
    const flags = src.match(/^\s*claude\s+([^\n]*?)\s*"""\s*$/m);
    const text = src.match(/claude[^\n]*"""\n([\s\S]*?)\n"""/);
    assert.ok(flags && flags[1].trim() === '--permission-mode bypassPermissions', `${f} carries the claude flags`);
    assert.ok(text && text[1].trim().length > 100, `${f} carries the prompt`);
    assert.match(text![1], /<[a-z|]+>/, `${f} has placeholders to fill in`);
    assert.match(text![1], /^# .*container-based \(DDEV by default\)/m, `${f} says where it runs`);
  }
});

// The workspace's commands an item shows, with the flags each takes: the plugin's own from its argparse files, the
// core's from what they take on 1.0.x (core/scripts/args).
const PLUGIN_FLAGS: Record<string, string> = {
  'cmd-wekan-project.sh': read('scripts/args/arg-wekan.sh'),
  'cmd-tools-wekan-cli.sh': read('scripts/args/arg-wekan-cli.sh'),
};
const CORE_FLAGS: Record<string, string[]> = {
  'cmd-tools-testing.sh': ['--run', '--configure', '--browser', '--path', '--headed', '--dry-run', '--retry', '--video', '--tags', '--profile', '--list-steps', '--add-steps', '--remove-steps', '--examples'],
  'cmd-tools-add-users.sh': [],
  'cmd-tools-cancel-users.sh': [],
  'cmd-tools-remove.sh': [],
};

test('every workspace command an item names exists, with the flags it is given', () => {
  let used = 0;
  for (const f of [...ITEM_FILES, 'README.md'].filter((x) => x.endsWith('.md'))) {
    for (const m of read(f).matchAll(/bash (cmd-[a-z0-9-]+\.sh)([^\n`]*)/g)) {
      const cmd = m[1];
      const flags = (m[2].match(/(?<![\w-])--[a-z][a-z-]*/g) || []);
      used += 1;
      if (PLUGIN_FLAGS[cmd] !== undefined) {
        for (const flag of flags) assert.ok(PLUGIN_FLAGS[cmd].includes(`'${flag}'`), `${f}: ${cmd} has no ${flag}`);
      } else if (CORE_FLAGS[cmd] !== undefined) {
        for (const flag of flags) assert.ok(CORE_FLAGS[cmd].includes(flag), `${f}: ${cmd} has no ${flag}`);
      } else {
        assert.fail(`${f}: ${cmd} is not a command of the workspace or of this plugin`);
      }
    }
  }
  assert.ok(used > 20, `the items show the commands (${used} checked)`);
});

test('every settings key an item names is in the settings template', () => {
  const keys = [...read(manifest.settingsTemplate).matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  for (const f of ITEM_FILES.filter((x) => x.endsWith('.md'))) {
    for (const m of read(f).matchAll(/`([a-z_]+): ?[a-z0-9]*`/g)) assert.ok(keys.includes(m[1]), `${f}: ${manifest.settingsFile} has no key ${m[1]}`);
  }
});

test('the items say container-based, name the plugin they come with, and carry no personal value', () => {
  for (const f of ITEM_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    for (const m of src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || []) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
    assert.doesNotMatch(src, /CHANGE_ME|[0-9a-f]{40}/, `${f} carries no key and no placeholder of one`);
  }
  for (const f of MAIN_FILES) {
    assert.match(read(f).replace(/\s+/g, ' '), /container-based (workspace )?\(DDEV by default\)|container-based, DDEV by default/, `${f} says what the workspace runs on`);
  }
  for (const f of [...manifest.ai.agents.filter((a: string) => /worker/.test(a)), ...manifest.ai.prompts]) {
    assert.match(read(f), /Reviewed by a human/, `${f} carries the Checkpoints rule`);
    assert.match(read(f), /[Nn]ever ticked/, `${f}: the two human-review boxes are never ticked by an agent`);
  }
  const readme = read('README.md');
  for (const name of [...AGENTS, ...SKILLS, ...AI_COMMANDS, ...PROMPTS]) assert.ok(readme.includes(name), `the README lists ${name}`);
});

test('no step phrase of the skill names the platform, and its features are whole', () => {
  const skill = read('ai/skills/wekan-scenarios/SKILL.md');
  const table = skill.slice(skill.indexOf('## Phrases by area'), skill.indexOf('## The sample content'));
  for (const m of table.matchAll(/`([^`]+)`/g)) assert.doesNotMatch(m[1], /wekan/i, `"${m[1]}" names the platform`);
  const dir = 'ai/skills/wekan-scenarios/examples';
  const features = fs.readdirSync(path.join(PKG, dir)).filter((f) => f.endsWith('.feature'));
  assert.ok(features.length >= 3, 'three whole features');
  for (const f of features) {
    const src = read(`${dir}/${f}`);
    assert.match(src, /^(@[a-z-]+\n)?Feature: /m, `${f} is a feature`);
    assert.doesNotMatch(src.replace(/^(Feature|  Scenario|  #).*$/gm, ''), /wekan/i, `${f}: no step names the platform`);
    assert.doesNotMatch(src, /dD\.123123ddd|password "[^"]+" with/, `${f} writes no password of an account`);
  }
});

test('no settings comment, label or item carries the words of another platform, or "a issue"', () => {
  for (const f of [manifest.settingsTemplate, manifest.labels, ...ITEM_FILES.filter((x) => x.endsWith('.md'))]) {
    const src = read(f);
    assert.doesNotMatch(src, /work package|\bcycles?\b|\bbuckets?\b|\bcolumns?\b|\bsubtasks?\b|read & write|\bshared with\b/i, `${f} speaks of Wekan's boards, lists, cards and labels`);
    assert.doesNotMatch(src, /\b(Guest|Commenter|Editors?|Reporter|Developer|viewers?)\b/i, `${f}: Wekan's board roles are administrator, normal, read-only, comment-only and the others of its own`);
    assert.doesNotMatch(src, /\ba issue|\ba task\b.*\ban task/i, `${f}: an issue, a task`);
    assert.doesNotMatch(src, /Gitea|Forgejo|Redmine|OpenProject|\bPlane\b|Leantime|Vikunja|Kanboard/, `${f} names another platform`);
  }
});
