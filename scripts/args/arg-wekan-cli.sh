#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the Wekan project in this folder.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Make the default accounts (owner, member, reader, stranger) and their roles in the board Webship site, or give them back their names, passwords and roles.')
parser.add_argument('-c', '--cancel-users',
                    action='store_true',
                    default=False,
                    help='Keep the default accounts from logging in: their work stays.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='Add the sample content the step pack and the tracker are tested on, where it is missing.')
parser.add_argument('-t', '--tidy',
                    action='store_true',
                    default=False,
                    help='Remove for good what a test run that was stopped half way left: its cards, titled "Webship test …" and made by one of the default accounts in Webship site (archived ones too), and its comments starting "Webship test" on the sample cards. Nothing else is touched.')
parser.add_argument('--connect',
                    dest='CONNECT',
                    default="_none_",
                    help='Point the dashboard\'s Wekan at this site as this account: a new login token of it goes into core/config/plugin.wekan.settings.yml (never shown), with its username and the site\'s address. Example: --connect member')
ARGEOF
