/**
 * Wekan, as a provider of the tracker family (@webship.co/workspace-tracker): the cards of a Wekan board, over its REST
 * API as a person, with that person's login token (Authorization: Bearer), in a header file, never on a command line.
 * The builder's tool makes the token through Wekan's API (--connect <login>); on your own Wekan, POST /users/login.
 *
 * A scope is a board, by its title ("Webship site"); an item is a card, by its id (17 letters and digits): the same on
 * the whole site, and the last part of the card's address.
 *
 * Reads: the open cards (the ones not archived), mine (as Wekan's own My Cards: the cards the person is a member or an
 * assignee of), someone's, and a search in the title; one card with its comments. A card's state is its list (To Do,
 * Doing and Done in the sample board), and "Archived" once it is archived. A board is read through Wekan's own export
 * of it, narrowed to what is needed: its open cards with their labels and people, or one card with its comments and
 * activities, beside the board's lists in their order.
 *
 * Each author's standing is their role in the board: its administrators are owners of it; its normal members (and the
 * ones who may not comment, the ones who change only the cards they are on, and the workers) are members; a read-only
 * or a comment-only member, someone no longer active in the board, and someone it does not have are outside, so the
 * base keeps their cards analyze-only unless a person confirms by name. The last editor is the person of the newest
 * change of the card's title or description that Wekan recorded (its own screens record one; a change through its REST
 * API does not), when not the card's creator.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a move to another list
 * (or archiving and restoring the card), the board's labels, an assignee among the board's members, and a new card in
 * the board's first list. No worklog and no iteration: Wekan's REST API has no route for time entries or sprints (its
 * own screens use internal methods for both, which the provider does not rely on), and writing a card's spent time
 * through REST would skip Wekan's own record of the days. Wekan keeps Markdown and drops raw HTML. Wekan is not a forge:
 * the pull request of the work is opened from the project's forge menu. A Wekan login token is 43 letters, digits, "-"
 * and "_"; the base refuses that shape, and the provider's own token, in whatever is about to be posted.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerComment, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A card: its id, as Wekan makes them (17 letters and digits). */
export const ITEM_RE = /^([A-Za-z0-9]{17})$/;
/** A board's title, as a scope. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;
/** What a Wekan login token looks like: 43 letters, digits, "-" and "_", with a digit, a capital and a small letter. */
export const TOKEN_RE = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
/** How long the account and a board's id are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** Lists are read a few at a time: so many at once. */
const AT_ONCE = 8;
/** The parts of a board's export that a list needs, and that one card needs. */
const LIST_EXPORT = 'archived=false&attachments=false&fields=board-header,labels,people,dates';
const CARD_EXPORT = 'attachments=false&fields=board-header,activities,labels,people,description,comments,dates';

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** A member of the board, as the base reads an author's standing. */
export function roleAssociation(member: any): Person['association'] {
  if (!member || member.isActive === false) return 'outside';
  if (member.isAdmin === true) return 'owner';
  if (member.isReadOnly || member.isReadAssignedOnly || member.isCommentOnly || member.isCommentAssignedOnly) return 'outside';
  return 'member';
}

export interface List { id: string; title: string; sort: number | null; created: string }

/** A list of Wekan's, as the provider keeps it: a list made through Wekan's REST API has no place until its board is shown. */
export function listFrom(l: any): List {
  const sort = Number(l && l.sort);
  return { id: String(l._id), title: String(l.title || ''), sort: l && l.sort !== undefined && l.sort !== null && Number.isFinite(sort) ? sort : null, created: String(isoOf(l && l.createdAt) || '') };
}

/** Lists in their order on the board, as Wekan's database orders them: by their place (one with none first), then as they were made. */
export function inOrder(lists: List[]): List[] {
  return lists.slice().sort((a, b) => (a.sort === b.sort ? 0 : a.sort === null ? -1 : b.sort === null ? 1 : a.sort - b.sort) || a.created.localeCompare(b.created));
}

