#!/usr/bin/env bash

# Wekan for the Webship Workspace: build a site of Wekan (the open-source kanban board) from its own image on the
# project's own MongoDB 7, add its default accounts and their roles in a sample board, add its sample content, and wire
# its step pack into the testing setup.
#
# Placed by `plugins.sh --install wekan` in core/scripts/plugins/wekan/functions/, where bootstrap sources it after the
# core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): Wekan's image is a service of a generic project, at https://<name>.ddev.site, on the
#     project's own MongoDB (the mongo service: a replica set of one, as Wekan's reference setup runs it), whose data
#     is in a volume named after the project. Wekan needs a MongoDB-compatible database, so the project has no MariaDB:
#     each application brings what it needs. The project's web container keeps the mail catcher.
#   - Docker Compose, Podman and Kubernetes (--runtime docker|podman|kubernetes), through the core's runtime layer, in
#     the same layout: Wekan's own image unchanged as a service of the project (rt_service wekan), MongoDB 7 as another
#     (rt_service mongo, the same replica set of one), each with its data in a volume of the project's own, and no
#     MariaDB. The web container is a Node.js 24 stack: its nginx, run as the host user (rt_serve), passes the project's
#     address to Wekan, websockets included, and the site script runs there with Node.js, as on DDEV. The address is
#     the one the runtime gives it; the stack's Mailpit catches the site's mail. Wekan's image has no shell, which the
#     runtime layer needs of a web container's image, so it is not the web container.
# Lando and Docksal are not proven yet: asked for one, the builder says so and changes nothing.
# The site's accounts and content go through Wekan's own REST API from the project's web container (wekan-site.mjs);
# what that API does not have goes through the methods Wekan's own screens call, at the release the builder runs.
# What the script reads (accounts, passwords) comes on its input, never on a command line. Wekan's own image only.
#
# The container tool has no project type for Wekan, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.wekan.yaml, written by the builder).
# Four names are the ones the core's tools look for:
#   set_wekan_users          the default accounts                     (cmd-tools-add-users.sh <project> wekan)
#   add_wekan_users          make them, and their roles               (the same tool, and --add-users of the builder)
#   cancel_wekan_users       keep them from logging in                (cmd-tools-cancel-users.sh <project> wekan)
#   testing_configure_wekan  the step pack in the testing stack       (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly WEKAN_STEPS_PACKAGE='@webship-js/wekan-steps';
readonly WEKAN_STEPS_VERSION='^2.0.0';

# The release the builder runs when none is asked for (Wekan's image is tagged v<release>), and the MongoDB the
# project runs it on (Wekan's reference setup is MongoDB 7). Both images are pinned, never "latest".
readonly WEKAN_DEFAULT_RELEASE='13.33';
readonly WEKAN_IMAGE_REPOSITORY='ghcr.io/wekan/wekan';
readonly WEKAN_MONGO_IMAGE='docker.io/library/mongo:7.0.48';

# The sample board the default accounts are in, and the folder of a site with the plugin's script and the site's own
# values.
readonly WEKAN_BOARD_NAME='Webship site';
readonly WEKAN_FILES='wekan';

# On another runtime than DDEV: the port the web container's nginx listens on.
readonly WEKAN_SERVE_PORT=8080;

# The free memory a build asks for, in MB: Wekan (Node.js) and MongoDB.
readonly WEKAN_MEMORY_MB=1536;

# The shortest new password Wekan's own forms take (its PASSWORD_MIN_LENGTH default): a shorter one is listed among
# the site's problems.
readonly WEKAN_PASSWORD_MIN=8;

# The default accounts, the ones a scenario logs in as, each with a role in the sample board: its administrator
# (owner), a normal member (member), a read-only member (reader), and an account the board does not have (stranger),
# who is told the board is not found. Wekan logs in by username (or email) and shows the full name. Accounts are
# configuration, made once on the site; a test suite never creates or deletes one. The workspace account the builder
# makes with --install is the site's administrator and is not in this list.
function set_wekan_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
    printf -v "user_${user}_role" '%s' "${user}" ;
  done
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function wekan_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV); on another runtime the one
# the runtime gives it.
function wekan_url() {
  if [ "$(wekan_runtime)" != 'ddev' ] && declare -f rt_url > /dev/null ; then rt_url ; return ; fi
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Wekan site of this plugin? On DDEV the builder leaves .ddev/config.wekan.yaml in it; on another
# runtime the project carries the plugin's claim.
function wekan_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.wekan.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" wekan ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function wekan_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! wekan_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Wekan site of this plugin." ;
    return 1 ;
  fi
  wekan_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copies of the plugin's files (wekan/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it: the site script, and on another runtime than DDEV the web container's
# server script and its nginx settings. The site's own values (wekan/env) are left as they are.
function wekan_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/wekan" f source ;
  [ -d "${project_path}/${WEKAN_FILES}" ] || return 0 ;
  for f in wekan-site.mjs wekan-serve.sh nginx.conf ; do
    source="${f}" ; [ "${f}" = 'nginx.conf' ] && source='wekan-proxy.conf' ;
    # The server's files only where the site has them: a site on DDEV has none.
    [ "${f}" = 'wekan-site.mjs' ] || [ -f "${project_path}/${WEKAN_FILES}/${f}" ] || continue ;
    if [ -f "${from}/${source}" ] && ! cmp -s "${from}/${source}" "${project_path}/${WEKAN_FILES}/${f}" ; then
      cp "${from}/${source}" "${project_path}/${WEKAN_FILES}/${f}" || return 1 ;
    fi
  done
}

# The release of Wekan the site runs: the tag of its image, as the site's values keep it (wekan/env).
function wekan_version() {
  sed -n 's/^WEKAN_RELEASE=//p' "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${WEKAN_FILES}/env" 2>/dev/null | head -n 1 ;
}

# The free memory of this machine, in MB (what the kernel says is available).
function wekan_free_memory() {
  awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null ;
}

