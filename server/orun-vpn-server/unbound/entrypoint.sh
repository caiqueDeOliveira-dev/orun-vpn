#!/bin/sh
# Entrypoint do Unbound custom do Orun VPN.
#
# Prepara o ambiente de runtime (device nodes e diretório de trabalho) antes
# de repassar os args para o daemon real do Unbound (/opt/unbound/sbin/unbound).

set -e

# Unbound precisa dos device nodes de random/null dentro do seu diretório de
# chroot. Cria se não existirem.
DEV_DIR=/opt/unbound/etc/unbound/dev
mkdir -p "$DEV_DIR"
[ -e "$DEV_DIR/random" ]   || cp -a /dev/random   "$DEV_DIR/random"
[ -e "$DEV_DIR/urandom" ]  || cp -a /dev/urandom  "$DEV_DIR/urandom"
[ -e "$DEV_DIR/null" ]     || cp -a /dev/null     "$DEV_DIR/null"

# Dir de runtime (root.key de DNSSEC) — garante owner correto.
VAR_DIR=/opt/unbound/etc/unbound/var
mkdir -p -m 700 "$VAR_DIR"
chown "$(id -u):$(id -g)" "$VAR_DIR" 2>/dev/null || true

# Sempre que faltar a âncora raiz de DNSSEC, tenta baixar. Se a rede estiver
# indisponível no boot, o Unbound segue funcionando (DNSSEC apenas degrada).
if [ ! -s "$VAR_DIR/root.key" ]; then
  /opt/unbound/sbin/unbound-anchor -a "$VAR_DIR/root.key" 2>/dev/null || \
    echo "Aviso: falhou ao baixar a âncora DNSSEC root.key; Unbound seguirá sem validação DNSSEC até a próxima reinicialização."
fi

exec /opt/unbound/sbin/unbound "$@"
