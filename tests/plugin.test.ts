import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
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
  assert.deepStrictEqual(names, ['docker-compose.wekan.yaml', 'wekan-site.mjs', 'wekan-serve.sh', 'wekan-proxy.conf', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/wekan.feature', 'features/wekan-runtimes.feature']);
  assert.strictEqual(manifest.featuresSite, 'cmd-wekan-project.sh ci-wekan --install --add-users --sample-content --runtime docker', 'CI builds a site on Docker Compose for the runtimes feature');
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

test('the runtimes: DDEV, Docker Compose, Podman and Kubernetes; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-wekan.sh'), /choices=\['ddev', 'docker', 'podman', 'kubernetes'\]/);
  const build = fn('wekan_build');
  const guard = build.indexOf('case "${runtime}" in');
  const services = build.indexOf('declare -f rt_service');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.match(build, /case "\$\{runtime\}" in\n\s+ddev\|docker\|podman\|kubernetes\) ;;/, 'the four runtimes the plugin was proven on');
  assert.ok(build.includes('Wekan builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(services > guard && services < build.indexOf('drop_database'), 'a workspace whose runtimes run no service of a project\'s own is told so before anything is removed');
  assert.ok(build.indexOf('wekan_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly WEKAN_MEMORY_MB=1536;$/m);
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --omit-containers=db \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/, 'no MariaDB on DDEV: the project\'s database is its own MongoDB');
  assert.match(build, /ddev config --project-type=generic --webserver-type=generic --project-name=\$\{PROJECT_NAME\} --omit-containers=db --auto/, 'nor elsewhere: the runtime\'s own project, with no MariaDB');
  assert.ok(build.indexOf('base_url="$(wekan_url)"') > build.indexOf('wekan_write_config'), 'the address is read once the runtime has given the project its port');
  const values = build.indexOf('wekan_write_env "${project_path}"');
  const again = build.indexOf('if [ "${runtime}" = \'kubernetes\' ] ; then\n    ( cd "${project_path}" && ddev config < /dev/null > /dev/null ) || exit 1 ;');
  assert.ok(again > values && again < build.indexOf('ddev_up start'), 'on Kubernetes the project\'s files are written again once the site\'s values are there: its Secret takes Wekan\'s env file then');
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
  for (const line of ['MONGO_URL=mongodb://mongo:27017/wekan?replicaSet=rs0', 'MONGO_OPLOG_URL=mongodb://mongo:27017/local?replicaSet=rs0', 'ROOT_URL=${base_url}', 'WITH_API=true', 'MAIL_URL=smtp://${mail}:1025/?ignoreTLS=true']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  assert.match(env, /\( umask 077 && cat > "\$\{project_path\}\/\$\{WEKAN_FILES\}\/env"/, 'wekan/env is its owner\'s only');
});

/** What the builder writes for a runtime, with the runtime layer stood in: its calls, and the project's files. */
function written(runtime: string, address: string): { calls: string, dir: string, read: (f: string) => string, commandOf: (name: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  const plugin = path.join(dir, 'scripts', 'plugins', 'wekan');
  fs.mkdirSync(plugin, { recursive: true });
  for (const f of manifest.scripts.machine) fs.copyFileSync(path.join(PKG, f), path.join(plugin, path.basename(f)));
  const project = path.join(dir, 'mysite');
  fs.mkdirSync(path.join(project, '.ddev'), { recursive: true });
  const stand = [
    'rt_claim() { echo "rt_claim $*" >> "$LOG" ; }',
    'rt_stack() { echo "rt_stack $*" >> "$LOG" ; }',
    'rt_web_build() { echo "rt_web_build $*" >> "$LOG" ; cat > "$LOG.dockerfile" ; }',
    // A service's call, with its --command kept whole beside the log: it is one word of the call.
    'rt_service() { local n="$1" line="rt_service $1 $2" ; shift 2 ; while [ $# -gt 0 ] ; do if [ "$1" = --command ] ; then printf \'%s\' "$2" > "$LOG.$n.command" ; line="${line} --command [...]" ; else line="${line} $1 $2" ; fi ; shift 2 ; done ; echo "${line}" >> "$LOG" ; }',
    'rt_serve() { echo "rt_serve $1 [$2]" >> "$LOG" ; }',
  ].join('\n');
  const script = `${stand}\nsource "${path.join(PKG, 'scripts/functions/fun-wekan.sh')}"\nwekan_write_config "${project}" 13.33 ${runtime} && wekan_write_env "${project}" 13.33 "${address}" ${runtime}`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, WORKSPACE_SCRIPTS: path.join(dir, 'scripts'), LOG: path.join(dir, 'calls.log') } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const log = path.join(dir, 'calls.log');
  return {
    calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
    dir,
    read: (f: string) => fs.readFileSync(path.join(project, f), 'utf8'),
    commandOf: (name: string) => fs.readFileSync(`${log}.${name}.command`, 'utf8'),
  };
}

/** Remove a folder of this file's tests, never a path outside one. */
function removeTestDir(dir: string): void {
  const parts = path.relative(os.tmpdir(), path.resolve(dir)).split(path.sep);
  assert.ok(parts.length === 1 && /^wekan-runtimes-[A-Za-z0-9]{6}$/.test(parts[0]), `refused to remove ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A command line split into its words the way the runtime layer splits it (POSIX shell words, Python's shlex). */
function words(line: string): string[] {
  const r = spawnSync('python3', ['-c', 'import json, shlex, sys; print(json.dumps(shlex.split(sys.argv[1])))', line], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('on Docker Compose, Podman and Kubernetes: Wekan\'s image and MongoDB\'s as services of the project, the web container\'s nginx in front', () => {
  for (const runtime of ['docker', 'podman', 'kubernetes']) {
    const w = written(runtime, 'http://127.0.0.1:33001');
    try {
      assert.deepStrictEqual(w.calls.trim().split('\n'), [
        'rt_claim wekan',
        'rt_stack node 24',
        'rt_web_build wekan',
        'rt_service mongo docker.io/library/mongo:7.0.48 --port 27017 --volume /data/db --command [...]',
        'rt_service wekan ghcr.io/wekan/wekan:v13.33 --port 8080 --env-file wekan/env --volume /data',
        'rt_serve 8080 [bash wekan/wekan-serve.sh]',
      ], runtime);
      // MongoDB starts as on DDEV: a replica set of one, initiated once it answers; Wekan's image is not changed.
      const mongo = words(w.commandOf('mongo'));
      assert.deepStrictEqual(mongo.slice(0, 2), ['sh', '-c'], `${runtime}: one shell line`);
      assert.strictEqual(mongo.length, 3, `${runtime}: the line is one word of sh -c`);
      // On Kubernetes MongoDB's own name leads to its own container: through its Service it leads to the pod only once
      // the pod is ready, and MongoDB started again did not find itself in its replica set (REMOVED, no primary).
      const limit = 'ulimit -n "$(ulimit -Hn)" ; ';
      assert.ok(mongo[2].startsWith(limit), `${runtime}: its open files up to the container's hard limit`);
      const itself = 'grep -qx "127.0.0.1 mongo" /etc/hosts || echo "127.0.0.1 mongo" >> /etc/hosts ; ';
      if (runtime === 'kubernetes') assert.ok(mongo[2].slice(limit.length).startsWith(itself), `${runtime}: MongoDB finds itself in its replica set from the start`);
      else assert.ok(!mongo[2].includes('/etc/hosts'), `${runtime}: the name already leads to the container itself`);
      // On every runtime (#12) the shell passes a stop on to MongoDB (its own clean shutdown), ends with MongoDB's own
      // code (wait "$pid": a crash ends the container with a code that is not 0, so the core's restart policy, #959, or
      // Kubernetes starts it again), and ends when MongoDB ended before its replica set was initiated. On Kubernetes the
      // new pod's MongoDB also found the old one's data folder still held and stopped: the container ends with it.
      const start = runtime === 'kubernetes' ? limit.length + itself.length : limit.length;
      assert.match(mongo[2].slice(start), /^mongod --storageEngine wiredTiger --wiredTigerCacheSizeGB 0\.25 --oplogSize 256 --replSet rs0 --bind_ip_all --quiet & pid=\$! ; trap "kill -TERM \$pid ; wait \$pid ; exit \\\$\?" TERM INT ; until mongosh /, `${runtime}: mongod's PID kept, a stop passed on, and the shell ends with MongoDB's code then too`);
      assert.match(mongo[2], / ; do kill -0 \$pid 2> \/dev\/null \|\| exit 1 ; sleep 2 ; done ; wait \$pid$/, `${runtime}: the container ends with MongoDB, with its code`);
      assert.doesNotMatch(mongo[2], /; wait$/, `${runtime}: never a plain wait, which ends with 0 whatever MongoDB's code`);
      const evaluated = words(mongo[2].slice(mongo[2].indexOf('--eval '), mongo[2].indexOf(' > /dev/null')))[1];
      assert.strictEqual(evaluated, 'try { quit(rs.status().ok === 1 ? 0 : 1) } catch (e) { if (/NotYetInitialized|no replset config|not yet initialized/.test(String(e.codeName) + String(e.message))) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }) } quit(1) }', `${runtime}: what mongosh is given, once the shell has read it`);
      assert.ok(read('scripts/docker-compose.wekan.yaml').includes(`--eval '${evaluated}'`), `${runtime}: the same as on DDEV`);
      const fragment = fs.readFileSync(path.join(w.dir, 'calls.log.dockerfile'), 'utf8');
      assert.match(fragment, /^RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf \/var\/lib\/apt\/lists\/\*$/m, 'nginx in the web container');
      const env = w.read('wekan/env').split('\n');
      for (const line of ['ROOT_URL=http://127.0.0.1:33001', 'MONGO_URL=mongodb://mongo:27017/wekan?replicaSet=rs0', 'MAIL_URL=smtp://mail:1025/?ignoreTLS=true', 'WRITABLE_PATH=/data', 'PORT=8080']) assert.ok(env.includes(line), `${runtime}: ${line}`);
      assert.strictEqual(fs.statSync(path.join(w.dir, 'mysite', 'wekan', 'env')).mode & 0o777, 0o600, `${runtime}: wekan/env is its owner's only`);
      for (const f of ['wekan-site.mjs', 'wekan-serve.sh']) assert.ok(fs.existsSync(path.join(w.dir, 'mysite', 'wekan', f)), `${runtime}: wekan/${f}`);
      assert.strictEqual(w.read('wekan/nginx.conf'), read('scripts/wekan-proxy.conf'), `${runtime}: the web container's nginx settings`);
      for (const f of ['docker-compose.wekan.yaml', 'config.wekan.yaml', '.env']) assert.ok(!fs.existsSync(path.join(w.dir, 'mysite', '.ddev', f)), `${runtime}: no DDEV file (${f})`);
      const config = fn('wekan_write_config');
      assert.ok(config.indexOf('( umask 077 && : >> "${project_path}/${WEKAN_FILES}/env" ) || return 1 ;') < config.indexOf('rt_service mongo'), `${runtime}: Wekan's env file is there, its owner's only, before the services name it`);
    } finally {
      removeTestDir(w.dir);
    }
  }
  // On DDEV the project is what it was: Wekan's and MongoDB's services in DDEV's compose file, the mail catcher in the
  // web container, and no server of the plugin's.
  const d = written('ddev', 'https://mysite.ddev.site');
  try {
    assert.strictEqual(d.calls, '', 'no call of the runtime layer on DDEV');
    const env = d.read('wekan/env').split('\n');
    for (const line of ['ROOT_URL=https://mysite.ddev.site', 'MAIL_URL=smtp://web:1025/?ignoreTLS=true']) assert.ok(env.includes(line), line);
    for (const f of ['docker-compose.wekan.yaml', 'config.wekan.yaml', '.env']) assert.ok(fs.existsSync(path.join(d.dir, 'mysite', '.ddev', f)), f);
    for (const f of ['wekan-serve.sh', 'nginx.conf']) assert.ok(!fs.existsSync(path.join(d.dir, 'mysite', 'wekan', f)), `no wekan/${f} on DDEV`);
  } finally {
    removeTestDir(d.dir);
  }
});

