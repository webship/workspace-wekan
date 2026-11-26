// The Wekan builder's script: the site's first account, its default accounts and their roles in the sample board, the
// sample content, and the clean-up after a stopped test run, through Wekan's own REST API. What that API does not have
// (a person's full name, a password given back, Scrum planning and a sprint, a day of logged time) goes through the
// methods Wekan's own screens call over its websocket, at the release the builder runs (13.33 by default).
//
// It runs in the project's web container, where Wekan answers at http://wekan:8080, started by the plugin's functions:
//   node wekan-site.mjs <verb> [list]
// with what it needs (accounts, passwords, a login) on its input, as the base64 of a JSON object, never on a command
// line. A token it makes is printed only by the verb `token`, on its own line (TOKEN …), for the tool to store; the
// logins it opens for its own work are revoked when it ends (POST /users/logout), so a run leaves no login behind.
//
// Verbs:
//   install    the workspace account as the site's first account, Wekan's administrator; sign-up turned off.
//   accounts   the default accounts: made, or given back their names and passwords; locked (action "lock"); each in
//              its role of the sample board (owner: its administrator, member: a normal member, reader: read-only),
//              the stranger in none.
//   content    the sample content, where it is missing: the cards in the board's lists, a label, an assignee, a
//              comment, a checklist, Scrum planning with one active sprint, and a day of logged time.
//   tidy       what a stopped test run left: cards titled "Webship test …" by a default account (archived ones too),
//              and comments starting "Webship test" by one on the sample cards. With "list", only what it would remove.
//   list       the accounts and their roles in the sample board, and its cards.
//   token      a new login token of an account (POST /api/createtoken, which Wekan records as the administrator's).
//   counts     what the site holds, read from its database through the API: for a run's before and after.

const ROOT = process.env.WEKAN_INTERNAL_URL || 'http://wekan:8080';
const BOARD = 'Webship site';
const LISTS = ['To Do', 'Doing', 'Done'];
const ROLES = { owner: 'admin', member: 'normal', reader: 'readonly' };
const TEST = /^Webship test\b/;

const said = (d) => (d && typeof d === 'object' ? String(d.reason || d.error || d.message || JSON.stringify(d)) : String(d || '')).slice(0, 300);

/** One call of Wekan's REST API; a token goes in the header only, and never into what is printed. */
async function rest(method, route, body, token) {
  const r = await fetch(ROOT + route, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!r.ok || (data && typeof data === 'object' && !Array.isArray(data) && data.error && r.status >= 400)) {
    const e = new Error(`${method} ${route.replace(/\?.*$/, '')} answered ${r.status}: ${said(data)}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

/** The login tokens this run opened: each is revoked when the run ends, so a run leaves no login behind. */
const opened = [];

/** A login of an account: its id and a login token. */
async function login(username, password) {
  const d = await rest('POST', '/users/login', { username, password });
  if (!d || !d.token || !d.id) throw new Error(`Wekan gave ${username} no login token`);
  opened.push(String(d.token));
  return { id: String(d.id), token: String(d.token), username };
}

/** Revoke the login tokens this run opened (Wekan's POST /users/logout, with the token itself). */
async function closeAll() {
  for (const token of opened.splice(0)) await rest('POST', '/users/logout', {}, token).catch(() => {});
}

/**
 * A session on Wekan's websocket (DDP), logged in with a login token as a resume token: the calls its own screens make.
 * Closed by the caller.
 */
function ddp(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ROOT.replace(/^http/, 'ws') + '/websocket');
    let n = 0;
    const waiting = new Map();
    const send = (m) => ws.send(JSON.stringify(m));
    const call = (method, ...params) => new Promise((res, rej) => {
      const id = String(++n);
      waiting.set(id, { res, rej, method });
      send({ msg: 'method', method, params, id });
    });
    const timer = setTimeout(() => { reject(new Error('Wekan\'s websocket did not answer in 30 s')); try { ws.close(); } catch (_) { /* closed */ } }, 30000);
    const dropAll = (why) => { for (const w of waiting.values()) w.rej(new Error(`${w.method}: ${why}`)); waiting.clear(); };
    ws.addEventListener('open', () => send({ msg: 'connect', version: '1', support: ['1', 'pre2', 'pre1'] }));
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Wekan\'s websocket refused the connection')); dropAll('the websocket failed'); });
    ws.addEventListener('close', () => dropAll('the websocket closed'));
    ws.addEventListener('message', async (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch (_) { return; }
      if (m.msg === 'ping') { send({ msg: 'pong', ...(m.id ? { id: m.id } : {}) }); return; }
      if (m.msg === 'failed') { clearTimeout(timer); reject(new Error('Wekan refused the version of the websocket protocol')); return; }
      if (m.msg === 'connected') {
        try {
          await call('login', { resume: token });
          clearTimeout(timer);
          resolve({ call, close: () => { try { ws.close(); } catch (_) { /* closed */ } } });
        } catch (e) { clearTimeout(timer); reject(new Error(`Wekan refused the login token on its websocket (${e.message})`)); try { ws.close(); } catch (_) { /* closed */ } }
        return;
      }
      if (m.msg === 'result' && waiting.has(m.id)) {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) w.rej(new Error(`${w.method}: ${m.error.reason || m.error.message || m.error.error}`));
        else w.res(m.result);
      }
    });
  });
}

/** Calls of Wekan's own methods as an account, in one session. */
async function asPerson(token, work) {
  const s = await ddp(token);
  try { return await work(s.call); } finally { s.close(); }
}

const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const today = () => new Date().toISOString().slice(0, 10);
const dayFrom = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function readInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString().trim();
  if (!raw) return {};
  return JSON.parse(Buffer.from(raw, 'base64').toString());
}

/** The administrator's session: the workspace account's login. */
async function admin(payload) {
  const a = payload.admin || {};
  if (!a.login || !a.password) throw new Error('no administrator account was given (the workspace account in core/config/settings.yml)');
  try { return await login(a.login, a.password); } catch (e) {
    throw new Error(`the workspace account ${a.login} cannot log in to Wekan (${e.status || e.message}): is the site built with --install, and its password the one in core/config/settings.yml?`);
  }
}

/** The site's accounts, as the administrator sees them: username → id. */
async function accountsOf(adm) {
  const rows = await rest('GET', '/api/users', undefined, adm.token);
  return new Map((Array.isArray(rows) ? rows : []).map((u) => [String(u.username), String(u._id)]));
}

/** The sample board of the owner (its id and default swimlane), made with its lists and its label when it is not there. */
async function boardOf(owner, { make = true } = {}) {
  const mine = await rest('GET', `/api/users/${owner.id}/boards`, undefined, owner.token);
  let b = (Array.isArray(mine) ? mine : []).find((x) => x && x.title === BOARD);
  if (!b) {
    if (!make) return null;
    const made = await rest('POST', '/api/boards', { title: BOARD, owner: owner.id, permission: 'private', color: 'belize' }, owner.token);
    b = { _id: made._id };
    console.log(`The board ${BOARD} was made, owned by ${owner.username}.`);
  }
  const id = String(b._id);
  const lists = await rest('GET', `/api/boards/${id}/lists`, undefined, owner.token);
  const have = new Map((Array.isArray(lists) ? lists : []).map((l) => [String(l.title), String(l._id)]));
  for (const title of LISTS) {
    if (!have.has(title)) {
      const l = await rest('POST', `/api/boards/${id}/lists`, { title }, owner.token);
      have.set(title, String(l._id));
    }
  }
  const board = await rest('GET', `/api/boards/${id}`, undefined, owner.token);
  if (!(board.labels || []).some((l) => l && l.name === 'bug')) {
    await rest('PUT', `/api/boards/${id}/labels`, { label: { color: 'red', name: 'bug' } }, owner.token);
  }
  const lanes = await rest('GET', `/api/boards/${id}/swimlanes`, undefined, owner.token);
  const lane = (Array.isArray(lanes) ? lanes : [])[0];
  return { id, lists: have, lane: lane ? String(lane._id) : '', board: await rest('GET', `/api/boards/${id}`, undefined, owner.token) };
}

async function install(payload) {
  const { login: user, mail, password, name } = payload;
  if (!user || !password) throw new Error('no workspace account was given');
  let adm = null;
  try { adm = await login(user, password); } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
  }
  if (!adm) {
    try {
      const d = await rest('POST', '/users/register', { username: user, email: mail, password });
      opened.push(String(d.token));
      adm = { id: String(d.id), token: String(d.token), username: user };
    } catch (e) {
      throw new Error(`${user} cannot log in, and Wekan took no sign-up for it (${e.message}): build the site again from nothing`);
    }
  }
  const me = await rest('GET', '/api/user', undefined, adm.token);
  if (!me || me.isAdmin !== true) {
    throw new Error(`${user} is on the site but is not Wekan's administrator (Wekan makes its first account the administrator, and the site had accounts already): build the site again from nothing`);
  }
  await rest('PUT', '/api/settings', { disableRegistration: true }, adm.token);
  await asPerson(adm.token, (call) => call('setOwnProfile', name || user, initialsOf(name || user)));
  console.log(`ADMIN ${user}`);
  console.log(`${user} is Wekan's administrator, and the sign-up is off: an administrator makes the accounts.`);
}

async function accounts(payload) {
  const adm = await admin(payload);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  let ids = await accountsOf(adm);
  const sessions = new Map();
  for (const row of rows) {
    let id = ids.get(row.login);
    let s = null;
    if (!id) {
      const made = await rest('POST', '/api/users/', { username: row.login, email: row.mail, password: row.password }, adm.token);
      id = String(made._id);
      console.log(`  ${row.login}: made`);
    } else if (row.action !== 'lock') {
      await rest('PUT', `/api/users/${id}`, { action: 'enableLogin' }, adm.token);
      // Its password given back only when it no longer signs in with it: Wekan ends every session of an account whose
      // password an administrator sets, a connected dashboard's among them.
      s = await login(row.login, row.password).catch(() => null);
      if (!s) {
        await asPerson(adm.token, (call) => call('setPassword', row.password, id));
        console.log(`  ${row.login}: its password given back, and it may log in`);
      } else {
        console.log(`  ${row.login}: there, and it may log in`);
      }
    }
    if (row.action === 'lock') {
      await rest('PUT', `/api/users/${id}`, { action: 'disableLogin' }, adm.token);
      console.log(`  ${row.login}: kept from logging in`);
      continue;
    }
    if (!s) s = await login(row.login, row.password);
    await asPerson(s.token, (call) => call('setOwnProfile', row.name, initialsOf(row.name)));
    sessions.set(row.login, s);
  }
  ids = await accountsOf(adm);
  const ownerRow = rows.find((r) => r.role === 'owner');
  if (!ownerRow || !sessions.has(ownerRow.login)) return;
  const owner = sessions.get(ownerRow.login);
  const b = await boardOf(owner);
  const members = new Map((b.board.members || []).map((m) => [String(m.userId), m]));
  for (const row of rows) {
    const id = ids.get(row.login);
    if (!id || id === owner.id) continue;
    const role = ROLES[row.role];
    const member = members.get(id);
    if (!role) {
      if (member && member.isActive !== false) {
        await rest('POST', `/api/boards/${b.id}/members/${id}/remove`, { action: 'remove' }, owner.token);
        console.log(`  ${row.login}: taken off ${BOARD}`);
      }
      continue;
    }
    if (!member || member.isActive === false) {
      await rest('POST', `/api/boards/${b.id}/members/${id}/add`, { action: 'add', role }, owner.token);
    } else {
      await rest('POST', `/api/boards/${b.id}/members/${id}`, { role }, owner.token);
    }
  }
  console.log(`The accounts are in their roles of ${BOARD}: ${rows.map((r) => `${r.login} ${ROLES[r.role] ? (r.role === 'owner' ? 'its administrator' : r.role === 'reader' ? 'read-only' : 'a normal member') : 'not on it'}`).join(', ')}.`);
}

/** The cards of the board, archived ones too, with its lists, people and comments (Wekan's own export of the board). */
async function exportOf(boardId, token, query = 'attachments=false') {
  return rest('GET', `/api/boards/${boardId}/export?${query}`, undefined, token);
}

async function content(payload) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const find = (role) => rows.find((r) => r.role === role);
  if (!find('owner') || !find('member')) throw new Error('the owner and the member of the default accounts were not given');
  const owner = await login(find('owner').login, find('owner').password);
  const member = await login(find('member').login, find('member').password);
  const b = await boardOf(owner, { make: false });
  if (!b) throw new Error(`no board ${BOARD} of ${owner.username}: add the default accounts first (--add-users)`);
  const label = (b.board.labels || []).find((l) => l && l.name === 'bug');
  const ex = await exportOf(b.id, owner.token, 'attachments=false&archived=false');
  const byTitle = new Map((ex.cards || []).map((c) => [String(c.title), c]));
  const cards = [
    { key: 1, title: 'The greeting script says Helo instead of Hello', list: 'Doing', by: owner,
      description: '`greeting.sh` prints *Helo* where it should print *Hello*.' },
    { key: 2, title: 'The usage line spells greeting as greting', list: 'To Do', by: member,
      description: 'The usage line of `greeting.sh` says *greting*.' },
    { key: 3, title: 'Add a test for the greeting', list: 'Done', by: owner,
      description: 'A test that runs `greeting.sh` and expects *Hello*.' },
  ];
  const made = {};
  for (const c of cards) {
    const there = byTitle.get(c.title);
    if (there) { made[c.key] = { id: String(there._id), list: String(there.listId), fresh: false }; continue; }
    const r = await rest('POST', `/api/boards/${b.id}/lists/${b.lists.get(c.list)}/cards`, { title: c.title, description: c.description, authorId: c.by.id, swimlaneId: b.lane }, c.by.token);
    made[c.key] = { id: String(r._id), list: b.lists.get(c.list), fresh: true };
    console.log(`  the card "${c.title}" in ${c.list}, by ${c.by.username}`);
  }
  // Card 1: assigned to the member, the label bug, a comment of the owner, and a checklist.
  const one = made[1];
  if (one.fresh) {
    await rest('POST', `/api/boards/${b.id}/lists/${one.list}/cards/${one.id}/assignees/${member.id}`, {}, owner.token);
    if (label) await rest('POST', `/api/boards/${b.id}/cards/labels`, { cardIds: [one.id], addLabelIds: [label._id], removeLabelIds: [] }, owner.token);
    await rest('POST', `/api/boards/${b.id}/cards/${one.id}/comments`, { authorId: owner.id, comment: 'Seen on the test site: the greeting prints Helo.' }, owner.token);
    await rest('POST', `/api/boards/${b.id}/cards/${one.id}/checklists`, { title: 'Checks', items: ['Fix the spelling in greeting.sh'] }, owner.token);
  }
  // Scrum planning on the board, with Sprint 1 active and cards 1 and 2 in it; a day of the member's logged time on card 1.
  await asPerson(owner.token, async (call) => {
    let data = await call('scrum.getBoardData', b.id);
    if (!data.settings || data.settings.enabled !== true) {
      await call('scrum.configure', b.id, { enabled: true }, Number(data.settingsRevision || 0));
      data = await call('scrum.getBoardData', b.id);
    }
    let sprint = (data.sprints || []).find((s) => s && s.name === 'Sprint 1');
    if (!sprint) {
      sprint = await call('scrum.saveSprint', b.id, null, { name: 'Sprint 1', goal: 'Fix the greeting', plannedStart: dayFrom(-3), plannedEnd: dayFrom(11), capacity: null, capacityUnit: 'points' }, null);
      console.log('  Scrum planning on, with Sprint 1');
    }
    if (sprint.state === 'planned') sprint = await call('scrum.startSprint', b.id, sprint._id, Number(sprint.revision));
    for (const key of [1, 2]) {
      const card = (data.cards || []).find((x) => String(x._id) === made[key].id);
      if (!card || !card.scrum || card.scrum.sprintId !== sprint._id) await call('scrum.updateCard', b.id, made[key].id, { sprintId: sprint._id }, null);
    }
  });
  await asPerson(member.token, async (call) => {
    const time = await call('timeEntriesOfCard', one.id);
    if (!time || !Array.isArray(time.entries) || time.entries.length === 0) {
      await call('timeEntryAdd', one.id, { date: today(), hours: 0.5, note: 'Found where the greeting is spelled' });
      console.log('  half an hour of the member\'s time on card 1');
    }
  });
  console.log(`The sample content of ${BOARD} is there: its three cards, the label, the assignee, the comment, the checklist, Sprint 1 and the logged time.`);
}

