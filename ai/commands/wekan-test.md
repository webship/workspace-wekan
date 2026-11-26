---
description: Test a Wekan site of the Webship Workspace with webship-js and the Wekan step pack — set the testing stack up when it is missing, match every step, run the suite (or one feature, or one tag) in the site's container, and report what failed and why.
argument-hint: '<site> [tests/features/<name>.feature | @tag]'
---

# /wekan-test

Test the Wekan site named in: `$ARGUMENTS`

`$ARGUMENTS` stands for what was typed after the command. An AI CLI that does not fill it in reads the same from the
request: the name of the site, then, if anything, one feature path or one tag.

The first word is the site (its folder name in a sites folder of the workspace). What follows, if anything, narrows
the run: a path that starts with `tests/features/` is one feature (or one folder of features), a word that starts
with `@` is a tag expression. With nothing after the site, the whole suite runs. With no site at all, stop and ask for
one: list the candidates with `ls -d ~/workspace/*/*/wekan/wekan-site.mjs`.

The workspace is container-based (DDEV by default) and everything below runs in the project's containers through the
workspace's own command. Never run `npx cucumber-js`, `npx playwright` or `node` on the host for a site.

## 1. Find the site

```bash
ls -d ~/workspace/*/<site>/wekan/wekan-site.mjs
```

Work from that sites folder (`cd ~/workspace/<folder>`). A site built without `--install --add-users
--sample-content` has no accounts and no sample board to test: say so, and name the command
(`bash cmd-tools-wekan-cli.sh <site> --add-users`, then `--sample-content`). A site that is stopped is started by
the command that needs it; check `free -m` first: the builder asks for 1.5 GB of free memory.

## 2. Set the testing stack up, when it is missing

```bash
ls <site>/cucumber.js || bash cmd-tools-testing.sh <site>
```

The setup adds the step pack, the users registry (`owner`, `member`, `reader`, `stranger`), the managing account, the
board of the steps, and a first feature, `tests/features/site.feature`.

## 3. Match every step, then run

```bash
bash cmd-tools-testing.sh <site> --dry-run                                  # every step matched, nothing run
bash cmd-tools-testing.sh <site> --run                                      # the whole suite
bash cmd-tools-testing.sh <site> --run --path tests/features/site.feature   # one feature
bash cmd-tools-testing.sh <site> --run --tags @board                        # one tag
```

## 4. A run that was stopped

A run that was stopped half way can leave its cards ("Webship test …") and its comments on the site:
`bash cmd-tools-wekan-cli.sh <site> --tidy` removes them.

## 5. Report

The scenarios and steps that passed and failed, then for each failure: the step, its message and hint, the
screenshot the run kept, and what it means (a defect of the site, a scenario to fix, or a refusal the browser logged,
which `@js-off` keeps out of the run). A suite never creates an account, never writes a password into a feature file,
and never writes a platform name into a step phrase. For writing or fixing scenarios, use the `wekan-scenarios` skill
or hand over to the `wekan-tester` agent; for changing the site, to `wekan-site-builder`.

Before you write or change a scenario, or read a failed run, read the book *Automated Functional Testing Recipes* (its
`README.md`, then the matching chapter): `.claude/automated-functional-testing-recipes/` in the project,
`~/.claude/automated-functional-testing-recipes/`, or
https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
