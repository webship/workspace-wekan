import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-wekan.sh');
const SITE = read('scripts/wekan-site.mjs');
/** The part of the site script that answers one verb: its function. */
const verb = (name: string) => {
  const start = SITE.indexOf(`\nasync function ${name}(`);
  assert.ok(start > 0, `the site script answers ${name}`);
  const next = SITE.indexOf('\nasync function ', start + 10);
  return SITE.slice(start, next > 0 ? next : SITE.length);
};
const fn = (name: string) => FUN.slice(FUN.indexOf(`function ${name}()`), FUN.indexOf('\n}\n', FUN.indexOf(`function ${name}()`)) + 2);

test('the manifest names the platform, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  assert.deepStrictEqual(manifest.typeActions, { wekan: ['sites', 'code'] }, 'the WEKAN menu on the rows of sites and code folders');
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.deepStrictEqual(names, ['docker-compose.wekan.yaml', 'wekan-site.mjs', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/wekan.feature']);
  assert.strictEqual(manifest.featuresSite, undefined, 'a site for the features needs a runtime CI has: Wekan is proven on DDEV only so far');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-tracker': '^1.0.2' });
  assert.ok(manifest.summary.length <= 110, 'the catalogue line shows at most 110 characters');
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/wekan\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-wekan-project.sh'), /^# workspace-name: Wekan \(kanban boards\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-wekan-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
});

test('every shell script parses, and so does the site script', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = spawnSync(process.execPath, ['--check', path.join(PKG, 'scripts/wekan-site.mjs')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('the site script works through Wekan\'s REST API from the web container, and each verb does what it says', () => {
  assert.match(SITE, /^const ROOT = process\.env\.WEKAN_INTERNAL_URL \|\| 'http:\/\/wekan:8080';$/m, 'Wekan, from inside the project');
  for (const name of ['install', 'accounts', 'content', 'tidy', 'list', 'token', 'counts']) verb(name);
  assert.match(SITE, /^const verbs = \{ install, accounts, content, tidy: \(p\) => tidy\(p, flag === 'list'\), list, token, counts \};$/m);
  assert.match(SITE, /Buffer\.from\(raw, 'base64'\)/, 'what it needs comes on its input');
  assert.doesNotMatch(SITE, /process\.argv\.slice\(2\)[^\n]*password/i, 'no password on the command line');
  const install = verb('install');
  assert.match(install, /rest\('POST', '\/users\/register', \{ username: user, email: mail, password \}\)/, 'the workspace account signs up first');
  assert.match(install, /me\.isAdmin !== true/, 'and must be Wekan\'s administrator: its first account');
  assert.match(install, /rest\('PUT', '\/api\/settings', \{ disableRegistration: true \}, adm\.token\)/, 'the sign-up is turned off');
  const accounts = verb('accounts');
  assert.match(accounts, /rest\('POST', '\/api\/users\/', \{ username: row\.login, email: row\.mail, password: row\.password \}, adm\.token\)/, 'the administrator makes an account');
  assert.match(accounts, /call\('setPassword', row\.password, id\)/, 'an account\'s password given back, by Wekan\'s own method');
  assert.match(accounts, /\{ action: 'disableLogin' \}/, 'a lock keeps an account from signing in');
  assert.match(accounts, /members\/\$\{id\}\/add`, \{ action: 'add', role \}/, 'a board role, set by the board\'s administrator');
  assert.match(accounts, /members\/\$\{id\}\/remove`, \{ action: 'remove' \}/, 'the stranger is taken off the board');
  assert.match(SITE, /^const ROLES = \{ owner: 'admin', member: 'normal', reader: 'readonly' \};$/m, 'the roles of the sample board; stranger has none');
  const content = verb('content');
  assert.match(content, /authorId: c\.by\.id/, 'each card made as its author');
  assert.match(content, /call\('scrum\.configure', b\.id, \{ enabled: true \}/, 'Scrum planning, by Wekan\'s own method');
  assert.match(content, /call\('scrum\.startSprint', b\.id, sprint\._id/, 'Sprint 1 started');
  assert.match(content, /call\('timeEntryAdd', one\.id, \{ date: today\(\), hours: 0\.5,/, 'half an hour of the member\'s time, as Wekan\'s own Log time keeps it');
  const token = verb('token');
  assert.match(token, /rest\('POST', `\/api\/createtoken\/\$\{id\}`, \{ reason: /, 'Wekan\'s own route, which records the administrator\'s token');
  assert.match(token, /console\.log\(`TOKEN \$\{d\.authToken\}`\)/);
  const tidy = verb('tidy');
  assert.match(SITE, /^const TEST = \/\^Webship test\\b\/;$/m);
  assert.match(tidy, /TEST\.test\(String\(c\.title \|\| ''\)\) && ours\.has\(String\(c\.userId\)\)/, 'only the default accounts\' "Webship test …" cards');
  assert.match(tidy, /if \(!onlyList\) await rest\('DELETE'/, 'with list, nothing is removed');
});

test('what the site script makes through Wekan\'s own methods is guarded: a part that fails is said, and the rest goes on', () => {
  // Every range of the script inside a part(…) call, found by its parentheses.
  const guarded: Array<[number, number]> = [];
  for (const m of SITE.matchAll(/\bpart\(/g)) {
    let depth = 0;
    let end = m.index as number;
    for (let i = (m.index as number) + 4; i < SITE.length; i += 1) {
      if (SITE[i] === '(') depth += 1;
      if (SITE[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    guarded.push([m.index as number, end]);
  }
  const calls = [...SITE.matchAll(/call\('(setOwnProfile|setPassword|scrum\.[A-Za-z]+|timeEntry[A-Za-z]*)'/g)];
  assert.ok(calls.length >= 9, `the methods Wekan's own screens call (${calls.length})`);
  for (const c of calls) {
    assert.ok(guarded.some(([a, b]) => (c.index as number) > a && (c.index as number) < b), `${c[1]} is called inside a part(…) that says what it could not make`);
  }
  assert.match(SITE, /console\.log\(`WARNING: \$\{what\} could not be made through Wekan's own methods/, 'a part that fails is said, on a line of its own');
  assert.match(SITE, /These depend on Wekan \$\{RELEASE\}, the release the builder pins; the rest goes on\./);
  assert.match(SITE, /^const RELEASE = process\.env\.WEKAN_RELEASE \|\| '13\.33';$/m);
  assert.match(read('README.md'), /depend on Wekan 13\.33, the release the builder pins/, 'the README says so');
});

test('the runtimes: DDEV only for now; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-wekan.sh'), /choices=\['ddev'\]/);
  const build = fn('wekan_build');
  const guard = build.indexOf('if [ "${runtime}" != \'ddev\' ] ; then');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.ok(build.includes('Wekan builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(build.indexOf('wekan_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly WEKAN_MEMORY_MB=1536;$/m);
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --omit-containers=db \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/, 'no MariaDB: the project\'s database is its own MongoDB');
  assert.match(build, /for volume in "ddev-\$\{PROJECT_NAME\}-wekan-db" "ddev-\$\{PROJECT_NAME\}-wekan-files" ; do/, 'a leftover volume of a project of the same name goes too');
  assert.match(read('README.md'), /Wekan needs a\nMongoDB-compatible database/, 'the README says why the database is MongoDB');
});

test('Wekan and MongoDB on DDEV: pinned images, a replica set of one, the data in volumes named after the project', () => {
  const compose = read('scripts/docker-compose.wekan.yaml');
  assert.match(compose, /image: "\$\{WEKAN_IMAGE:-ghcr\.io\/wekan\/wekan:v13\.33\}"/, 'pinned, by its whole name');
  assert.match(compose, /image: "\$\{WEKAN_MONGO_IMAGE:-docker\.io\/library\/mongo:7\.0\.48\}"/, 'MongoDB 7, pinned');
  assert.doesNotMatch(compose + FUN, /:latest\b/, 'never latest');
  assert.match(FUN, /^readonly WEKAN_DEFAULT_RELEASE='13\.33';$/m);
  assert.match(FUN, /^readonly WEKAN_MONGO_IMAGE='docker\.io\/library\/mongo:7\.0\.48';$/m);
  assert.match(fn('wekan_write_config'), /"\$\{WEKAN_IMAGE_REPOSITORY\}:v\$\{release\}" "\$\{WEKAN_MONGO_IMAGE\}"/, 'the images in .ddev/.env, Wekan\'s tagged v<release>');
  assert.match(compose, /--replSet rs0 --bind_ip_all/, 'a replica set, as Wekan\'s reference setup runs it');
  assert.match(compose, /rs\.initiate\(\{ _id: "rs0", members: \[\{ _id: 0, host: "mongo:27017" \}\] \}\)/);
  assert.match(compose, /rs\.status\(\)\.ok === 1 && db\.hello\(\)\.isWritablePrimary/, 'healthy once it is the primary');
  assert.match(compose, /depends_on:\n\s+mongo:\n\s+condition: service_healthy/);
  assert.match(compose, /- db:\/data\/db/);
  assert.match(compose, /- files:\/data/);
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-wekan-db/);
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-wekan-files/);
  assert.match(compose, /VIRTUAL_HOST: \$\{DDEV_HOSTNAME\}/);
  assert.match(compose, /HTTP_EXPOSE: "80:8080"/);
  assert.match(compose, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.doesNotMatch(compose, /PASSWORD|SECRET|TOKEN/, 'no secret in the compose file');
  const env = fn('wekan_write_env');
  for (const line of ['MONGO_URL=mongodb://mongo:27017/wekan?replicaSet=rs0', 'MONGO_OPLOG_URL=mongodb://mongo:27017/local?replicaSet=rs0', 'ROOT_URL=${base_url}', 'WITH_API=true', 'MAIL_URL=smtp://web:1025/?ignoreTLS=true']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  assert.match(env, /\( umask 077 && cat > "\$\{project_path\}\/\$\{WEKAN_FILES\}\/env"/, 'wekan/env is its owner\'s only');
});

test('the functions carry the names the core\'s tools look for; --connect keeps the token off screens and command lines', () => {
  for (const name of ['set_wekan_users', 'add_wekan_users', 'cancel_wekan_users', 'testing_configure_wekan', 'wekan_build', 'wekan_cli_tool', 'wekan_connect']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name} is defined`);
  }
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_stranger_role='' ;/);
  assert.match(FUN, /ddev exec "cd \/var\/www\/html && node \$\{WEKAN_FILES\}\/wekan-site\.mjs \$\*"/, 'in the project\'s web container, against Wekan at http://wekan:8080');
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  assert.doesNotMatch(FUN, /ddev exec -s wekan/, 'Wekan\'s image has no shell');
  const payload = fn('wekan_payload');
  assert.match(payload, /WEKAN_ADMIN_PASSWORD="\$\{account_pass\}" WEKAN_ROWS="\$1"/, 'the passwords reach Python in its environment only');
  const connect = fn('wekan_connect');
  assert.match(connect, /WEKAN_NEW_TOKEN="\$\{token\}" python3/, 'the token reaches the settings writer in its environment only');
  assert.match(connect, /0o600/);
  assert.match(connect, /text = put\(text, 'username', login\)/, 'the account\'s username beside its token');
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the token is never printed');
  assert.match(connect, /\[\[ "\$\{token\}" =~ \^\[A-Za-z0-9_-\]\{40,\}\$ \]\]/);
  const testing = FUN.slice(FUN.indexOf('function testing_configure_wekan()'));
  assert.match(testing, /registry="\$\{registry\}\$\{user\}\|\$\{!user_name\}\|\$\{!user_password\}\|\$\{!user_fullname\}"/, 'the pack signs in with the username and shows the full name');
  assert.match(testing, /board: process\.env\.BOARD \|\| '%s',/, 'the board of the steps');
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && wekan_payload "\$\(wekan_rows ''\)" \| wekan_site content > \/dev\/null 2>&1 \) ; then/, 'the sample content, in the project');
});

test('the assistant is told how to build, test and connect a site, and what Wekan has', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /1\.5 GB of free memory/);
  assert.match(told, /--connect <login>/);
  assert.match(told, /MongoDB 7 \(Wekan needs a MongoDB-compatible database/);
  assert.match(told, /no worklog and no sprint view/);
});

test('the docs say container-based, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-wekan.sh', 'config/plugin.wekan.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
  }
  for (const c of COMMANDS) assert.ok(read('README.md').includes(c), `the README lists ${c}`);
  const keys = [...read('config/plugin.wekan.settings.yml').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 13);
  for (const k of keys) assert.ok(read('README.md').includes(`\`${k}\``), `the README describes the setting ${k}`);
  assert.match(read('README.md'), /^## What the plugin does not do yet$/m);
  assert.match(read('README.md'), /its REST API has no route for time entries or for sprints/);
});
