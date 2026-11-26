# @webship.co/workspace-wekan

Wekan, the open-source kanban board, for the [Webship Workspace](https://github.com/webship/workspace), a
container-based workspace (DDEV by default). The plugin brings:

- **a builder**, `cmd-wekan-project.sh`: a real Wekan site from Wekan's own image on the project's own MongoDB 7, on
  DDEV, with the workspace account as Wekan's first account and administrator, the default accounts in their roles of
  a sample board, and its cards in the board's lists, a label, an assignee, a comment, a checklist, Scrum planning
  with an active sprint, and a day of logged time;
- **a tool**, `cmd-tools-wekan-cli.sh`: what a site is and its accounts, the default accounts, the sample content, a
  clean-up after a stopped test run, and the dashboard's connection;
- **the step pack** [`@webship-js/wekan-steps`](https://github.com/webship/wekan-steps) wired into the workspace's
  testing setup, with a first feature for a site;
- **the cards as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): the WEKAN menu on a project row
  lists them, reads one, analyzes it, and lets the workspace's AI CLI work it on a branch, with a person in charge;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-wekan
bash core/scripts/plugins.sh --activate wekan --with-needs
bash core/scripts/plugins.sh --install wekan --with-needs
bash core/scripts/plugins.sh --configure wekan
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- DDEV, the container runtime Wekan is proven on so far. Docker Compose, Podman and Kubernetes are not proven for it
  yet: asked for one, the builder says so and changes nothing.
- A download of about 600 MB for the two images the first time, and memory: the builder asks for 1.5 GB free before
  it starts (`free -m`).

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-wekan-project.sh mysite --install --add-users --sample-content
```

| Flag | What it does |
| --- | --- |
| `--install` | Makes the workspace account (`account` of `core/config/settings.yml`) Wekan's first account, which Wekan makes its administrator, and turns the sign-up off. Wekan's own forms ask a new password of at least eight characters |
| `--add-users` | With `--install`: the default accounts, in their roles of the board Webship site |
| `--sample-content` | With `--install --add-users`: three cards of Webship site in its lists, a label, an assignee, a comment, a checklist, Scrum planning with Sprint 1 active, and half an hour of logged time |
| `--release <X.Y>` | The release of Wekan's image (tagged `v<X.Y>`): 13.33 by default |
| `--runtime ddev` | DDEV, the runtime proven for Wekan so far (the default, or `container.runtime` of `settings.yml`) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database and its files. Wekan's own image is a service of a
generic project, at `https://mysite.ddev.site`, beside the project's own MongoDB service. MongoDB's data and what Wekan
keeps beside its database (attachments, avatars) are in volumes named after the project
(`ddev-mysite-wekan-db`, `ddev-mysite-wekan-files`), which go with it. The project's web container keeps the mail
catcher, at `https://mysite.ddev.site:8026`, where the site's mail goes.

| Image | What it is | Source and licence |
| --- | --- | --- |
| `ghcr.io/wekan/wekan:v13.33` | Wekan (`--release` picks another tag) | [wekan/wekan](https://github.com/wekan/wekan), MIT |
| `docker.io/library/mongo:7.0.48` | MongoDB Community Server 7.0, the project's database | [mongodb/mongo](https://github.com/mongodb/mongo), SSPL-1.0; the image's own files, [docker-library/mongo](https://github.com/docker-library/mongo), Apache-2.0 |

Both tags are pinned, never `latest`: a build runs what was proven.

**The database is MongoDB, not MariaDB.** The Workspace's sites usually run on MariaDB, but Wekan needs a
MongoDB-compatible database: it keeps its boards, cards and accounts as MongoDB documents and follows their changes
as they happen. Each application brings what it needs, so a Wekan project runs MongoDB 7 as its own service, as
Wekan's own reference setup does: a replica set of one (`rs0`), initiated when the service starts, which gives Wekan
the change streams a board updates live from. The project has no MariaDB.

**How the accounts are made.** The builder's script (`wekan/wekan-site.mjs` of the project) runs in the project's web
container against Wekan's REST API at `http://wekan:8080`. With `--install` the workspace account signs up first, and
Wekan makes its first account the administrator; the sign-up is turned off after it. The administrator makes the
other accounts, and each account's board role is set by the board's administrator. The passwords come on the script's
input, never on a command line, never in a log. What Wekan's REST API does not have (a person's full name, a password
given back, Scrum planning and its sprint, a day of logged time) goes through the methods Wekan's own screens call.
Those parts depend on Wekan 13.33, the release the builder pins, and never run against a Wekan of your own: when one of
those calls fails, the builder says which part of the sample content it could not make (a line starting `WARNING:`,
and a `Not made` line at the end) and goes on with the rest. The step pack's CI builds its site with the same script
on 13.33 and fails on such a line, and its features read each of those parts, so a new pin shows a break at once.

The site's own values (the address, the database's address, the mail catcher) are kept in `wekan/env` of the project,
which only you can read. The builder never prints them.

**Failed sign-ins.** Wekan locks an account for 60 seconds after three wrong passwords within 15 seconds, and an
unknown account the same way. A test suite tries one wrong password at a time, so a site the workspace builds keeps
Wekan's own settings.

### The default accounts

| Account | Name | Their role in Webship site |
| --- | --- | --- |
| `owner` | Owner Test | Its administrator |
| `member` | Member Test | A normal member |
| `reader` | Reader Test | A read-only member: reads, and changes nothing |
| `stranger` | Stranger Test | None: the board does not have them, and tells them it is not found |

Each has the password of the workspace's other default lists, `dD.123123ddd`, signs in with its username, and shows as
its full name. They are configuration: a test suite never creates or deletes one. `bash cmd-tools-add-users.sh mysite
wekan` and `bash cmd-tools-cancel-users.sh mysite wekan` (the row's Tests menu) add them and keep them from signing
in.

### The sample content

Webship site, a private board administered by owner, with member and reader, its lists To Do, Doing and Done, and a
red label "bug": "The greeting script says Helo instead of Hello" (by owner, in Doing, labelled bug, assigned to
member, with owner's comment, a checklist "Checks" with "Fix the spelling in greeting.sh", and half an hour of
member's time), "The usage line spells greeting as greting" (by member, in To Do) and "Add a test for the greeting" (by
owner, in Done). Scrum planning is on, with Sprint 1 active and the first two cards in it. The builder makes each card
as its author, so the board says who did what.

## The tool

```bash
bash cmd-tools-wekan-cli.sh mysite                                 # what the site is: release, address, accounts, cards
bash cmd-tools-wekan-cli.sh mysite --sample-content                # the sample content, where it is missing
bash cmd-tools-wekan-cli.sh mysite --tidy                          # what a stopped test run left
bash cmd-tools-wekan-cli.sh mysite --add-users                     # the default accounts, their passwords and roles back
bash cmd-tools-wekan-cli.sh mysite --cancel-users                  # keep them from signing in
bash cmd-tools-wekan-cli.sh mysite --connect member                # the dashboard reads this site as member
```

`--connect <login>` makes a new login token of the account through Wekan's API, as the site's administrator (Wekan
records it as the administrator's, with the reason), and writes it, with the account's username and the site's
address, into `core/config/plugin.wekan.settings.yml`, and the sample board as the default one when none was set. The
token is never shown. The dashboard then acts as that person. Wekan keeps a login token for 90 days: connect again
after that.

`--tidy` deletes for good, with no way back. It removes the cards a stopped test run left: titled "Webship test …",
made by one of the default accounts in Webship site (archived ones too), with their comments, and the comments
starting "Webship test" that a default account left on the board's other cards. A card with another title ("Webship
testing plan") or another author stays, and so does everything of other people.

## The cards as work items

The plugin is a provider of the tracker family. With a Wekan address, a username and a login token in its settings
(`--connect` writes them for a site the workspace built; for your own Wekan, `POST /users/login`), the project rows of
sites and code folders carry the **WEKAN** menu, once they have a Wekan board to work against (`default_scope` as the
board's title, `Webship site`, or one remembered from the list):

- **The list**: the open cards (the ones not archived), mine (as Wekan's own My Cards: the cards the person is a
  member or an assignee of), someone's, and a search in the title. A card's state is its list (To Do, Doing and Done
  on the sample board), and Archived once it is archived.
- **One card** (its id, the last part of its address): its text, its author with their standing, its labels and its
  comments.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the default branch of
  the project's remote, in a screen session you watch. The card is saved as data, never as instructions; Wekan keeps
  Markdown and drops raw HTML.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true`): a comment, a move to another list (or archiving the card, and restoring it),
  labels (the board's own: a label the board does not have is refused, since its administrator makes labels), an
  assignee (`me`, or a member of the board, by their name or username) and a new card in the board's first list, each
  your click after a preview.

Every read and write goes through Wekan's REST API, as the connected person. A board is read through Wekan's own
export of it, narrowed to what is needed: its open cards with their labels and people, or one card with its comments
and activities.

**Who is inside.** Each person's standing is their role in the board: its administrators are owners of it; its normal
members, and the ones who may not comment, the ones who change only the cards they are on, and its workers, are
members. A read-only or a comment-only member, someone no longer active in the board, and someone it does not have are
outside. A card made, or last edited, by someone outside is analyze only unless you confirm it by its author's name
(`outsider_items: refuse` refuses it), and each comment's author counts on their own.

**The last editor** is the person of the newest change of the card's title or description that Wekan recorded, when
not the card's creator. Wekan records the changes made on its own screens; a change made through its REST API leaves no
record.

**Credentials.** The token travels in a file only you can read, never on a command line. Before anything is posted,
the text is checked for credentials: the ones the tracker family knows, the token of the settings, and anything shaped
like a Wekan login token (43 letters, digits, "-" and "_").

Wekan opens no pull request: push the branch and open its pull request from the project's forge menu (GITHUB,
GITLAB) when its remote is on a forge.

### Settings

`core/config/plugin.wekan.settings.yml` (Settings → Plugins → Wekan):

| Key | What it is |
| --- | --- |
| `url` | The Wekan address, without a trailing slash |
| `username` | The username of the account the dashboard reads (and, with writes on, writes) as |
| `token` | A login token of that account. Never printed |
| `allow_writes` | Comments, moves to another list, archiving and restoring, labels, assignees and new cards to Wekan; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The Wekan board a workspace project works against when it remembers none: its title, `Webship site` |
| `scopes` | The Wekan boards (their titles) the list may be switched to; empty is any board the account is on |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved card keeps: `members` (the board's administrators and the members who may change its cards), `all`, `none` |
| `outsider_items` | A card from outside the board: `analyze` (work it only after a confirmation by name) or `refuse` |

## What the plugin does not do yet

- **A worklog and a sprint view.** Wekan shows both on its own screens (a card's time by day, and the Sprints of Scrum
  planning), but its REST API has no route for time entries or for sprints. Wekan's own screens use internal methods
  over its websocket for both. The provider does not rely on those: they are not documented, Wekan releases often,
  and people connect the dashboard to their own Wekan at whatever release they run. Writing a card's spent time
  through REST is no worklog either: it skips Wekan's own record of the days, so the total and the days would
  disagree. The time logged on a card is read in Wekan itself, and the step pack reads it there.
  ([webship/workspace-wekan#2](https://github.com/webship/workspace-wekan/issues/2) keeps what was proven with those
  methods.)
- **Other runtimes.** Docker Compose, Podman and Kubernetes are not proven for Wekan yet.

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/wekan-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's REST API), the board of the steps
(`Webship site`), the users registry (`owner`, `member`, `reader`, `stranger`, each signing in with its username), and
`tests/features/site.feature`, whose first scenario checks the site opens on its sign-in form. The suite leaves the
site as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `wekan-site-builder` | Build, look after and remove Wekan sites |
| Agent | `wekan-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `wekan-issue-worker` | Work a card on a branch, the writes left to a person |
| Skill | `wekan-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/wekan-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `wekan-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `wekan-issue-to-branch` | Work a card on a branch |

## License

ISC (see `LICENSE`). Wekan itself is MIT: the plugin runs Wekan's own image and MongoDB's, and carries none of their
code.