test('MongoDB\'s shell on Docker Compose and Podman: a crash ends the container with MongoDB\'s code, a stop is passed on to MongoDB (#12)', () => {
  const w = written('docker', 'http://127.0.0.1:33001');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    const line = words(w.commandOf('mongo'))[2];
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(dir, 'calls.log');
    // MongoDB stood in: it runs until it is stopped (its own shutdown, 0), or ends with the code the test gives it.
    const mongod = (end: string) => fs.writeFileSync(path.join(bin, 'mongod'), `#!/usr/bin/env bash\necho "mongod started" >> "${log}"\ntrap 'echo "mongod: a clean shutdown" >> "${log}" ; exit 0' TERM\n${end}\n`, { mode: 0o755 });
    const mongosh = (code: number) => fs.writeFileSync(path.join(bin, 'mongosh'), `#!/usr/bin/env bash\nexit ${code}\n`, { mode: 0o755 });
    const run = (stopAfter = 0) => {
      fs.rmSync(log, { force: true });
      const r = spawnSync('sh', ['-c', line], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: stopAfter || 20000, killSignal: 'SIGTERM' });
      return { status: r.status, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [] };
    };
    // A crash once the replica set answers: the container ends with MongoDB's own code.
    mongod('sleep 3 ; exit 137');
    mongosh(0);
    assert.strictEqual(run().status, 137, 'a crash is not an end with 0');
    // MongoDB ends before its replica set answers: the container ends, rather than waiting for ever.
    mongod('sleep 1 ; exit 3');
    mongosh(1);
    assert.strictEqual(run().status, 1);
    // The container is asked to stop: MongoDB gets the stop and shuts down by itself.
    mongod('sleep 30 & wait $!');
    mongosh(0);
    const stopped = run(3000);
    assert.ok(stopped.log.includes('mongod: a clean shutdown'), `MongoDB's own shutdown: ${stopped.log.join(' | ')}`);
    assert.strictEqual(stopped.status, 0, 'the shell ended by itself once MongoDB had, with MongoDB\'s code');
  } finally {
    removeTestDir(dir);
    removeTestDir(w.dir);
  }
});

test('the web container\'s server on the other runtimes: nginx as the host user, passing the project\'s address to Wekan, websockets included', () => {
  const serve = read('scripts/wekan-serve.sh');
  assert.match(serve, /^mkdir -p \/tmp\/wekan-nginx \|\| exit 1$/m, 'nginx\'s own files where the host user writes');
  assert.match(serve, /^exec > >\(cat\) 2>&1\n(#.*\n)*exec nginx -e stderr -c "\$\{here\}\/nginx\.conf" -p \/tmp\/wekan-nginx -g 'daemon off;'$/m, 'the output a pipe of the host user\'s, then nginx in the foreground with the project\'s settings');
  const r = spawnSync('bash', ['-n', path.join(PKG, 'scripts/wekan-serve.sh')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const conf = read('scripts/wekan-proxy.conf');
  assert.doesNotMatch(conf, /^\s*user /m, 'no user to switch to: nginx runs as the user it starts as');
  assert.match(conf, /^pid \/tmp\/wekan-nginx\/nginx\.pid;$/m);
  assert.match(conf, /^error_log stderr warn;$/m);
  for (const t of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) assert.match(conf, new RegExp(`^\\s+${t}_temp_path /tmp/wekan-nginx/`, 'm'), `${t}: a folder the host user writes`);
  assert.match(conf, /^\s+listen 8080;$/m, 'the port rt_serve gives the project\'s address');
  assert.match(conf, /^\s+include \/tmp\/wekan-nginx\/wekan\.conf;\n\s+proxy_pass \$wekan;$/m, 'to Wekan\'s service, its address looked up while nginx runs');
  assert.doesNotMatch(conf, /proxy_pass http:\/\/wekan/, 'never an address looked up once: Wekan started again on its own may have another');
  assert.match(conf, /^\s+proxy_http_version 1\.1;$/m);
  assert.match(conf, /^\s+proxy_set_header Upgrade \$http_upgrade;$/m, 'websockets: Wekan\'s screens follow a board over one');
  assert.match(conf, /^\s+proxy_set_header Connection \$connection_upgrade;$/m);
  assert.match(conf, /^\s+proxy_set_header Host \$http_host;$/m, 'the project\'s address, its port included, as ROOT_URL has it');
  assert.match(conf, /^\s+client_max_body_size 100m;$/m, 'attachments go up through it');
  assert.match(fn('wekan_service_log'), /docker\|podman\) rt_dc "\$\{rt\}" "\$\{root\}" logs --tail "\$\{lines\}" "\$\{service\}"/, 'elsewhere Wekan\'s and MongoDB\'s logs are read from the runtime');
  assert.match(fn('wekan_service_log'), /kubernetes\) rt_kubectl -n "\$\(rt_k8s_ns "\$\{root\}"\)" logs "deploy\/\$\{service\}"/);
});

/** The resolver and Wekan's address the server script writes for nginx, from a container's /etc/resolv.conf. */
function upstreamFor(resolvConf: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    fs.writeFileSync(path.join(dir, 'resolv.conf'), resolvConf);
    // The script up to nginx's start, reading the given resolv.conf and writing into the test's folder.
    const script = read('scripts/wekan-serve.sh').split('\n').filter((l) => !/^exec /.test(l)).join('\n')
      .replace(/\/etc\/resolv\.conf/g, path.join(dir, 'resolv.conf')).replace(/\/tmp\/wekan-nginx/g, path.join(dir, 'nginx'));
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    return fs.readFileSync(path.join(dir, 'nginx', 'wekan.conf'), 'utf8');
  } finally {
    removeTestDir(dir);
  }
}

test('nginx looks Wekan up while it runs, by the container\'s own DNS server, under the name each runtime answers', () => {
  assert.strictEqual(upstreamFor('nameserver 127.0.0.11\nsearch example.org\noptions ndots:0\n'),
    'resolver 127.0.0.11 valid=5s ipv6=off;\nset $wekan http://wekan:8080;\n', 'Docker Compose: its own DNS answers the service\'s name, whatever the host\'s search domain');
  assert.strictEqual(upstreamFor('search dns.podman\nnameserver 10.89.0.1\n'),
    'resolver 10.89.0.1 valid=5s ipv6=off;\nset $wekan http://wekan:8080;\n', 'Podman: aardvark-dns answers the service\'s name');
  assert.strictEqual(upstreamFor('search ws-mysite.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n'),
    'resolver 10.96.0.10 valid=5s ipv6=off;\nset $wekan http://wekan.ws-mysite.svc.cluster.local:8080;\n', 'Kubernetes: the Service by its whole name, in the project\'s namespace');
  assert.strictEqual(upstreamFor('nameserver fd00::1\n'),
    'resolver [fd00::1] valid=5s ipv6=off;\nset $wekan http://wekan:8080;\n', 'an IPv6 DNS server, in brackets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    fs.writeFileSync(path.join(dir, 'resolv.conf'), '# none\n');
    const script = read('scripts/wekan-serve.sh').split('\n').filter((l) => !/^exec /.test(l)).join('\n')
      .replace(/\/etc\/resolv\.conf/g, path.join(dir, 'resolv.conf')).replace(/\/tmp\/wekan-nginx/g, path.join(dir, 'nginx'));
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0, 'no DNS server: the server stops, saying so');
    assert.match(r.stderr, /no DNS server in /);
  } finally {
    removeTestDir(dir);
  }
});

