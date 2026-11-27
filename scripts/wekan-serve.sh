#!/usr/bin/env bash
# Wekan on Docker Compose, Podman and Kubernetes (rt_serve, webship/workspace#841): the web container runs this as the
# host user, from the project's folder. Wekan itself runs in its own image, a service of the project (wekan:8080); here
# nginx passes the project's address to it, websockets included, with the project's own settings (wekan/nginx.conf).
# On DDEV Wekan's service takes the project's address itself, and this is not used.
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p /tmp/wekan-nginx || exit 1
# Wekan's address is looked up again while nginx runs, by the container's own DNS server: on Docker Compose and Podman
# Wekan's container, started again on its own, can come back on another address, which a name looked up once when
# nginx starts would miss. Kubernetes's DNS answers a Service by its whole name, under the pod's first search domain
# (<namespace>.svc.<cluster domain>); Docker's and Podman's answer the service's own name.
nameserver="$(awk '/^nameserver/ { print $2 ; exit }' /etc/resolv.conf)"
case "${nameserver}" in *:*) nameserver="[${nameserver}]" ;; esac
domain="$(awk '/^search/ { print $2 ; exit }' /etc/resolv.conf)"
host='wekan'
case "${domain}" in *.svc.*) host="wekan.${domain}" ;; esac
printf 'resolver %s valid=5s ipv6=off;\nset $wekan http://%s:8080;\n' "${nameserver:?no DNS server in /etc/resolv.conf}" "${host}" > /tmp/wekan-nginx/wekan.conf || exit 1
# nginx opens /dev/stderr by its name, which the host user cannot open again when the container's own output belongs to
# root (the stack starts this through runuser): it becomes a pipe of this user's, which copies to the container's output.
exec > >(cat) 2>&1
# Its own log on the output from the start (-e), before it reads the settings: the default one is root's.
exec nginx -e stderr -c "${here}/nginx.conf" -p /tmp/wekan-nginx -g 'daemon off;'
