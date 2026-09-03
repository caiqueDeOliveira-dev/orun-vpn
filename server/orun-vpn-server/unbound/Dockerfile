# Orun VPN — Unbound custom com suporte a RPZ (DNS filtering HaGeZi)
#
# Por que custom? A imagem `mvance/unbound` é compilada SEM `--enable-rpz`
# (confirmado com unbound -V) e morre silenciosamente (exit 1) ao iniciar
# com um bloco `rpz:` na config. Como o Orun VPN usa RPZ pra servir a
# blocklist HaGeZi aos peers, precisamos de um build próprio com RPZ.

# ---------- Stage build ----------
FROM alpine:3.20 AS build

ARG UNBOUND_VERSION=1.22.0

# Dependências de build para o Unbound (com RPZ + TLS + DNSTAP não necessário)
RUN apk add --no-cache \
    build-base \
    flex \
    bison \
    expat-dev \
    openssl-dev \
    libevent-dev \
    ca-certificates \
    linux-headers \
    libcap

WORKDIR /src
RUN wget -q "https://nlnetlabs.nl/downloads/unbound/unbound-${UNBOUND_VERSION}.tar.gz" -O unbound.tar.gz \
    && tar -xzf unbound.tar.gz --strip-components=1 \
    && rm unbound.tar.gz

# --enable-rpz é a flag que habilita o Response Policy Zone
# tfo = TCP Fast Open; subnet = edns-client-subnet; dnstap desligado p/ image enxuta
RUN ./configure \
        --prefix=/opt/unbound \
        --with-pthreads \
        --with-libevent \
        --with-ssl=/usr \
        --with-libexpat=/usr \
        --enable-rpz \
        --enable-event-api \
        --enable-tfo-client \
        --enable-tfo-server \
        --enable-subnet \
    && make -j$(nproc) \
    && make install

# ---------- Stage runtime ----------
FROM alpine:3.20

RUN apk add --no-cache \
    libevent \
    openssl \
    libexpat \
    ca-certificates \
    bash \
    curl

# Copia o Unbound compilado do stage de build
COPY --from=build /opt/unbound /opt/unbound

# Cria o usuário não-root do unbound (_unbound) e o diretório de runtime
RUN adduser -D -H -u 2000 _unbound \
    && mkdir -p /opt/unbound/etc/unbound/var \
    && chown -R _unbound:_unbound /opt/unbound/etc/unbound/var

# Entrypoint próprio: garante dispositivos e âncora DNSSEC antes de subir
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 53/udp 53/tcp

ENTRYPOINT ["/entrypoint.sh"]
CMD ["-d", "-c", "/opt/unbound/etc/unbound/unbound.conf"]