async function tidy(payload, onlyList) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const ownerRow = rows.find((r) => r.role === 'owner');
  if (!ownerRow) throw new Error('the owner of the default accounts was not given');
  const owner = await login(ownerRow.login, ownerRow.password);
  const b = await boardOf(owner, { make: false });
  if (!b) { console.log(`No board ${BOARD}: nothing to tidy.`); return; }
  const adm = await admin(payload);
  const ids = await accountsOf(adm);
  const ours = new Set(rows.map((r) => ids.get(r.login)).filter(Boolean));
  const ex = await exportOf(b.id, owner.token);
  const cards = (ex.cards || []).filter((c) => TEST.test(String(c.title || '')) && ours.has(String(c.userId)));
  const gone = new Set(cards.map((c) => String(c._id)));
  const comments = (ex.comments || []).filter((c) => TEST.test(String(c.text || '')) && ours.has(String(c.userId)) && !gone.has(String(c.cardId)));
  for (const c of cards) {
    if (!onlyList) await rest('DELETE', `/api/boards/${b.id}/lists/${c.listId}/cards/${c._id}`, undefined, owner.token);
    console.log(`  ${onlyList ? 'would remove' : 'removed'} the card "${c.title}"${c.archived ? ' (archived)' : ''}`);
  }
  for (const c of comments) {
    if (!onlyList) await rest('DELETE', `/api/boards/${b.id}/cards/${c.cardId}/comments/${c._id}`, undefined, owner.token);
    console.log(`  ${onlyList ? 'would remove' : 'removed'} a comment "${String(c.text).slice(0, 60)}"`);
  }
  console.log(`tidy: ${cards.length} card(s) and ${comments.length} comment(s) ${onlyList ? 'to remove' : 'removed'}.`);
}

