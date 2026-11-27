#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev', 'docker', 'podman', 'kubernetes'],
                    help='The container runtime to build on: ddev (the default), docker (Docker Compose), podman or kubernetes. Wekan is not proven on Lando or Docksal yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Set Wekan up with the workspace account as its first account, which Wekan makes its administrator, and turn its sign-up off.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: the administrator of the board Webship site, member: a normal member, reader: a read-only member; stranger: not on it): the ones the test scenarios log in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: the cards of Webship site in its lists, a label, an assignee, a comment, a checklist, Scrum planning with Sprint 1 active, and a day of logged time.')
parser.add_argument('-v', '--release',
                    dest='WEKAN_VERSION',
                    default="",
                    help='The release of the site (Wekan\'s image is tagged v<release>): 13.33 by default. Example: --release 13.33')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF
