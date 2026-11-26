---
name: wekan-scenarios
description: Write webship-js scenarios for a Wekan site (the open-source kanban board) of the Webship Workspace from phrases that exist — the Wekan step pack's steps by area (signing in and out and a refused sign-in, a board and who may open it, its lists, one card with its comments, labels, assignee, checklist, creator and logged time, a move to another list, archiving, a new card, the board's sprints, what a read-only member or someone the board does not have may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Wekan site, or when a scenario of the site fails on a phrase.
---

# wekan-scenarios

Scenarios for a site built with the Wekan plugin (`bash cmd-wekan-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/wekan-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in the
pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (the administrator of Webship site), `member` (a
  normal member), `reader` (a read-only member), `stranger` (not on the board). `Given I am not logged in` for a
  visitor.
- The accounts are made by the build (`cmd-tools-wekan-cli.sh <site> --add-users`); a suite never creates or deletes
  one, and never writes a password: it signs in by the handle. Each signs in with its username (`member`) and shows
  as its full name (`Member Test`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member" with the password "…"`, `the login should be refused with "Incorrect password"` (or `"User not found"`), `I am not logged in`, `I log out`, `I should be logged in as "Member Test"` (or the username), `I should not be logged in` |
| Boards | `I open the board "Webship site"`, `the list "Doing" should show the card "…"` (`should not show`), `I should be refused the board "Webship site"` |
| Test content | `there is a card "Webship test …" in the list "To Do" of the board "Webship site"` (it goes after the scenario), `there is no card "Webship test …" on the board "Webship site"` |
| A new card | `I add the card "Webship test …" to the list "To Do"` (through the list's "Add Card", on the open board; it goes after the scenario) |
| One card | `I open the card "…"` (by its title, on the scenario's board), `I move the card to the list "Done"`, `the card should be in the list "Done"`, `I add the comment "…" to the card`, `the card should show the comment "…"` (`… by "Member Test"`), `I add the label "bug" to the card`, `the card should have the label "bug"` (`should not have`), `I assign the card to "Owner Test"`, `the card should be assigned to "Owner Test"`, `the card should be created by "Owner Test"`, `the card should have the checklist item "…"`, `the card should show the time "0.5 h" logged by "Member Test"`, `I archive the card` |
| Sprints | `I open the sprints of the board "Webship site"` (the board's view, put back after the scenario), `the sprint "Sprint 1" should be active`, `the sprint "Sprint 1" should have the card "…"` |
| What an account may not do | `I should not be able to change the card`, `I should not be able to comment on the card`, `I should not be able to add a card to the list "To Do"`, `I should be refused the board "Webship site"` |

## The sample content

`--sample-content` gives Webship site, administered by owner, with member (a normal member) and reader (a read-only
member), its lists To Do, Doing and Done, a red label "bug" and three cards: "The greeting script says Helo instead of
Hello" (by owner, in Doing, labelled bug, assigned to member, with owner's comment "Seen on the test site: the
greeting prints Helo.", a checklist "Checks" with "Fix the spelling in greeting.sh", and half an hour of member's time
logged on it), "The usage line spells greeting as greting" (by member, in To Do) and "Add a test for the greeting" (by
owner, in Done). Scrum planning is on, with Sprint 1 active and the first two cards in it. A suite reads them and never
changes them.

## Traps found on real sites

- A card opens over its board, at `/b/<board id>/<slug>/<card id>`: the steps open it by its title through the site's
  API, and wait for its title in the card's panel.
- After a page is loaded in full, Wekan shows its sign-in page for a moment while it takes the session back: the
  steps wait for the board or the card itself.
- The labels of a card are the board's own: a scenario adds the board's "bug", never a new label.
- The time of a card is logged on it in Wekan's own screen; the pack reads the days, it does not log time.
- The board's view (Swimlanes, Lists, Sprints …) is each person's own setting: `I open the sprints of the board "…"`
  puts the view the person had back after the scenario.
- A read-only member gets the card without its pickers and its comment box, and the board without "Add Card"; an
  account the board does not have gets "Board not found": tag those scenarios `@js-off`.
- Three wrong passwords for one account within 15 seconds lock it for 60 seconds: one wrong password per scenario.
- A run that was stopped half way leaves its "Webship test …" cards: `bash cmd-tools-wekan-cli.sh <site> --tidy`
  removes them.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a card worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each role may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).