async function list(payload) {
  const adm = await admin(payload);
  const ids = await accountsOf(adm);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const ownerRow = rows.find((r) => r.role === 'owner');
  let roles = new Map();
  let cards = [];
  if (ownerRow && ids.has(ownerRow.login)) {
    try {
      const owner = await login(ownerRow.login, ownerRow.password);
      const b = await boardOf(owner, { make: false });
      if (b) {
        const ex = await exportOf(b.id, owner.token, 'attachments=false&archived=false&fields=board-header,people');
        const listName = new Map((ex.lists || []).map((l) => [String(l._id), String(l.title)]));
        roles = new Map((ex.members || []).filter((m) => m.isActive !== false).map((m) => [String(m.userId), m.isAdmin ? 'an administrator' : m.isReadOnly || m.isReadAssignedOnly ? 'a read-only member' : m.isCommentOnly || m.isCommentAssignedOnly ? 'a comment-only member' : 'a normal member']));
        cards = (ex.cards || []).map((c) => `${listName.get(String(c.listId)) || '?'}: ${c.title}`);
      }
    } catch (e) { console.log(`  (the board could not be read as ${ownerRow.login}: ${e.message})`); }
  }
  console.log('The accounts:');
  for (const [username, id] of ids) {
    const role = roles.get(id);
    console.log(`  ${username.padEnd(16)} ${role ? `${role} of ${BOARD}` : `not on ${BOARD}`}${username === (payload.admin || {}).login ? ' (the site\'s administrator)' : ''}`);
  }
  if (cards.length) { console.log(`The cards of ${BOARD}:`); for (const c of cards) console.log(`  ${c}`); }
}

