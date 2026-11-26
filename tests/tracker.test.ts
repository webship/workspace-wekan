import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { inOrder, isoOf, itemOf, ITEM_RE, labelsOf, lastEditOf, listFrom, listsOf, peopleOf, roleAssociation, saidOf, stateClassOf, textOf, TOKEN_RE, wekanTracker } from '../src/lib/tracker';

// Recorded from a Wekan 13.33 site the plugin's builder made (--install --add-users --sample-content), read through its
// REST API as the account member (tools/wk-record-fixtures.py in the trackers round), the site's address made
// https://wekan.test and no token kept. Webship site (board 7bP5KPvW5YgkGTDAj): owner (RboScADWtmWaARDEE) is its
// administrator, member (cWtBgaQixKxe8accM) a normal member, reader (aurNgN7niLNcnCtXG) a read-only member; stranger
// and the administrator of the site are not on it. Its lists are To Do, Doing and Done, made through REST: they have no
// place yet, so they are in the order they were made. Card 1 is in Doing, card 2 in To Do, card 3 in Done.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${f}.json`), 'utf8'));
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = 'Wk3n-l0gin_T0ken'.padEnd(43, 'x');
const SETTINGS = { url: 'https://wekan.test', username: 'member', token: TOKEN, default_scope: 'Webship site' };
const SCOPE = { id: 'Webship site', name: 'Webship site', web: 'https://wekan.test/' };
const BOARD = '7bP5KPvW5YgkGTDAj';
const OWNER = 'RboScADWtmWaARDEE';
const MEMBER = 'cWtBgaQixKxe8accM';
const READER = 'aurNgN7niLNcnCtXG';
const CARDS: Record<string, string> = {};
for (const n of ['1', '2', '3']) {
  const ex = fixture(`export-card-${n}`);
  CARDS[ex.cards[0]._id] = `export-card-${n}`;
}
const ID = Object.fromEntries(Object.entries(CARDS).map(([id, f]) => [f.slice(-1), id])) as Record<string, string>;
const LISTS: Record<string, string> = Object.fromEntries((fixture('lists') as any[]).map((l) => [l._id, `list-${String(l.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`]));
const LIST = Object.fromEntries((fixture('lists') as any[]).map((l) => [l.title, l._id])) as Record<string, string>;

/** What a curl call asked: its method, its address, its body and its headers file. */
function readCurl(args: string[]) {
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const url = new URL(args[args.length - 1]);
  return {
    args, url, method: args[args.indexOf('-X') + 1], route: url.pathname,
    body: bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : undefined,
    headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '',
  };
}

/** The answer the recorded site gives to a call: [status, body]. */
function recorded(c: ReturnType<typeof readCurl>): [number, unknown] {
  const r = c.route;
  if (c.method === 'GET') {
    if (r === '/api/user') return [200, fixture('me')];
    if (r === `/api/users/${MEMBER}/boards`) return [200, fixture('boards')];
    if (r === `/api/boards/${BOARD}/export`) {
      const card = c.url.searchParams.get('cardId');
      if (!card) return [200, fixture('export-list')];
      return CARDS[card] ? [200, fixture(CARDS[card])] : [200, { ...fixture('export-card-1'), cards: [], comments: [], activities: [] }];
    }
    if (r === `/api/boards/${BOARD}/lists`) return [200, fixture('lists')];
    const list = /^\/api\/boards\/[A-Za-z0-9]+\/lists\/([A-Za-z0-9]+)$/.exec(r);
    if (list && LISTS[list[1]]) return [200, fixture(LISTS[list[1]])];
    return [404, { error: 'Not found' }];
  }
  if (c.method === 'POST' && /\/lists\/[A-Za-z0-9]+\/cards$/.test(r)) return [200, { _id: 'NewCard1234567890' }];
  if (c.method === 'POST' && /\/comments$/.test(r)) return [200, { _id: 'Comment1234567890' }];
  if (c.method === 'POST' && r === `/api/boards/${BOARD}/cards/labels`) return [200, { updated: [], notFound: [] }];
  if (['POST', 'PUT'].includes(c.method)) return [200, { _id: r.split('/').pop() }];
  return [405, { error: 'Method not allowed' }];
}