# Write the project's files: the plugin's script; on DDEV Wekan's and MongoDB's services
# (.ddev/docker-compose.wekan.yaml), their pinned images in .ddev/.env and the claim (.ddev/config.wekan.yaml); on
# another runtime the claim, the web container's stack and its nginx, and Wekan's and MongoDB's services.
function wekan_write_config() {
  local project_path="$1" release="$2" runtime="${3:-ddev}" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/wekan" f ;
  for f in docker-compose.wekan.yaml wekan-site.mjs wekan-serve.sh wekan-proxy.conf ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install wekan)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${WEKAN_FILES}" || return 1 ;
  cp "${from}/wekan-site.mjs" "${project_path}/${WEKAN_FILES}/" || return 1 ;

  if [ "${runtime}" != 'ddev' ] ; then
    # Another runtime: Wekan's image and MongoDB's as services of the project, the web container a Node.js stack whose
    # nginx passes the project's address to Wekan. MongoDB starts as on DDEV: a replica set of one, initiated once it
    # answers, which Wekan waits for (its driver looks for the set's primary for 30 seconds before it gives up).
    cp "${from}/wekan-serve.sh" "${project_path}/${WEKAN_FILES}/" || return 1 ;
    cp "${from}/wekan-proxy.conf" "${project_path}/${WEKAN_FILES}/nginx.conf" || return 1 ;
    # Wekan's env file is there from the start, only its owner's: wekan_write_env fills it once the runtime has given
    # the project its address.
    ( umask 077 && : >> "${project_path}/${WEKAN_FILES}/env" ) || return 1 ;
    ( cd "${project_path}" \
      && rt_claim wekan \
      && rt_stack node 24 \
      && rt_web_build wekan <<'DOCKEREOF'
# nginx in the web container, run as the host user from the project's own settings (wekan/nginx.conf): it passes the
# project's address to Wekan's service, websockets included.
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/*
DOCKEREOF
    ) || return 1 ;
    # The shell around MongoDB, on every runtime (#12):
    #   - it passes a stop on to MongoDB (its trap), so a project's stop is MongoDB's own clean shutdown, and ends with
    #     MongoDB's code then too: the shell is the container's first process, which ignores the stop signal by itself,
    #     and the engine would kill MongoDB after 10 seconds;
    #   - it ends with MongoDB's own code (wait "$pid"), and a container whose MongoDB ended before its replica set was
    #     initiated ends too: a crash then comes back, through the core's restart policy of a project's own services on
    #     Docker Compose and Podman (webship/workspace#959), as Kubernetes starts a pod's container again.
    # On Kubernetes, found by stopping and starting a project on kind:
    #   - MongoDB's own name answers through its Service, whose address leads to the pod only once the pod is ready:
    #     started again, MongoDB looked for itself there, did not find itself in its replica set (REMOVED) and had no
    #     primary. The name is its own container there, from the start.
    #   - A stop scales the project to none and a start back to one at once, so the new pod can start while the old one
    #     still holds the data folder: its MongoDB then stopped at once ("DBPathInUse"). The shell ends with it, so
    #     Kubernetes starts the container again.
    # Its open files may go up to the container's hard limit, as on DDEV: Docker gives a container 1024 by default,
    # which a restore of Wekan's database went past.
    local limit='ulimit -n "$(ulimit -Hn)" ; ' itself='' ;
    local pid=' pid=$! ; trap "kill -TERM $pid ; wait $pid ; exit \$?" TERM INT ;' alive='kill -0 $pid 2> /dev/null || exit 1 ; ' ;
    if [ "${runtime}" = 'kubernetes' ] ; then
      itself='grep -qx "127.0.0.1 mongo" /etc/hosts || echo "127.0.0.1 mongo" >> /etc/hosts ; ' ;
    fi
    ( cd "${project_path}" \
      && rt_service mongo "${WEKAN_MONGO_IMAGE}" --port 27017 --volume /data/db \
        --command "sh -c '${limit}${itself}mongod --storageEngine wiredTiger --wiredTigerCacheSizeGB 0.25 --oplogSize 256 --replSet rs0 --bind_ip_all --quiet &${pid} until mongosh --host 127.0.0.1 --quiet --eval \"try { quit(rs.status().ok === 1 ? 0 : 1) } catch (e) { if (/NotYetInitialized|no replset config|not yet initialized/.test(String(e.codeName) + String(e.message))) { rs.initiate({ _id: \\\"rs0\\\", members: [{ _id: 0, host: \\\"mongo:27017\\\" }] }) } quit(1) }\" > /dev/null 2>&1 ; do ${alive}sleep 2 ; done ; wait \$pid'" \
      && rt_service wekan "${WEKAN_IMAGE_REPOSITORY}:v${release}" --port 8080 --env-file "${WEKAN_FILES}/env" --volume /data \
      && rt_serve "${WEKAN_SERVE_PORT}" "bash ${WEKAN_FILES}/wekan-serve.sh" ) || return 1 ;
    return 0 ;
  fi

  cp "${from}/docker-compose.wekan.yaml" "${project_path}/.ddev/docker-compose.wekan.yaml" || return 1 ;
  printf 'WEKAN_IMAGE=%s\nWEKAN_MONGO_IMAGE=%s\n' "${WEKAN_IMAGE_REPOSITORY}:v${release}" "${WEKAN_MONGO_IMAGE}" > "${project_path}/.ddev/.env" || return 1 ;
  cat > "${project_path}/.ddev/config.wekan.yaml" <<YAMLEOF
# Wekan in this project: its service and MongoDB's (docker-compose.wekan.yaml), their images in .env, the site's own
# values in ../wekan/env. Written by the Wekan builder of the workspace; build again rather than editing.
web_environment:
  - WEKAN_RELEASE=${release}
YAMLEOF
}

# The site's own values (wekan/env, which only you can read): the project's MongoDB, the address, the mail catcher.
# Wekan keeps no secret of its own in its environment: its accounts and their login tokens are in its database.
function wekan_write_env() {
  local project_path="$1" release="$2" base_url="$3" runtime="${4:-ddev}" mail='web' ;
  # The mail catcher: DDEV's web container on DDEV, the stack's own Mailpit elsewhere.
  [ "${runtime}" != 'ddev' ] && mail='mail' ;
  ( umask 077 && cat > "${project_path}/${WEKAN_FILES}/env" <<ENVEOF
# The values of this Wekan site, made by the Wekan builder of the workspace. Read by Wekan's container; never printed.
WEKAN_RELEASE=${release}
MONGO_URL=mongodb://mongo:27017/wekan?replicaSet=rs0
MONGO_OPLOG_URL=mongodb://mongo:27017/local?replicaSet=rs0
METEOR_REACTIVITY_ORDER=changeStreams,oplog,polling
ROOT_URL=${base_url}
PORT=8080
WITH_API=true
WRITABLE_PATH=/data
MAIL_URL=smtp://${mail}:1025/?ignoreTLS=true
MAIL_FROM=Wekan <wekan@example.com>
BROWSER_POLICY_ENABLED=true
CARDS_LOADING=all
BIGEVENTS_PATTERN=NONE
ENVEOF
  ) ;
}

# The answer of Wekan's sign-in page, asked inside the project's network from the web container: 200 once Wekan has
# reached its database.
function wekan_probe() {
  ddev exec "curl -s -o /dev/null -m 15 -w '%{http_code}' http://wekan:8080/sign-in" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Wait until the site answers, in the project's folder: up to five minutes.
function wekan_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 100) ; do
    code="$(wekan_probe)" ;
    [ "${code}" = '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "Wekan did not answer (its sign-in page: ${code:-none}); the end of its log and of MongoDB's:" ;
  wekan_service_log wekan 30 ;
  wekan_service_log mongo 10 ;
  return 1 ;
}

# The end of the log of a service of the project in this folder (wekan, mongo): DDEV's for its services; on another
# runtime the runtime's own, as the runtime layer runs the project (its `ddev logs` is the web container's).
function wekan_service_log() {
  local service="$1" lines="$2" found rt root ;
  if [ "$(wekan_runtime)" = 'ddev' ] ; then ddev logs -s "${service}" --tail "${lines}" < /dev/null 2>/dev/null ; return 0 ; fi
  found="$(rt_find_project "$PWD" 2>/dev/null)" || return 0 ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    docker|podman) rt_dc "${rt}" "${root}" logs --tail "${lines}" "${service}" < /dev/null 2>/dev/null ;;
    kubernetes) rt_kubectl -n "$(rt_k8s_ns "${root}")" logs "deploy/${service}" --tail "${lines}" < /dev/null 2>/dev/null ;;
  esac
  return 0 ;
}

# Wekan's database in the core's backups, exports, imports and restores (webship/workspace#937), on every runtime:
# Wekan keeps it in the project's own MongoDB (the mongo service, its database wekan), where neither DDEV's database
# nor the runtime's is (the project has none). The core asks wekan_is_project, wekan_export_db and wekan_import_db,
# and names the dumps after wekan_db_extension.

# Wekan's dumps: mongodump's archive of the database wekan, gzipped.
function wekan_db_extension() {
  echo '.archive.gz' ;
}

# A command in the project's MongoDB container, the project in this folder (or above it), its input and its output
# passed as they are, since a dump is binary: DDEV's container of the mongo service, or the runtime's.
function wekan_mongo() {
  local found rt root name ;
  found="$(rt_find_project "$PWD" 2> /dev/null)" || { echo "There is no project in ${PWD}." >&2 ; return 1 ; } ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    ddev)
      name="$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' "${root}/.ddev/config.yaml" | head -n 1)" ;
      docker exec -i "ddev-${name}-mongo" "$@" ;;
    docker|podman) rt_dc "${rt}" "${root}" exec -T mongo "$@" ;;
    kubernetes) rt_kubectl -n "$(rt_k8s_ns "${root}")" exec -i deploy/mongo -- "$@" ;;
    *) echo "Wekan's database is not reached on ${rt} yet." >&2 ; return 1 ;;
  esac
}

# What the database holds, in a line: its boards, cards and accounts.
function wekan_db_counts() {
  wekan_mongo mongosh --quiet wekan --eval 'const n = (c) => db.getCollection(c).countDocuments({}) ; print(`${n("boards")} board(s), ${n("cards")} card(s), ${n("users")} account(s)`)' < /dev/null 2> /dev/null | tr -d '\r' | tail -n 1 ;
}

# Wekan's own service, stopped while its database is replaced and started again after, so nothing writes to it in
# between and it reads it from the start: its service's container on DDEV, Docker Compose and Podman, its Deployment
# on Kubernetes. Once started it is waited for.   wekan_service <stop|start>
function wekan_service() {
  local verb="$1" found rt root name ;
  found="$(rt_find_project "$PWD" 2> /dev/null)" || return 1 ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    ddev)
      name="$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' "${root}/.ddev/config.yaml" | head -n 1)" ;
      docker "${verb}" "ddev-${name}-wekan" > /dev/null || return 1 ;;
    docker|podman) rt_dc "${rt}" "${root}" "${verb}" wekan > /dev/null 2>&1 || return 1 ;;
    kubernetes)
      local replicas=1 ; [ "${verb}" = stop ] && replicas=0 ;
      rt_kubectl -n "$(rt_k8s_ns "${root}")" scale deploy/wekan --replicas="${replicas}" > /dev/null || return 1 ;;
    *) return 1 ;;
  esac
  [ "${verb}" = start ] || return 0 ;
  ( cd "${root}" && wekan_wait > /dev/null ) ;
}

# Write the database of the Wekan site in this folder to <file>: mongodump's gzipped archive of the database wekan.
# A name ending in .sql.gz (the safety dump before a remove or a clone asks for one) gets the same archive: MongoDB has
# no SQL, and wekan_import_db reads the archive under any name.
function wekan_export_db() {
  local file="$1" counts ;
  if [ -z "${file}" ] ; then
    echo "wekan_export_db: where to write the dump (a file)." >&2 ;
    return 1 ;
  fi
  if ! wekan_mongo mongodump --quiet --archive --gzip --db=wekan < /dev/null > "${file}" ; then
    rm -f "${file}" ;
    echo "Wekan's database could not be dumped: is the site running?" >&2 ;
    return 1 ;
  fi
  if [ ! -s "${file}" ] || ! gzip -t "${file}" 2> /dev/null ; then
    rm -f "${file}" ;
    echo "Wekan's database could not be dumped whole: nothing was written." >&2 ;
    return 1 ;
  fi
  counts="$(wekan_db_counts)" ;
  echo "Wekan's database (${counts:-the database wekan}) is in ${file##*/}." ;
}