/** The database hook's functions with the MongoDB container stood in (wekan_mongo, wekan_service): its calls, its result. */
function hook(fn: string, file: string, mongo: string): { status: number, out: string, calls: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    const log = path.join(dir, 'calls.log');
    const script = [
      `source "${path.join(PKG, 'scripts/functions/fun-wekan.sh')}"`,
      // The container: mongodump writes a gzipped archive with mongodump's own first bytes; mongorestore reads its input.
      `wekan_mongo() { echo "$*" >> "${log}" ; ${mongo} }`,
      `wekan_service() { echo "service $1" >> "${log}" ; }`,
      `${fn} "${file}"`,
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { status: r.status ?? 1, out: r.stdout + r.stderr, calls };
  } finally {
    removeTestDir(dir);
  }
}

test('Wekan\'s database in the core\'s backups and restores: mongodump\'s gzipped archive, checked whole before mongorestore replaces it', () => {
  for (const name of ['wekan_is_project', 'wekan_export_db', 'wekan_import_db', 'wekan_db_extension']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name}: the core's hook (webship/workspace#937) asks it`);
  }
  assert.match(fn('wekan_db_extension'), /echo '\.archive\.gz' ;/);
  assert.match(fn('wekan_export_db'), /wekan_mongo mongodump --quiet --archive --gzip --db=wekan < \/dev\/null > "\$\{file\}"/, 'the database wekan, as an archive on the output');
  const archive = `case "$1" in mongodump) printf '\\x6d\\xe2\\x99\\x81rest of an archive' | gzip ;; mongosh) echo '1 board(s), 3 card(s), 5 account(s)' ;; mongorestore) cat > /dev/null ;; esac ;`;
  // The export: the archive in the file, said with what it holds.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    const file = path.join(dir, 'site-db.archive.gz');
    const script = `source "${path.join(PKG, 'scripts/functions/fun-wekan.sh')}"\nwekan_mongo() { ${archive} }\nwekan_export_db "${file}"`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Wekan's database \(1 board\(s\), 3 card\(s\), 5 account\(s\)\) is in site-db\.archive\.gz\./);
    assert.strictEqual(spawnSync('bash', ['-c', `gzip -dc "${file}" | head -c 4 | od -An -tx1 | tr -d ' \\n'`], { encoding: 'utf8' }).stdout, '6de29981');
    // A dump that fails leaves no file behind.
    const broken = path.join(dir, 'broken.archive.gz');
    const r2 = spawnSync('bash', ['-c', `source "${path.join(PKG, 'scripts/functions/fun-wekan.sh')}"\nwekan_mongo() { return 1 ; }\nwekan_export_db "${broken}"`], { encoding: 'utf8' });
    assert.notStrictEqual(r2.status, 0);
    assert.ok(!fs.existsSync(broken), 'no dump left behind');
    // The import: what is not a whole gzip, or not mongodump's archive, changes nothing.
    fs.writeFileSync(path.join(dir, 'plain.sql'), 'CREATE TABLE t (id int);\n');
    spawnSync('bash', ['-c', `printf 'CREATE TABLE t (id int);\\n' | gzip > "${dir}/mariadb.sql.gz" ; printf '\\x6d\\xe2\\x99\\x81whole' | gzip > "${dir}/cut.archive.gz" ; truncate -s 20 "${dir}/cut.archive.gz"`]);
    const refused: [string, RegExp][] = [['plain.sql', /is not a whole gzipped file: nothing was changed/], ['mariadb.sql.gz', /is not a dump of Wekan's database \(mongodump's gzipped archive\): nothing was changed/], ['cut.archive.gz', /is not a whole gzipped file: nothing was changed/], ['none.archive.gz', /There is no dump at .*: nothing was changed/]];
    for (const [f, said] of refused) {
      const h = hook('wekan_import_db', path.join(dir, f), archive);
      assert.notStrictEqual(h.status, 0, `${f} is refused`);
      assert.match(h.out, said, f);
      assert.ok(!h.calls.some((c) => /--drop/.test(c)), `${f}: the database is left as it is`);
    }
  } finally {
    removeTestDir(dir);
  }
  // A whole archive: read through first (--dryRun), then the database wekan replaced (--drop) and Wekan started again.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-runtimes-'));
  try {
    const file = path.join(dir2, 'site-db.sql.gz');
    spawnSync('bash', ['-c', `printf '\\x6d\\xe2\\x99\\x81whole' | gzip > "${file}"`]);
    const log = path.join(dir2, 'calls.log');
    const script = `source "${path.join(PKG, 'scripts/functions/fun-wekan.sh')}"\nwekan_mongo() { echo "$*" >> "${log}" ; ${archive} }\nwekan_service() { echo "service $1" >> "${log}" ; }\nwekan_import_db "${file}"`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter((c) => !c.startsWith('mongosh'));
    assert.deepStrictEqual(calls, [
      "mongorestore --quiet --archive --gzip --dryRun --nsInclude=wekan.*",
      'service stop',
      "mongorestore --quiet --archive --gzip --drop --nsInclude=wekan.*",
      'service start',
    ], 'read through first, then replaced with Wekan stopped, under its .sql.gz name too');
    assert.match(r.stdout, /Wekan's database \(1 board\(s\), 3 card\(s\), 5 account\(s\)\) is replaced with site-db\.sql\.gz: Wekan is stopped meanwhile\./, 'it says what it replaces');
  } finally {
    removeTestDir(dir2);
  }
  assert.match(fn('wekan_mongo'), /ddev\)\n[^\n]*\n\s+docker exec -i "ddev-\$\{name\}-mongo" "\$@" ;;/, 'DDEV\'s container of the mongo service');
  assert.match(fn('wekan_mongo'), /docker\|podman\) rt_dc "\$\{rt\}" "\$\{root\}" exec -T mongo "\$@" ;;/);
  assert.match(fn('wekan_mongo'), /kubernetes\) rt_kubectl -n "\$\(rt_k8s_ns "\$\{root\}"\)" exec -i deploy\/mongo -- "\$@" ;;/);
  assert.match(fn('wekan_service'), /kubernetes\)\n\s+local replicas=1 ; \[ "\$\{verb\}" = stop \] && replicas=0 ;/, 'on Kubernetes its Deployment scaled to none and back');
  // MongoDB's open files up to the container's hard limit, on every runtime: Docker's default soft limit (1024) was
  // passed by a restore of Wekan's collections and indexes, and MongoDB stopped.
  assert.match(read('scripts/docker-compose.wekan.yaml'), /- \|\n\s+ulimit -n "\$\$\(ulimit -Hn\)"\n\s+mongod --storageEngine/, 'on DDEV, its $ escaped for compose');
  assert.match(FUN, /local limit='ulimit -n "\$\(ulimit -Hn\)" ; '/);
  assert.match(read('README.md'), /mongodump's archive of the database wekan, gzipped/, 'the README says how the site is backed up');
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
  assert.match(told, /with `--runtime docker`, `podman` or `kubernetes` in the same layout through the runtime layer/, 'and where else it builds');
  assert.match(told, /Lando and Docksal are not proven for it yet/);
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