/** A provider over the recordings, with what each call asked. */
function provider(settings: Record<string, unknown> = SETTINGS, answer = recorded) {
  const calls: ReturnType<typeof readCurl>[] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wekan-tracker-'));
  made.push(home);
  const api: any = {
    name: 'wekan',
    settings: { read: () => settings, file: 'core/config/plugin.wekan.settings.yml' },
    lib: {
      run: async (cmd: string, args: string[]) => {
        assert.strictEqual(cmd, 'curl');
        const c = readCurl(args);
        calls.push(c);
        const [status, body] = answer(c);
        return { ok: true, code: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: '' };
      },
      cliError: (s: string) => s,
    },
  };
  return { p: wekanTracker(api), calls };
}

test('roles, lists, states, times, texts and ids, as Wekan gives them', () => {
  assert.deepStrictEqual([
    { isAdmin: true, isActive: true }, { isActive: true }, { isNoComments: true }, { isNormalAssignedOnly: true }, { isWorker: true },
    { isReadOnly: true }, { isReadAssignedOnly: true }, { isCommentOnly: true }, { isCommentAssignedOnly: true }, { isAdmin: true, isActive: false }, undefined,
  ].map(roleAssociation), ['owner', 'member', 'member', 'member', 'member', 'outside', 'outside', 'outside', 'outside', 'outside', 'outside']);
  const lists = listsOf(fixture('export-list'));
  assert.deepStrictEqual(lists.map((l) => l.title), ['To Do', 'Doing', 'Done'], 'lists made through REST have no place: in the order they were made');
  assert.deepStrictEqual(lists.map((l) => l.sort), [null, null, null]);
  assert.deepStrictEqual(inOrder([listFrom({ _id: 'b', title: 'B', sort: 1, createdAt: '2026-01-01' }), listFrom({ _id: 'a', title: 'A', sort: 0, createdAt: '2026-02-01' }), listFrom({ _id: 'n', title: 'N', createdAt: '2026-03-01' })]).map((l) => l.id), ['n', 'a', 'b'], 'by place, one with none first, as Wekan\'s database orders them');
  assert.deepStrictEqual(['To Do', 'Doing', 'Done'].map((t) => stateClassOf({ listId: LIST[t] }, lists)), ['open', 'doing', 'done']);
  assert.strictEqual(stateClassOf({ listId: LIST['To Do'], archived: true }, lists), 'done', 'archived is done, wherever it is');
  assert.strictEqual(stateClassOf({ listId: 'elsewhere' }, lists), undefined);
  assert.strictEqual(isoOf('2026-11-26T07:11:53.556Z'), '2026-11-26T07:11:53.556Z');
  assert.strictEqual(isoOf({ $date: 1795676256000 }), '2026-11-26T06:57:36Z');
  assert.strictEqual(isoOf(''), undefined);
  assert.strictEqual(textOf('raw &amp; `x` &lt;b&gt; &quot;q&quot; &#39;s&#x27;'), 'raw & `x` <b> "q" \'s\'');
  assert.strictEqual(textOf('&amp;lt;'), '&lt;', 'an entity is read once');
  for (const id of Object.keys(CARDS)) assert.ok(ITEM_RE.test(id), id);
  for (const id of ['12', '#12', 'WEB-12', 'abc', `${Object.keys(CARDS)[0]}x`, 'Webship site']) assert.strictEqual(ITEM_RE.test(id), false, id);
  assert.ok(TOKEN_RE.test(TOKEN), 'a Wekan login token');
  assert.ok(TOKEN_RE.test(`token=${'PWIB3eRqyfQ2LqtofJW2RF6lPaeG0-5gGbDyQFyb-pQ'} `), 'in a line of text');
  assert.strictEqual(TOKEN_RE.test('the_quick_brown_fox_jumps_over_the_lazy_dog'), false, 'words are no token');
  assert.strictEqual(TOKEN_RE.test('0123456789abcdef0123456789abcdef01234567'), false, 'a commit is no token');
  assert.strictEqual(TOKEN_RE.test('A'.repeat(44)), false, 'too long');
  assert.deepStrictEqual([...labelsOf({ labels: [{ _id: 'a', name: 'bug' }, { _id: 'b', name: '', color: 'green' }] }).values()], ['bug'], 'a colour-only label has no name to show');
  assert.strictEqual(peopleOf(fixture('export-list')).get(OWNER), 'Owner Test');
  assert.strictEqual(saidOf({ error: 'Forbidden' }), 'Forbidden');
  assert.strictEqual(saidOf({ error: 'login-failed', reason: 'Incorrect username, email address or password.' }), 'Incorrect username, email address or password.');
  assert.strictEqual(saidOf(null), '');
});

test('the last editor is the newest change of the title or the description that Wekan recorded', () => {
  assert.strictEqual(lastEditOf(fixture('export-card-1').activities, ID['1']), '', 'the sample cards were made, labelled and commented on, never edited');
  const edits = [
    { activityType: 'a-changedTitle', userId: MEMBER, cardId: ID['2'], createdAt: '2026-11-26T08:00:00.000Z' },
    { activityType: 'a-changedDescription', userId: OWNER, cardId: ID['2'], createdAt: '2026-11-26T09:00:00.000Z' },
    { activityType: 'moveCard', userId: READER, cardId: ID['2'], createdAt: '2026-11-26T10:00:00.000Z' },
  ];
  assert.strictEqual(lastEditOf(edits, ID['2']), OWNER, 'the newest edit; a move is not an edit');
  assert.strictEqual(lastEditOf(edits, ID['1']), '', 'another card\'s edits are not its own');
});

test('the provider: ready, its scope, its capabilities and the address of a card', async () => {
  const { p } = provider();
  assert.strictEqual(p.ready(), '');
  assert.match(provider({ username: 'member', token: TOKEN }).p.ready(), /no Wekan address/);
  assert.match(provider({ url: 'https://wekan.test', token: TOKEN }).p.ready(), /no username/);
  assert.match(provider({ url: 'https://wekan.test', username: 'member', token: 'CHANGE_ME' }).p.ready(), /no login token/);
  assert.deepStrictEqual(p.parseScope('Webship site'), SCOPE);
  assert.strictEqual(p.parseScope('bad\u0007name'), null);
  assert.deepStrictEqual(p.capabilities, { views: ['open', 'mine', 'assigned', 'query'], comment: true, worklog: false, transition: true, labels: true, assign: true, create: true, request: 'none' });
  assert.strictEqual(p.worklog, undefined, 'no worklog: Wekan\'s REST API has no route for time entries');
  assert.strictEqual(p.urlOf(SCOPE, ID['1']), `https://wekan.test/b/board/board/${ID['1']}`, 'before the board is read: Wekan sends a card\'s address on to its own board');
  assert.deepStrictEqual(await p.scopes!(), [{ id: 'Webship site', name: 'Webship site', web: `https://wekan.test/b/${BOARD}/board` }]);
  assert.strictEqual(await p.account!(), 'Member Test');
  await p.list(SCOPE, { view: 'open', limit: 5 });
  assert.strictEqual(p.urlOf(SCOPE, ID['1']), `https://wekan.test/b/${BOARD}/webship-site/${ID['1']}`, 'the board\'s own address, once read');
});