# Put <file> back as the database of the Wekan site in this folder. It reads Wekan's own dumps only (mongodump's
# gzipped archive, under any name), checks the whole file first, and changes nothing when it cannot read it through;
# it says what it replaces, replaces the database wekan, and starts Wekan again.
function wekan_import_db() {
  local file="$1" magic now after ;
  if [ ! -s "${file}" ] ; then
    echo "There is no dump at ${file}: nothing was changed." >&2 ;
    return 1 ;
  fi
  # Whole: gzip's own check reads the file to its end. Then mongodump's archive: its first four bytes (0x8199e26d).
  if ! gzip -t "${file}" 2> /dev/null ; then
    echo "${file##*/} is not a whole gzipped file: nothing was changed." >&2 ;
    return 1 ;
  fi
  magic="$(gzip -dc "${file}" 2> /dev/null | head -c 4 | od -An -tx1 | tr -d ' \n')" ;
  if [ "${magic}" != '6de29981' ] ; then
    echo "${file##*/} is not a dump of Wekan's database (mongodump's gzipped archive): nothing was changed." >&2 ;
    return 1 ;
  fi
  if ! wekan_mongo mongorestore --quiet --archive --gzip --dryRun --nsInclude='wekan.*' < "${file}" > /dev/null 2>&1 ; then
    echo "${file##*/} cannot be read through by mongorestore: nothing was changed." >&2 ;
    return 1 ;
  fi
  now="$(wekan_db_counts)" ;
  echo "Wekan's database (${now:-the database wekan}) is replaced with ${file##*/}: Wekan is stopped meanwhile." ;
  wekan_service stop || echo "Wekan could not be stopped: its database is replaced while it runs." >&2 ;
  if ! wekan_mongo mongorestore --quiet --archive --gzip --drop --nsInclude='wekan.*' < "${file}" ; then
    echo "mongorestore stopped: Wekan's database may hold part of the dump only. Import the dump again." >&2 ;
    wekan_service start > /dev/null 2>&1 ;
    return 1 ;
  fi
  wekan_service start || echo "Wekan did not answer after it was started again; start the site again." >&2 ;
  after="$(wekan_db_counts)" ;
  echo "Wekan's database is the dump's now: ${after:-its data}." ;
}