/** The board's lists that are not archived, in their order on the board. */
export function listsOf(exported: any): List[] {
  return inOrder((Array.isArray(exported && exported.lists) ? exported.lists : [])
    .filter((l: any) => l && l._id && l.archived !== true)
    .map(listFrom));
}

/** How a card's state reads: archived, or in the last list, is done; in the first list open; in between, work going on. */
export function stateClassOf(card: any, lists: List[]): TrackerItem['stateClass'] {
  if (card && card.archived === true) return 'done';
  const at = lists.findIndex((l) => l.id === String(card && card.listId));
  if (at < 0) return undefined;
  if (at === lists.length - 1) return 'done';
  return at === 0 ? 'open' : 'doing';
}

/** The people of an export: their names (full name, else username) by id. */
export function peopleOf(exported: any): Map<string, string> {
  return new Map((Array.isArray(exported && exported.users) ? exported.users : [])
    .filter((u: any) => u && u._id)
    .map((u: any) => [String(u._id), String((u.profile && u.profile.fullname) || u.username || '')] as [string, string]));
}

/** The usernames of an export, by id. */
export function usernamesOf(exported: any): Map<string, string> {
  return new Map((Array.isArray(exported && exported.users) ? exported.users : [])
    .filter((u: any) => u && u._id)
    .map((u: any) => [String(u._id), String(u.username || '')] as [string, string]));
}

/** An ISO time, from Wekan's own (a string, or EJSON's { $date }). */
export function isoOf(value: unknown): string | undefined {
  const v: any = value && typeof value === 'object' && '$date' in (value as any) ? (value as any).$date : value;
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.000Z$/, 'Z');
}

export interface Board { id: string; title: string; slug: string }

/** A card of the export, as the base reads an item. */
export function itemOf(card: any, base: string, board: Board, lists: List[], people: Map<string, string>, labels: Map<string, string>): TrackerItem {
  const list = lists.find((l) => l.id === String(card.listId));
  const archived = card.archived === true;
  return {
    id: String(card._id),
    title: textOf(card.title),
    url: `${base}/b/${board.id}/${board.slug || 'board'}/${card._id}`,
    state: archived ? 'Archived' : (list ? list.title : String(card.listId || '')),
    stateClass: stateClassOf(card, lists),
    assignees: (Array.isArray(card.assignees) ? card.assignees : []).map((id: unknown) => people.get(String(id)) || `#${id}`),
    labels: (Array.isArray(card.labelIds) ? card.labelIds : []).map((id: unknown) => labels.get(String(id)) || '').filter(Boolean).sort(),
    ...(list ? { column: list.title } : {}),
    updated: isoOf(card.dateLastActivity || card.modifiedAt),
  };
}

/** The board's labels that have a name: their names by id. Wekan's colour-only labels are left out. */
export function labelsOf(exported: any): Map<string, string> {
  return new Map((Array.isArray(exported && exported.labels) ? exported.labels : [])
    .filter((l: any) => l && l._id && String(l.name || '').trim())
    .map((l: any) => [String(l._id), String(l.name).trim()] as [string, string]));
}

/** The newest change of a card's title or description that Wekan recorded: who made it. */
export function lastEditOf(activities: any[], cardId: string): string {
  const edits = (Array.isArray(activities) ? activities : [])
    .filter((a) => a && String(a.cardId) === cardId && (a.activityType === 'a-changedTitle' || a.activityType === 'a-changedDescription'))
    .sort((a, b) => String(isoOf(b.createdAt) || '').localeCompare(String(isoOf(a.createdAt) || '')));
  return edits.length ? String(edits[0].userId || '') : '';
}

/**
 * Text as Wekan shows it: Wekan keeps a card's description and its comments with raw HTML dropped and some characters
 * as HTML entities ("&amp;"), which its own screens show as the characters. The dashboard escapes what it shows.
 */
export function textOf(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/g, '&');
}

/** What an answer of Wekan says went wrong, in one line. */
export function saidOf(data: any): string {
  if (!data || typeof data !== 'object') return '';
  return String(data.reason || data.error || data.message || '').replace(/\s+/g, ' ').slice(0, 300);
}

export function wekanTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const username = () => configured(settings().username);
  const token = () => configured(settings().token);

  // Who is asking: the site, the account and its token, so that what is kept follows a change of any of them.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${username()}\n${token()}`).digest('hex').slice(0, 12);

  /** One call of the REST API: the token and the body in files only this user reads, removed after. */
  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', route: string, what: string, body?: unknown): Promise<any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-wekan-'));
    try {
      const h = path.join(dir, 'headers');
      fs.writeFileSync(h, `Authorization: Bearer ${token()}\nAccept: application/json\nContent-Type: application/json\n`, { mode: 0o600 });
      const args = ['-sS', '-m', '30', '-X', method, '-w', '\n%{http_code}', '-H', `@${h}`];
      if (body !== undefined) {
        const b = path.join(dir, 'body.json');
        fs.writeFileSync(b, JSON.stringify(body), { mode: 0o600 });
        args.push('--data-binary', `@${b}`);
      }
      args.push(`${base()}${route}`);
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 401) throw new Error(`Wekan refused the login token (${status}): connect again with the site's tool (--connect <login>), or make a new token`);
      if (status === 403) throw new Error(`Wekan refused ${what} to this account (${status})`);
      if (status === 404) throw new Error(`Wekan has no ${what} (${status})`);
      if (status < 200 || status >= 300) throw new Error(`Wekan answered ${status} to ${what}${saidOf(data) ? `: ${saidOf(data)}` : ''}`);
      return data;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async function write(method: 'POST' | 'PUT', route: string, what: string, body: unknown, url: string): Promise<WriteResult & { result?: any }> {
    try {
      const result = await call(method, route, what, body);
      return { ok: true, error: '', url, result };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  // What is kept for five minutes: the token's own account, and the boards it is on.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }
  // The board of each scope seen, for an item's address (urlOf does not ask Wekan).
  const boards = new Map<string, Board>();

  const me = () => keep('me', async () => {
    const u = await call('GET', '/api/user', 'the account of the token');
    return { id: String(u && u._id || ''), username: String(u && u.username || ''), name: String((u && u.profile && u.profile.fullname) || (u && u.username) || '') };
  });
  const boardsOfMe = () => keep('boards', async () => {
    const rows = await call('GET', `/api/users/${(await me()).id}/boards`, 'the boards of the account');
    return (Array.isArray(rows) ? rows : []).filter((b: any) => b && b._id && NAME_RE.test(String(b.title || '')))
      .map((b: any) => ({ id: String(b._id), title: String(b.title) }));
  });
  async function boardOf(scope: TrackerScope): Promise<Board> {
    const hit = (await boardsOfMe()).find((b) => b.title === scope.id) || (ITEM_RE.test(scope.id) ? (await boardsOfMe()).find((b) => b.id === scope.id) : undefined);
    if (!hit) throw new Error(`no board "${scope.id}" the account of the token is on`);
    const known = boards.get(scope.id);
    return known && known.id === hit.id ? known : { id: hit.id, title: hit.title, slug: '' };
  }
  function remember(scope: TrackerScope, board: Board, exported: any) {
    const b = { ...board, slug: String(exported && exported.slug || board.slug || '') };
    boards.set(scope.id, b);
    return b;
  }

  /** A board's export: its open cards with their labels and people, or one card with its comments and activities. */
  async function exportOf(scope: TrackerScope, cardId?: string): Promise<{ board: Board; data: any }> {
    const board = await boardOf(scope);
    const data = await call('GET', `/api/boards/${board.id}/export?${cardId ? `cardId=${cardId}&${CARD_EXPORT}` : LIST_EXPORT}`, cardId ? 'the card' : `the board ${scope.id}`);
    if (!data || typeof data !== 'object' || String(data._id) !== board.id) throw new Error(`Wekan did not answer the board ${scope.id}`);
    return { board: remember(scope, board, data), data };
  }

  /**
   * The board's lists that are not archived, in their order, kept for five minutes: its lists route gives their titles,
   * and each list its place (a card's own export carries only the card's list).
   */
  const listsOfBoard = (scope: TrackerScope) => keep(`lists:${scope.id}`, async () => {
    const board = await boardOf(scope);
    const rows = await call('GET', `/api/boards/${board.id}/lists`, `the lists of ${scope.id}`);
    const ids = (Array.isArray(rows) ? rows : []).filter((l: any) => l && l._id).map((l: any) => String(l._id));
    const lists: List[] = [];
    for (let at = 0; at < ids.length; at += AT_ONCE) {
      const part = await Promise.all(ids.slice(at, at + AT_ONCE).map((lid) => call('GET', `/api/boards/${board.id}/lists/${lid}`, 'a list of the board')));
      for (const l of part) if (l && l._id && l.archived !== true) lists.push(listFrom(l));
    }
    return inOrder(lists);
  });

  /** The card behind an id of the scope (its board checked), with the export it came in. */
  async function cardIn(scope: TrackerScope, id: string): Promise<{ board: Board; data: any; card: any }> {
    const m = ITEM_RE.exec(String(id || '').trim());
    if (!m) throw new Error(`not a card: ${id}`);
    const { board, data } = await exportOf(scope, m[1]);
    const card = (Array.isArray(data.cards) ? data.cards : []).find((c: any) => c && String(c._id) === m[1]);
    if (!card) throw new Error(`${m[1]} is not a card of ${scope.id}`);
    return { board, data, card };
  }

  function personOf(data: any, uid: unknown): Person {
    const id = String(uid || '');
    if (!id) return { name: 'unknown', association: 'unknown' };
    const member = (Array.isArray(data.members) ? data.members : []).find((m: any) => m && String(m.userId) === id);
    return { name: peopleOf(data).get(id) || `#${id}`, association: roleAssociation(member) };
  }

  /** Someone the board has, by what the person typed: "me", their username, their name, or their id. Their id. */
  function memberBy(data: any, mine: string, who: string, scope: TrackerScope): string {
    const w = who.trim().toLowerCase();
    const active = (Array.isArray(data.members) ? data.members : []).filter((m: any) => m && m.isActive !== false).map((m: any) => String(m.userId));
    if (w === 'me') {
      if (!active.includes(mine)) throw new Error(`the account of the token is not a member of ${scope.id}`);
      return mine;
    }
    const names = peopleOf(data);
    const logins = usernamesOf(data);
    const found = active.find((id) => id.toLowerCase() === w.replace(/^#/, '') || (logins.get(id) || '').toLowerCase() === w || (names.get(id) || '').toLowerCase() === w);
    if (!found) throw new Error(`${who} is not a member of ${scope.id}`);
    return found;
  }

  const cardUrl = (scope: TrackerScope | null, id: string) => {
    const b = scope ? boards.get(scope.id) : undefined;
    return `${base()}/b/${b ? b.id : 'board'}/${(b && b.slug) || 'board'}/${String(id)}`;
  };
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });

  async function listOf(scope: TrackerScope, keepIt: (c: any) => boolean, limit: number): Promise<TrackerItem[]> {
    const { board, data } = await exportOf(scope);
    const lists = listsOf(data);
    const people = peopleOf(data);
    const labels = labelsOf(data);
    return (Array.isArray(data.cards) ? data.cards : [])
      .filter((c: any) => c && c._id && c.archived !== true && (!c.type || c.type === 'cardType-card') && keepIt(c))
      .sort((a: any, b: any) => String(isoOf(b.dateLastActivity || b.modifiedAt) || '').localeCompare(String(isoOf(a.dateLastActivity || a.modifiedAt) || '')))
      .slice(0, limit)
      .map((c: any) => itemOf(c, base(), board, lists, people, labels));
  }
  const ofPerson = (uid: string) => (c: any) => (Array.isArray(c.members) && c.members.map(String).includes(uid)) || (Array.isArray(c.assignees) && c.assignees.map(String).includes(uid));

  return {
    id: api.name,
    title: 'Wekan',
    label: 'WEKAN',
    noun: { one: 'card', many: 'cards' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'query'],
      comment: true, worklog: false, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['WEKAN_TOKEN', 'WEKAN_LOGIN_TOKEN'],
    secret: () => token(),
    tokenShapes: [['a Wekan login token', TOKEN_RE]],
    ready: () => (!base() ? `no Wekan address in ${api.settings.file} (url)`
      : !username() ? `no username in ${api.settings.file} (username)`
        : !token() ? `no login token in ${api.settings.file} (token)` : ''),
    // A workspace project has no Wekan board of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim();
      return NAME_RE.test(t) && base() ? { id: t, name: t, web: `${base()}/` } : null;
    },
    urlOf: (scope, id) => cardUrl(scope, id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The boards the token's account is on.
    scopes: async () => (await boardsOfMe()).map((b) => ({ id: b.title, name: b.title, web: `${base()}/b/${b.id}/board` })),

    list: async (scope, q) => {
      const limit = Math.max(1, Math.min(q.limit, 100));
      if (q.view === 'mine') return listOf(scope, ofPerson((await me()).id), limit);
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const { data } = await exportOf(scope);
        const uid = memberBy(data, (await me()).id, q.who, scope);
        return listOf(scope, ofPerson(uid), limit);
      }
      if (q.view === 'query') {
        const words = String(q.text || '').trim().toLowerCase();
        return listOf(scope, (c) => String(c.title || '').toLowerCase().includes(words), limit);
      }
      return listOf(scope, () => true, limit);
    },

    get: async (scope, id) => {
      const { board, data, card } = await cardIn(scope, id);
      const lists = await listsOfBoard(scope);
      const author = personOf(data, card.userId);
      const editor = lastEditOf(data.activities, String(card._id));
      const lastEditor = editor && editor !== String(card.userId || '') ? personOf(data, editor) : undefined;
      const comments: TrackerComment[] = (Array.isArray(data.comments) ? data.comments : [])
        .filter((c: any) => c && String(c.cardId) === String(card._id) && textOf(c.text).trim())
        .sort((a: any, b: any) => String(isoOf(a.createdAt) || '').localeCompare(String(isoOf(b.createdAt) || '')))
        .map((c: any) => ({ author: personOf(data, c.userId), body: textOf(c.text).trim(), at: isoOf(c.createdAt) || '' }));
      const full: TrackerItemFull = {
        ...itemOf(card, base(), board, lists, peopleOf(data), labelsOf(data)),
        body: textOf(card.description), author, ...(lastEditor ? { lastEditor } : {}), comments,
      };
      return full;
    },

    comment: async (scope, id, markdown) => {
      try {
        const { board, card } = await cardIn(scope, id);
        if (card.archived === true) return { ok: false, error: `${card._id} is archived: restore it before it takes a comment` };
        return await write('POST', `/api/boards/${board.id}/cards/${card._id}/comments`, 'a comment on the card', { authorId: (await me()).id, comment: String(markdown || '') }, cardUrl(scope, String(card._id)));
      } catch (e) { return failed(e); }
    },
    transitions: async (scope, id) => {
      const { card } = await cardIn(scope, id);
      if (card.archived === true) return [{ id: 'restore', name: 'Restore the card from the archive' }];
      const moves = (await listsOfBoard(scope)).filter((l) => l.id !== String(card.listId)).map((l) => ({ id: `list:${l.id}`, name: `Move to ${l.title}` }));
      return [...moves, { id: 'archive', name: 'Move the card to the archive' }];
    },
    transition: async (scope, id, to) => {
      try {
        const { board, card } = await cardIn(scope, id);
        const url = cardUrl(scope, String(card._id));
        const at = `/api/boards/${board.id}/lists/${card.listId}/cards/${card._id}`;
        if (to === 'archive') {
          if (card.archived === true) return { ok: false, error: `${card._id} is archived already` };
          return await write('POST', `${at}/archive`, 'archiving the card', {}, url);
        }
        if (to === 'restore') {
          if (card.archived !== true) return { ok: false, error: `${card._id} is not archived` };
          return await write('POST', `${at}/unarchive`, 'restoring the card', {}, url);
        }
        const list = /^list:([A-Za-z0-9]{1,40})$/.exec(String(to));
        if (!list || !(await listsOfBoard(scope)).some((l) => l.id === list[1])) return { ok: false, error: `not a list of ${scope.id}: ${to}` };
        if (card.archived === true) return { ok: false, error: `${card._id} is archived: restore it before it moves to another list` };
        if (list[1] === String(card.listId)) return { ok: false, error: `${card._id} is in that list already` };
        return await write('PUT', at, 'moving the card', { listId: list[1] }, url);
      } catch (e) { return failed(e); }
    },
    // The board's own labels, by name: a name the board has no label for is refused (its administrator makes labels).
    labels: async (scope, id, add, remove) => {
      try {
        const { board, data, card } = await cardIn(scope, id);
        const byName = new Map([...labelsOf(data).entries()].map(([lid, name]) => [name.toLowerCase(), lid] as [string, string]));
        const unknown = [...add, ...remove].map((n) => n.trim()).filter((n) => n && !byName.has(n.toLowerCase()));
        if (unknown.length) return { ok: false, error: `${scope.id} has no label ${unknown.map((n) => `"${n}"`).join(', ')}: Wekan's labels are the board's, made by its administrator` };
        const have = new Set((Array.isArray(card.labelIds) ? card.labelIds : []).map(String));
        const addIds = [...new Set(add.map((n) => byName.get(n.trim().toLowerCase()) as string).filter((lid) => lid && !have.has(lid)))];
        const removeIds = [...new Set(remove.map((n) => byName.get(n.trim().toLowerCase()) as string).filter((lid) => lid && have.has(lid)))];
        if (!addIds.length && !removeIds.length) return { ok: true, error: '', url: cardUrl(scope, String(card._id)) };
        return await write('POST', `/api/boards/${board.id}/cards/labels`, 'the labels of the card', { cardIds: [String(card._id)], addLabelIds: addIds, removeLabelIds: removeIds }, cardUrl(scope, String(card._id)));
      } catch (e) { return failed(e); }
    },
    assign: async (scope, id, who) => {
      try {
        const { board, data, card } = await cardIn(scope, id);
        const uid = memberBy(data, (await me()).id, who, scope);
        if ((Array.isArray(card.assignees) ? card.assignees.map(String) : []).includes(uid)) return { ok: true, error: '', url: cardUrl(scope, String(card._id)) };
        return await write('POST', `/api/boards/${board.id}/lists/${card.listId}/cards/${card._id}/assignees/${uid}`, 'an assignee of the card', {}, cardUrl(scope, String(card._id)));
      } catch (e) { return failed(e); }
    },
    create: async (scope, item) => {
      try {
        const { board, data } = await exportOf(scope);
        const first = listsOf(data)[0];
        if (!first) return { ok: false, error: `${scope.id} has no list to put a card in` };
        const lanes = (Array.isArray(data.swimlanes) ? data.swimlanes : []).filter((s: any) => s && s._id && s.archived !== true)
          .sort((a: any, b: any) => Number(a.sort || 0) - Number(b.sort || 0));
        if (!lanes.length) return { ok: false, error: `${scope.id} has no swimlane to put a card in` };
        const r = await write('POST', `/api/boards/${board.id}/lists/${first.id}/cards`, 'a new card', { title: String(item.title || ''), description: String(item.body || ''), authorId: (await me()).id, swimlaneId: String(lanes[0]._id) }, '');
        if (!r.ok) return r;
        const cid = r.result && ITEM_RE.test(String(r.result._id || '')) ? String(r.result._id) : '';
        return cid ? { ok: true, error: '', url: cardUrl(scope, cid), id: cid } : { ok: false, error: 'Wekan made no card (it answered no id)' };
      } catch (e) { return failed(e); }
    },
  };
}
