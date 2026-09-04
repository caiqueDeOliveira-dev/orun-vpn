# Orun VPN — Instalação

Guia completo de instalação: deploy do servidor (Docker) + uso do cliente
(`@orun/vpn-core` + `@orun/vpn-electron`).

## 0. Pré-requisitos

- **Docker** com Docker Compose v2.
- **Node.js ≥ 20** e **pnpm** (para o cliente).
- **Perfis**: o servidor libera as portas `51820/udp` (WireGuard) e `51821/tcp`
  (painel/API wg-easy). Abra `51820` no firewall/VPS para clientes remotos; a
  `51821` deve ficar atrás de VPN/SSH tunnel (não expor a API admin direto).

## 1. Deploy do servidor

```bash
cd server/orun-vpn-server
cp .env.example .env
# edite o .env:
#   WG_HOST=vpn.orun.dev            -> seu domínio/DDNS/IP público
#   WG_EASY_PASSWORD_HASH=$$2a$$12$$...  -> hash bcrypt da senha admin

# atualiza a blocklist HaGeZi (o arquivo hagezi-pro.rpz é gitignored e baixado no deploy)
./unbound/update-blocklist.sh

docker compose up -d
```

Valide:

```bash
docker ps --format "{{.Names}} {{.Status}}"
# orun-vpn-wg-easy | Up (healthy)
# orun-vpn-unbound | Up
```

- O painel admin fica em `http://<host>:51821` (localmente: `http://127.0.0.1:51821`).
- A senha é a que você gerou o hash pro `WG_EASY_PASSWORD_HASH`.

### Gerar o hash bcrypt (importante)

O wg-easy exige `PASSWORD_HASH` (bcrypt), não senha em texto — e recusa a
variável `PASSWORD`:

```bash
docker run --rm ghcr.io/wg-easy/wg-easy wgpw 'SUA_SENHA_FORTE'
```

**Armadilha crítica de `.env`**: o hash tem `$`, que o Docker Compose
interpreta como variável e TRUNCA. No `.env`, duplique cada `$` como `$$`
(o compose converte `$$`→`$` ao iniciar):

```
# se wgpw retornar  $2a$12$ED4Oe...  copie como:
WG_EASY_PASSWORD_HASH=$$2a$$12$$ED4Oe...
```

> No Windows/PowerShell, não grave o `.env` interpolarizando `$$` (é o PID) ou
> com `-replace` (corrompe o `$`). Grave o hash já escapado com uma ferramenta
> de escrita literal.

## 2. DNS filtering (Unbound + HaGeZi)

O DNS de cada peer aponta para o Unbound (`WG_DEFAULT_DNS=10.8.0.53`, IP fixo
na rede do tunnel). O Unbound custom (Dockerfile em `server/orun-vpn-server/
unbound/`) compila o Unbound 1.22.0 com `--enable-rpz` e carrega a blocklist
HaGeZi Pro via RPZ.

- Bloqueia anúncios/trackers/malware na origem (`NXDOMAIN`), com forward
  DNS-over-TLS para `1.1.1.1`/`1.0.0.1` no restante (sem falso positivo).
- Basta rodar `./unbound/update-blocklist.sh` para baixar/atualizar a lista
  (o container monta o arquivo read-write para o Unbound poder gravar o sidecar).

## 3. Cliente: build + testes

```bash
pnpm install
pnpm -r run build      # compila dist/ de vpn-core e vpn-electron
pnpm -r run test       # 40 testes (vpn-core 19 + vpn-electron 21)
pnpm -r run typecheck
```

## 4. Uso no app (Electron / Desktop)

```ts
import { ElectronVpnBackend } from '@orun/vpn-electron';
import type { ISecretStoreLike } from '@orun/vpn-core';

// secretStore: implemente/use o ISecretStoreLike real do @orun/identity
const backend = new ElectronVpnBackend(secretStore);
backend.setKillSwitch(true);

await backend.connect(profile, peer, serverConfig);
// profile.privateKeySecretRef -> a chave privada é lida do ISecretStore,
// nunca guardada em perfil/arquivo (ver docs/architecture.md).
await backend.disconnect();
```

- **Linux/macOS**: exige `wg-quick` (pacote `wireguard-tools`) e privilégio
  para subir a interface (prompt sudo nativo). O kill switch vem embutido no
  config via `PostUp/PreDown` (nftables no Linux, pf no macOS).
- **Windows**: usa `wireguard.exe /installtunnelservice` (path descoberto em
  runtime, não fixo) e orquestra o firewall via PowerShell para o kill switch
  (none do `PostUp/PreDown` — veja `windows-killswitch.ts`).

> **Aviso de segurança — kill switch Windows**: muda `DefaultOutboundAction`
> dos 3 perfis para `Block` e libera só o túnel + IP do servidor. Isso pode
> interferir no DHCP/renovação de rede do SO enquanto ativo. Teste em VM real
> antes de confiar em produção.

## 5. Provisionar dispositivos

Ver [docs/provisioning.md](./provisioning.md) — painel web OU
`packages/vpn-core/examples/provision-peer.cjs` (automatizado, validado ao
vivo).

## 6. Exposição remota

- Desejável: WireGuard já @ fonte em `51820/udp` para os clients.
- A API admin `51821` NÃO deve ficar pública — alcance-a via VPN do próprio
  Orun ou um SSH/tailscale tunnel.

## Segurança de segredos

- A chave privada de cada peer fica no **servidor** (wg-easy) e, no cliente,
  no **`ISecretStore`** — nunca em arquivo versionado.
- A config `.conf` gerada contém chave privada: trate como segredo.
- O `.env` do servidor (senha admin) é gitignored.