# Run a verb of wekan-site.mjs (install, accounts, content, tidy, list, token, counts) in the project's web container,
# against Wekan at http://wekan:8080. Its payload (accounts, passwords, a login) travels on the input, never on a
# command line.
function wekan_site() {
  ddev exec "cd /var/www/html && node ${WEKAN_FILES}/wekan-site.mjs $*" ;
}

# The payload of wekan-site.mjs, as the base64 of its JSON. For install: the workspace account (its login, address,
# password and name in WEKAN_LOGIN, _MAIL, _PASSWORD, _NAME). For the other verbs: the workspace account as the site's
# administrator (WEKAN_ADMIN, WEKAN_ADMIN_PASSWORD), the rows of the default accounts ("login|mail|password|name|role|
# action" lines in WEKAN_ROWS) and a login (WEKAN_LOGIN). All travel to Python in the environment, never on a command
# line.
function wekan_install_payload() {
  WEKAN_LOGIN="$1" WEKAN_MAIL="$2" WEKAN_PASSWORD="$3" WEKAN_NAME="$4" python3 -c '
import base64, json, os
print(base64.b64encode(json.dumps({"login": os.environ["WEKAN_LOGIN"], "mail": os.environ["WEKAN_MAIL"],
      "password": os.environ["WEKAN_PASSWORD"], "name": os.environ["WEKAN_NAME"]}).encode()).decode())' ;
}

