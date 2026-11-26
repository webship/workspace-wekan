#!/usr/bin/env bash

# Installed by the Wekan plugin (plugins.sh --install wekan); __WORKSPACE__ is the workspace it was installed into.
#
# A Wekan site of this folder: what it is and its accounts; --add-users and --cancel-users the default accounts;
# --sample-content the sample content; --tidy what a stopped test run left; --connect the dashboard's Wekan to this
# site.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="A Wekan site of __WORKSPACE__: what it is, its accounts, its sample content"
# The args file comes with the plugin: core/scripts/plugins/wekan/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/wekan/args/arg-wekan-cli.sh || exit 1 ;

shift $#;

wekan_cli_tool ;
