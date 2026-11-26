/**
 * Wekan for Webship Workspace: a platform plugin and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites
 * folders, their functions and argparse under core/scripts/plugins/wekan/ (with the compose file of Wekan's and
 * MongoDB's services, the script the builder runs against Wekan's API from the project's web container, and the first
 * feature of a site), and its AI items (ai/ in this package) in the folder of their kind.
 *
 * What register() adds: the cards of a Wekan board as work items (@webship.co/workspace-tracker): the WEKAN menu on the
 * project rows of sites and code folders that work against a Wekan board, the list, one card, analyze, do the work
 * with the workspace's AI CLI on a branch, and, with writes on, a comment, a move to another list (or archiving and
 * restoring), labels and an assignee, each a person's click after a preview. And what the assistant is told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerTracker } from '@webship.co/workspace-tracker';

import { wekanTracker } from './lib/tracker';

export { wekanTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'wekan';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-wekan-project.sh', 'cmd-tools-wekan-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['wekan-site-builder', 'wekan-tester', 'wekan-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['wekan-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['wekan-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['wekan-build-and-test', 'wekan-issue-to-branch'];

/** What the assistant is told about Wekan sites in this workspace (the cards are told by the tracker). */
export function assistantContext(): string {
  return [
    'Wekan (a plugin, @webship.co/workspace-wekan), the open-source kanban board: a site is built with',
    '`bash cmd-wekan-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos):',
    'Wekan\'s own image (13.33 by default, `--release`) on the project\'s own MongoDB 7 (Wekan needs a MongoDB-compatible database, so the project has no MariaDB), on DDEV at https://<name>.ddev.site; other runtimes are not proven for it yet.',
    'The builder asks for 1.5 GB of free memory before it starts.',
    '`--install` makes the workspace account Wekan\'s first account, its administrator, and turns the sign-up off;',
    '`--add-users` adds the default accounts (owner: the administrator of the board Webship site, member: a normal member, reader: a read-only member; stranger: not on it), each @example.com, logging in with its username;',
    '`--sample-content` adds its cards (The greeting script says Helo instead of Hello in Doing, assigned to member, label bug, a comment and a checklist; The usage line spells greeting as greting in To Do; Add a test for the greeting in Done),',
    'Scrum planning with Sprint 1 active (the first two cards in it), and half an hour of the member\'s logged time on the first card.',
    '`bash cmd-tools-wekan-cli.sh <name>` says what the site is and lists its accounts;',
    '`--sample-content` adds the sample content later, `--tidy` removes the cards and comments a stopped test run left ("Webship test …"), `--add-users` and `--cancel-users` manage the default accounts,',
    'and `--connect <login>` points the dashboard\'s Wekan at the site as that account (a new login token in the plugin\'s settings, never shown, kept by Wekan for 90 days).',
    'A read-only member of a Wekan board reads and changes nothing; a stranger is told the board is not found. The dashboard reads and writes cards through Wekan\'s REST API only: no worklog and no sprint view, since that API has no route for time entries or sprints.',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Wekan step pack; `--run` runs the suite.',
    `For Wekan sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working a card to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run Wekan\'s tools on the host for a project; removing the project removes its database and its files too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  registerTracker(api, wekanTracker(api));
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}