function wekan_payload() {
  WEKAN_ADMIN="${account_name}" WEKAN_ADMIN_PASSWORD="${account_pass}" WEKAN_ROWS="$1" WEKAN_LOGIN="${2:-}" python3 -c '
import base64, json, os
rows = []
for line in os.environ["WEKAN_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, name, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "name": name, "role": role, "action": action})
print(base64.b64encode(json.dumps({"admin": {"login": os.environ["WEKAN_ADMIN"], "password": os.environ["WEKAN_ADMIN_PASSWORD"]},
      "rows": rows, "login": os.environ["WEKAN_LOGIN"]}).encode()).decode())' ;
}

# The rows of the default accounts (set_wekan_users), with an action.
function wekan_rows() {
  local action="$1" user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password";
    user_fullname="user_${user}_fullname"; user_role="user_${user}_role";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f'"${!user_role}"$'\x1f'"${action}"$'\x1e' ;
  done
  printf '%s' "${rows}" ;
}

# Build a Wekan site from nothing: the project, MongoDB and Wekan; with --install the workspace account as Wekan's first
# account, its administrator, and the sign-up off; with --add-users the default accounts in their roles of the sample
# board; with --sample-content its cards in the board's lists, a label, an assignee, a comment, a checklist, Scrum
# planning with an active sprint, and a day of logged time.
function wekan_build() {
  trim_project_name ;
  local release="${WEKAN_VERSION:-${site_wekan_release:-${WEKAN_DEFAULT_RELEASE}}}" ;
  release="${release#v}" ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && wekan_runtime)" ;

  case "${runtime}" in
    ddev|docker|podman|kubernetes) ;;
    *) echo "Wekan builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ; exit 1 ;;
  esac
  if [ "${runtime}" != 'ddev' ] && ! declare -f rt_service > /dev/null ; then
    echo "--runtime ${runtime} needs a Webship Workspace whose runtimes run services of a project's own (rt_service, webship/workspace#900): update the workspace, or build on DDEV. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${release}" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] ; then
    echo "--release takes a release of Wekan (13.33), not ${release}. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts are made by the administrator --install sets up." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample board's people are the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt ${WEKAN_PASSWORD_MIN} ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than ${WEKAN_PASSWORD_MIN} characters, which Wekan's own forms ask of a new password: --install makes it the site's administrator. Nothing was changed." ;
    exit 1 ;
  fi
  local free ; free="$(wekan_free_memory)" ;
  if [ -n "${free}" ] && [ "${free}" -lt "${WEKAN_MEMORY_MB}" ] ; then
    echo "Wekan needs about ${WEKAN_MEMORY_MB} MB of free memory (Wekan and MongoDB); this machine has ${free} MB available now. Stop a site you do not need, then build again. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its volumes (MongoDB's data and Wekan's files).
  drop_database ;
  local volume ;
  for volume in "ddev-${PROJECT_NAME}-wekan-db" "ddev-${PROJECT_NAME}-wekan-files" ; do
    if docker volume inspect "${volume}" > /dev/null 2>&1 ; then
      docker volume rm -f "${volume}" > /dev/null 2>&1 \
        && echo "  removed the leftover ${volume} volume" \
        || echo "  could not remove ${volume}: a container may still hold it" ;
    fi
  done
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  # No MariaDB: the project's database is its own MongoDB service.
  if [ "${runtime}" = 'ddev' ] ; then
    ddev config --project-type=generic --project-name=${PROJECT_NAME} --omit-containers=db \
      --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  else
    # The runtime's own project: Docker Compose, Podman or Kubernetes, through the runtime layer.
    ddev config --project-type=generic --webserver-type=generic --project-name=${PROJECT_NAME} --omit-containers=db --auto < /dev/null || exit 1 ;
  fi
  wekan_write_config "${project_path}" "${release}" "${runtime}" || exit 1 ;
  # The address once the runtime has given the project its port.
  local base_url ; base_url="$(wekan_url)" ;
  wekan_write_env "${project_path}" "${release}" "${base_url}" "${runtime}" || exit 1 ;
  # Kubernetes takes Wekan's env file into a Secret of the project's own when the runtime writes the project's files:
  # once more, now that the site's values are there (Docker Compose and Podman read the file when the project starts).
  if [ "${runtime}" = 'kubernetes' ] ; then
    ( cd "${project_path}" && ddev config < /dev/null > /dev/null ) || exit 1 ;
  fi

  if [ "${runtime}" = 'ddev' ] ; then
    echo "Starting the project, MongoDB 7 and Wekan ${release}: their images are a download of about 600 MB the first time." ;
  else
    echo "Starting the project, MongoDB 7 and Wekan ${release}: their images are a download of about 600 MB the first time, and the web image is built with nginx." ;
  fi
  ddev_up start -y < /dev/null || exit 1 ;
  wekan_wait || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Setting Wekan up: the workspace account as its first account, its administrator, and the sign-up off." ;
    wekan_install_payload "${account_name}" "${account_mail:-${account_name}@example.com}" "${account_pass}" "${account_name^} Workspace" \
      | wekan_site install || { echo "Wekan could not be set up." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_wekan_users ;
      add_wekan_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: the cards of ${WEKAN_BOARD_NAME}, a label, an assignee, a comment, a checklist, Sprint 1 and a day of logged time." ;
        ( cd "${project_path}" && wekan_payload "$(wekan_rows '')" | wekan_site content ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: Wekan $(wekan_version) on MongoDB 7.";
    echo "The site: ${base_url}" ;
    echo "The workspace account logs in as ${account_name}, the site's administrator; the sign-up is off: an administrator makes the accounts." ;
  else
    echo "${doc_name} ${PROJECT_NAME} is ready at ${base_url}: Wekan has no account yet, and the first one to sign up becomes its administrator." ;
    echo "Build it again with --install (and --add-users) for the workspace account as that administrator and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Make the default accounts, or give them back their names, passwords and roles: each in its role of the sample board,
# the stranger in none. The list is loaded by the caller (set_wekan_users): the core's add_users, the builder, the tool.
function add_wekan_users() {
  wekan_enter_project || return 1 ;
  local user user_name user_mail user_password user_role ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password"; user_role="user_${user}_role";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: $([ -n "${!user_role}" ] && echo "${!user_role} of ${WEKAN_BOARD_NAME}" || echo "not on ${WEKAN_BOARD_NAME}")";
    echo " ================================================================= ";
  done
  wekan_payload "$(wekan_rows '')" | wekan_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from logging in (their work stays), never the workspace account.
function cancel_wekan_users() {
  wekan_enter_project || return 1 ;
  local user user_name user_mail ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo " ================================================================= ";
  done
  wekan_payload "$(wekan_rows 'lock')" | wekan_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Wekan (core/config/plugin.wekan.settings.yml) at this site, as an account of it: a new login
# token of that account (made by the site's administrator through Wekan's API, which records it as the
# administrator's) goes into the settings file, which only you can read, never on a screen or in a log; with it the
# account's username and the site's address, and the sample board as the default one when none was set. Wekan keeps a
# login token for 90 days: connect again after that.
function wekan_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.wekan.settings.yml" out token url ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._@-]+$ ]] ; then echo "--connect takes the username of an account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install wekan)." ; return 1 ; fi
  set_wekan_users ;
  out="$(wekan_payload "$(wekan_rows '')" "${login}" | wekan_site token 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^TOKEN //p' | tail -n 1)" ;
  out='' ;
  if ! [[ "${token}" =~ ^[A-Za-z0-9_-]{40,}$ ]] ; then echo "No token could be made for ${login} (is it an account of the site, and does the workspace account still log in as its administrator?)." ; return 1 ; fi
  url="$(wekan_url)" ;
  WEKAN_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${login}" "${WEKAN_BOARD_NAME}" <<'PYEOF' || return 1
import os, re, sys
path, url, login, scope = sys.argv[1:5]
token = os.environ['WEKAN_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'username', login)
text = put(text, 'token', token)
if not re.search(r'^default_scope:[ \t]*[^ \t\n"]', text, re.M) and not re.search(r'^default_scope:[ \t]*"[^"]', text, re.M):
    text = put(text, 'default_scope', '"%s"' % scope)
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the cards of ${url} as ${login} now: a new login token of that account is in ${settings} (not shown here; Wekan keeps it for 90 days), and ${WEKAN_BOARD_NAME} is the default board when none was set." ;
}

# What cmd-tools-wekan-cli.sh does: the first of --add-users, --cancel-users, --sample-content, --tidy, --connect that
# was asked for; with none of them, what the site is and its accounts.
function wekan_cli_tool() {
  trim_project_name ;
  wekan_enter_project || exit 1 ;

  [ "$(wekan_probe)" = '200' ] || ddev start -y < /dev/null || exit 1 ;
  wekan_wait > /dev/null || { echo "Wekan of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  set_wekan_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_wekan_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_wekan_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    wekan_payload "$(wekan_rows '')" | wekan_site content ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its cards ("Webship test …") and its comments.
    wekan_payload "$(wekan_rows '')" | wekan_site tidy ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    wekan_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: Wekan $(wekan_version) on MongoDB 7" ;
    echo "  the site:  $(wekan_url)" ;
    echo "" ;
    wekan_payload "$(wekan_rows '')" | wekan_site list ;
  fi
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# The step pack in the testing stack of a Wekan site. The core's testing_configure calls this in the project folder
# once webship-js is scaffolded and before the dependencies are installed; for a project that is not one of this
# plugin's it changes nothing.
#
# It adds the pack to package.json, lists its step definitions in cucumber.js after webship-js's own, gives cucumber.js
# the tags that keep the pack's assertions that must fail out of a normal run, the account that prepares and removes
# test content (manager), the board the steps work in when they name none, and the users registry of the default
# accounts (a handle a scenario reads, mapped to an account; never the workspace account), and writes a first feature
# when the project has none of its own. Every part is skipped when it is already there, so a second run adds what the
# first missed and never resets a suite.
function testing_configure_wekan() {
  local project_path="$1";
  wekan_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Wekan: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Wekan step pack (${WEKAN_STEPS_PACKAGE} ${WEKAN_STEPS_VERSION}).";
  set_wekan_users ;
  # Wekan logs in with the username, and shows the person's full name.
  local registry="" user user_name user_password user_fullname ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_password="user_${user}_password"; user_fullname="user_${user}_fullname";
    registry="${registry}${user}|${!user_name}|${!user_password}|${!user_fullname}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && wekan_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${WEKAN_STEPS_PACKAGE}" "${WEKAN_STEPS_VERSION}" 'WEKAN' "${registry}" "${address}" "${WEKAN_BOARD_NAME}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, sample = sys.argv[1:8]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: the board's administrator.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*board:", src, re.M):
    additions += [
        pad + "// The board the steps work in when they name none (its title).",
        pad + "board: process.env.BOARD || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-wekan-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, login, password, display in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, login, env, password, display))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account and the board of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/wekan/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the board and its cards" ;
  fi

  # The scenarios log in as the default accounts and read the sample board: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and Wekan with it). Each part says when it
  # did not work, and each runs in the project (add_wekan_users ends in the folder).
  if ! ( cd "${project_path}" && wekan_wait > /dev/null 2>&1 ) ; then
    echo "  Wekan does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_wekan_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-wekan-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && wekan_payload "$(wekan_rows '')" | wekan_site content > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-wekan-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}