test('the views: open, mine, someone\'s and a search; a card\'s state is its list', async () => {
  const { p, calls } = provider();
  const open = await p.list(SCOPE, { view: 'open', limit: 20 });
  assert.deepStrictEqual(open.map((i) => `${i.title} | ${i.state} ${i.stateClass}`).sort(), [
    'Add a test for the greeting | Done done',
    'The greeting script says Helo instead of Hello | Doing doing',
    'The usage line spells greeting as greting | To Do open',
  ]);
  const greeting = open.find((i) => i.id === ID['1'])!;
  assert.deepStrictEqual({ ...greeting, updated: undefined }, {
    id: ID['1'], title: 'The greeting script says Helo instead of Hello', url: `https://wekan.test/b/${BOARD}/webship-site/${ID['1']}`,
    state: 'Doing', stateClass: 'doing', assignees: ['Member Test'], labels: ['bug'], column: 'Doing', updated: undefined,
  });
  assert.match(String(greeting.updated), /^2026-11-26T\d\d:\d\d:\d\d(\.\d+)?Z$/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'mine', limit: 20 })).map((i) => i.id), [ID['1']], 'member is the greeting\'s assignee');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'Member Test', limit: 20 })).map((i) => i.id), [ID['1']]);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'owner', limit: 20 })).map((i) => i.id), [], 'owner is on no card');
  assert.deepStrictEqual(await p.list(SCOPE, { view: 'assigned', limit: 20 }), []);
  await assert.rejects(p.list(SCOPE, { view: 'assigned', who: 'Stranger Test', limit: 20 }), /Stranger Test is not a member of Webship site/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'query', text: 'GRETING', limit: 20 })).map((i) => i.id), [ID['2']]);
  assert.strictEqual((await p.list(SCOPE, { view: 'open', limit: 1 })).length, 1, 'the limit');
  const exports = calls.filter((c) => c.route === `/api/boards/${BOARD}/export` && !c.url.searchParams.get('cardId'));
  assert.ok(exports.every((c) => c.url.searchParams.get('archived') === 'false' && c.url.searchParams.get('attachments') === 'false'), 'the open cards, no attachments');
  // The token travels in a header file, never on curl's command line.
  assert.ok(calls.every((c) => c.headers.includes(`Authorization: Bearer ${TOKEN}`) && !c.args.join(' ').includes(TOKEN)));
  await assert.rejects(p.list({ id: 'No such board', name: 'No such board', web: '' }, { view: 'open', limit: 5 }), /no board "No such board" the account of the token is on/);
});

test('one card: its author and each comment\'s author by their role in the board, its lists in their order', async () => {
  const { p } = provider();
  const greeting = await p.get(SCOPE, ID['1']);
  assert.deepStrictEqual(greeting.author, { name: 'Owner Test', association: 'owner' }, 'the board\'s administrator');
  assert.strictEqual(greeting.lastEditor, undefined, 'never edited');
  assert.strictEqual(greeting.body, '`greeting.sh` prints *Helo* where it should print *Hello*.', 'Wekan keeps Markdown');
  assert.deepStrictEqual([greeting.state, greeting.stateClass, greeting.labels, greeting.assignees], ['Doing', 'doing', ['bug'], ['Member Test']]);
  assert.deepStrictEqual(greeting.comments.map((c) => [c.author, c.body]), [[{ name: 'Owner Test', association: 'owner' }, 'Seen on the test site: the greeting prints Helo.']]);
  assert.match(greeting.comments[0].at, /^2026-11-26T/);
  assert.deepStrictEqual((await p.get(SCOPE, ID['2'])).author, { name: 'Member Test', association: 'member' });
  const done = await p.get(SCOPE, ID['3']);
  assert.deepStrictEqual([done.state, done.stateClass, done.column], ['Done', 'done', 'Done'], 'its list among all the board\'s, not only its own');
  // A member the board has as read-only now is outside; an edit by another person is the last edit.
  const changed = (c: ReturnType<typeof readCurl>): [number, unknown] => {
    if (c.route === `/api/boards/${BOARD}/export` && c.url.searchParams.get('cardId') === ID['2']) {
      const ex = fixture('export-card-2');
      ex.members = ex.members.map((m: any) => (m.userId === MEMBER ? { ...m, isReadOnly: true } : m));
      ex.activities = [{ activityType: 'a-changedDescription', userId: OWNER, cardId: ID['2'], createdAt: '2026-11-26T12:00:00.000Z' }, ...ex.activities];
      return [200, ex];
    }
    return recorded(c);
  };
  const usage = await provider(SETTINGS, changed).p.get(SCOPE, ID['2']);
  assert.deepStrictEqual([usage.author, usage.lastEditor], [{ name: 'Member Test', association: 'outside' }, { name: 'Owner Test', association: 'owner' }]);
  await assert.rejects(p.get(SCOPE, 'XXXXXXXXXXXXXXXXX'), /XXXXXXXXXXXXXXXXX is not a card of Webship site/);
  await assert.rejects(p.get(SCOPE, '12'), /not a card: 12/);
});