async function token(payload) {
  const adm = await admin(payload);
  const ids = await accountsOf(adm);
  const id = ids.get(String(payload.login || ''));
  if (!id) throw new Error(`no account ${payload.login} on the site`);
  const d = await rest('POST', `/api/createtoken/${id}`, { reason: 'Webship Workspace: the dashboard\'s connection' }, adm.token);
  if (!d || !d.authToken) throw new Error('Wekan made no token');
  console.log(`TOKEN ${d.authToken}`);
}

async function counts(payload) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const ownerRow = rows.find((r) => r.role === 'owner');
  const adm = await admin(payload);
  const ids = await accountsOf(adm);
  console.log(`accounts ${ids.size}`);
  if (!ownerRow) return;
  const owner = await login(ownerRow.login, ownerRow.password);
  const b = await boardOf(owner, { make: false });
  if (!b) { console.log('board 0'); return; }
  const ex = await exportOf(b.id, owner.token);
  const n = (k) => (Array.isArray(ex[k]) ? ex[k].length : 0);
  console.log(`board 1`);
  for (const k of ['lists', 'swimlanes', 'labels', 'members']) console.log(`${k} ${n(k)}`);
  console.log(`cards ${n('cards')} (archived ${(ex.cards || []).filter((c) => c.archived).length})`);
  console.log(`comments ${n('comments')}`);
  console.log(`checklists ${n('checklists')}`);
  console.log(`checklist items ${n('checklistItems')}`);
  const sprintCards = (ex.cards || []).filter((c) => c.scrum && c.scrum.sprintId).length;
  console.log(`cards in a sprint ${sprintCards}`);
  console.log(`spent hours ${(ex.cards || []).reduce((s, c) => s + Number(c.spentTime || 0), 0)}`);
}

const [verb, flag] = process.argv.slice(2);
const verbs = { install, accounts, content, tidy: (p) => tidy(p, flag === 'list'), list, token, counts };
if (!verbs[verb]) {
  console.error(`wekan-site.mjs: no verb ${verb || '(none)'}; one of ${Object.keys(verbs).join(', ')}`);
  process.exit(2);
}
let failed = null;
try {
  await verbs[verb](await readInput());
} catch (e) {
  failed = e;
} finally {
  await closeAll();
}
if (failed) {
  console.error(`Wekan: ${failed.message}`);
  process.exit(1);
}
