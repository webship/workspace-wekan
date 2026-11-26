#!/usr/bin/env bash

# workspace-name: Wekan (kanban boards)

# Installed by the Wekan plugin (plugins.sh --install wekan); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Wekan site in containers from Wekan's own image, on the project's own MongoDB 7 (Wekan needs a
# MongoDB-compatible database): on DDEV at https://<name>.ddev.site. With --install the workspace account is Wekan's
# first account, its administrator, and the sign-up is off; with --add-users the default accounts are in their roles of
# the board Webship site; with --sample-content its cards in the board's lists, a label, an assignee, a comment, a
# checklist, Scrum planning with an active sprint, and a day of logged time.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="wekan";
distribution_title="Wekan";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/wekan/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/wekan/args/arg-wekan.sh || exit 1 ;

shift $#;

wekan_build ;