test('the writes: a comment, a move to another list, archiving and restoring, labels, an assignee and a new card, as the person', async () => {
  const { p, calls } = provider();
  const last = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.route)).pop()!;
  const url = `https://wekan.test/b/${BOARD}/webship-site/${ID['1']}`;
  const comment = await p.comment!(SCOPE, ID['1'], 'Fixed in `greeting.sh` <b>now</b>');
  assert.deepStrictEqual([comment.ok, comment.url], [true, url]);
  assert.deepStrictEqual(last('POST', /\/comments$/).body, { authorId: MEMBER, comment: 'Fixed in `greeting.sh` <b>now</b>' }, 'Markdown, as Wekan keeps it');
  assert.strictEqual(last('POST', /\/comments$/).route, `/api/boards/${BOARD}/cards/${ID['1']}/comments`);
  assert.deepStrictEqual((await p.transitions!(SCOPE, ID['1'])).map((t) => `${t.id}=${t.name}`), [`list:${LIST['To Do']}=Move to To Do`, `list:${LIST.Done}=Move to Done`, 'archive=Move the card to the archive'], 'the other lists, and archiving');
  assert.strictEqual((await p.transition!(SCOPE, ID['1'], `list:${LIST.Done}`)).ok, true);
  const move = last('PUT', /\/cards\//);
  assert.deepStrictEqual([move.route, move.body], [`/api/boards/${BOARD}/lists/${LIST.Doing}/cards/${ID['1']}`, { listId: LIST.Done }]);
  assert.match((await p.transition!(SCOPE, ID['1'], 'list:XXXXXXXXXXXXXXXXX')).error, /not a list of Webship site: list:XXXXXXXXXXXXXXXXX/);
  assert.match((await p.transition!(SCOPE, ID['1'], `list:${LIST.Doing}`)).error, /is in that list already/);
  assert.strictEqual((await p.transition!(SCOPE, ID['1'], 'archive')).ok, true);
  assert.strictEqual(last('POST', /\/archive$/).route, `/api/boards/${BOARD}/lists/${LIST.Doing}/cards/${ID['1']}/archive`);
  assert.match((await p.transition!(SCOPE, ID['1'], 'restore')).error, /is not archived/);
  const archived = (c: ReturnType<typeof readCurl>): [number, unknown] => {
    if (c.url.searchParams.get('cardId') === ID['2']) {
      const ex = fixture('export-card-2');
      ex.cards = ex.cards.map((card: any) => ({ ...card, archived: true }));
      return [200, ex];
    }
    return recorded(c);
  };
  const a = provider(SETTINGS, archived);
  assert.deepStrictEqual((await a.p.transitions!(SCOPE, ID['2'])).map((t) => t.id), ['restore'], 'an archived card is restored first');
  assert.strictEqual((await a.p.transition!(SCOPE, ID['2'], 'restore')).ok, true);
  assert.match(a.calls.filter((c) => c.method === 'POST').pop()!.route, /\/unarchive$/);
  assert.match((await a.p.transition!(SCOPE, ID['2'], `list:${LIST.Done}`)).error, /is archived: restore it before it moves to another list/);
  assert.match((await a.p.comment!(SCOPE, ID['2'], 'x')).error, /is archived: restore it before it takes a comment/);
  assert.strictEqual((await p.labels!(SCOPE, ID['2'], ['BUG'], [])).ok, true);
  assert.deepStrictEqual(last('POST', /\/cards\/labels$/).body, { cardIds: [ID['2']], addLabelIds: ['hTNWZG'], removeLabelIds: [] }, 'the board\'s label, whatever its case');
  assert.strictEqual((await p.labels!(SCOPE, ID['1'], [], ['bug'])).ok, true);
  assert.deepStrictEqual(last('POST', /\/cards\/labels$/).body, { cardIds: [ID['1']], addLabelIds: [], removeLabelIds: ['hTNWZG'] });
  const before = calls.length;
  assert.strictEqual((await p.labels!(SCOPE, ID['1'], ['bug'], [])).ok, true, 'a label the card has already');
  assert.ok(!calls.slice(before).some((c) => c.method === 'POST'), 'nothing to write');
  assert.match((await p.labels!(SCOPE, ID['1'], ['docs'], [])).error, /Webship site has no label "docs": Wekan's labels are the board's, made by its administrator/);
  assert.strictEqual((await p.assign!(SCOPE, ID['2'], 'me')).ok, true);
  assert.strictEqual(last('POST', /\/assignees\//).route, `/api/boards/${BOARD}/lists/${LIST['To Do']}/cards/${ID['2']}/assignees/${MEMBER}`);
  assert.strictEqual((await p.assign!(SCOPE, ID['2'], 'Owner Test')).ok, true);
  assert.match(last('POST', /\/assignees\//).route, new RegExp(`/assignees/${OWNER}$`));
  assert.strictEqual((await p.assign!(SCOPE, ID['2'], 'reader')).ok, true, 'by username; Wekan lets a read-only member be assigned');
  assert.match((await p.assign!(SCOPE, ID['2'], 'Stranger Test')).error, /Stranger Test is not a member of Webship site/);
  const fresh = await p.create!(SCOPE, { title: 'Webship test new', body: 'A **new** one' });
  assert.deepStrictEqual(fresh, { ok: true, error: '', url: 'https://wekan.test/b/7bP5KPvW5YgkGTDAj/webship-site/NewCard1234567890', id: 'NewCard1234567890' });
  const make = last('POST', /\/lists\/[A-Za-z0-9]+\/cards$/);
  assert.deepStrictEqual([make.route, make.body], [`/api/boards/${BOARD}/lists/${LIST['To Do']}/cards`, { title: 'Webship test new', description: 'A **new** one', authorId: MEMBER, swimlaneId: 'hJejGjFNF77jknNMc' }], 'in the board\'s first list, its first swimlane');
  // A refusal of Wekan's is said as it gave it.
  const refused = provider(SETTINGS, (c) => (c.method === 'POST' && /\/comments$/.test(c.route) ? [403, { error: 'Forbidden' }] : recorded(c))).p;
  assert.match((await refused.comment!(SCOPE, ID['1'], 'x')).error, /Wekan refused a comment on the card to this account \(403\)/);
  const expired = provider(SETTINGS, () => [401, { error: 'Unauthorized' }]).p;
  await assert.rejects(expired.list(SCOPE, { view: 'open', limit: 5 }), /Wekan refused the login token \(401\): connect again/);
  assert.ok(calls.every((c) => !c.args.join(' ').includes(TOKEN)), 'the token never on a command line');
});

test('an item of the list is built from a card of the export', () => {
  const lists = listsOf(fixture('export-list'));
  const board = { id: BOARD, title: 'Webship site', slug: 'webship-site' };
  const item = itemOf({ _id: 'Card1234567890123', title: 'T &amp; t', listId: LIST.Doing, assignees: ['nobody'], labelIds: ['hTNWZG', 'gone'], modifiedAt: '' }, 'https://wekan.test', board, lists, new Map(), labelsOf(fixture('export-list')));
  assert.deepStrictEqual(item, { id: 'Card1234567890123', title: 'T & t', url: `https://wekan.test/b/${BOARD}/webship-site/Card1234567890123`, state: 'Doing', stateClass: 'doing', assignees: ['#nobody'], labels: ['bug'], column: 'Doing', updated: undefined });
});
