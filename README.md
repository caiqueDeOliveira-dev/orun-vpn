# Orun VPN

VPN pessoal do ecossistema Orun OS — protege tráfego de rede e dá acesso
remoto seguro ao Desktop / futuro HomeLab, sem depender de provedor terceiro.

## Por que essa combinação

| Peça | Origem | Por quê |
|---|---|---|
| Motor WireGuard + gerenciamento de peers | **wg-easy** | Maduro (5M+ pulls), API REST simples, QR code pronto pra mobile — não precisa reimplementar geração de chave/config |
| DNS filtering (bloqueio de ads/tracker/malware na origem) | Inspirado no **wirebuddy** | Unbound + blocklist HaGeZi Pro no caminho de DNS de cada peer, sem serviço extra separado |
| Interface pronta pra mesh/multi-site | Conceito do **Netmaker** | `IVpnServerClientLike` não assume servidor único — dá pra trocar por um backend Netmaker depois, quando o HomeLab tiver múltiplos sites, sem tocar no cliente |
| Não usado: **Headscale** | — | Resolve coordenação de rede Tailscale-compatível, que não é o problema aqui (um usuário, sem necessidade de mesh complexo agora) |

## Estrutura

```
packages/
  vpn-core/          # Zod schema, interfaces *Like, BaseVpnBackend, cliente wg-easy (+ examples/provision-peer.cjs)
  vpn-electron/       # Implementação Desktop (wg-quick / wireguard.exe)
server/
  orun-vpn-server/    # docker-compose: wg-easy + Unbound com blocklist
docs/                # arquitetura, instalação e provisioning
```

## Documentação

- [`docs/architecture.md`](./docs/architecture.md) — visão geral, contratos e tipos.
- [`docs/installation.md`](./docs/installation.md) — deploy do servidor + uso do cliente.
- [`docs/provisioning.md`](./docs/provisioning.md) — como adicionar dispositivos (painel web ou via `@orun/vpn-core`, validado ao vivo).

## Gaps honestos (não finalizado)

- **API do wg-easy: `WgEasyClient` VALIDADO de ponta a ponta contra a
  instância real rodando** (`ghcr.io/wg-easy/wg-easy:14`, container
  `orun-vpn-wg-easy`). O client original tinha sido escrito contra um
  contrato imaginado/mais novo — a versão real v14 é DIFERENTE e foi
  corrigida no `WgEasyClient` depois de ler o código-fonte DENTRO do
  container (`/app/lib/Server.js` + `WireGuard.js`) e validar ao vivo:
  - **Login**: `POST /api/session` com body `{ password }` (v14 NÃO usa
    `username`; o antigo `/api/auth/password` nesse formato NÃO existe).
  - **Prefixos**: `/api/wireguard/client` (não `/api/client`).
  - **Campos do peer**: `id` (string), `address` (campo ÚNICO, não
    `ipv4Address`+`ipv6Address`), `publicKey`, `enabled`, `createdAt`,
    `latestHandshakeAt`, `transferRx`, `transferTx`.
  - **createPeer** retorna `{ success: true }` (não devolve o id) — o client
    busca o peer recem-criado pelo nome.
  - **2FA/TOTP não existe na v14** — o `WgEasyClient` original previa
    `TOTP_REQUIRED` (de uma versão mais nova); na v14 o contrato de erro de
    login é HTTP 401 do `createError`. Não há TOTP a suportar nesta versão.
  - **Auth robusta**: além do cookie de sessão (`connect.sid`, secret random
    a cada boot → não sobrevive a restart), o client envia a senha crua no
    header `Authorization`, que o middleware do v14 aceita diretamente
    (`isPasswordValid(req.headers['authorization'])`) — estável entre
    restarts.
  - **Testado ao vivo dentro do container** (o host não consegue falar com a
    API: `docker ps` mapeia `127.0.0.1:51821`, mas o host recebe "empty
    reply" do Nitro — a rede interna do container responde normalmente):
    login → list → create → getConfig (tem `[Interface]`+`[Peer]`) → QR SVG
    → disable/enable → delete, tudo HTTP 200 e peer removido após o teste.
    Nenhum peer de smoke deixado no servidor (`wg0.conf` sem `[Peer]` após a
    limpeza).
- **DNS filtering: blocklist HaGeZi via RPZ — VALIDADO com Docker real.**
  A imagem `mvance/unbound` é compilada SEM `--enable-rpz` e morre
  silenciosamente (exit 1) com um bloco `rpz:` na config. Solução: um
  `Dockerfile` próprio (em `server/orun-vpn-server/unbound/`) que compila
  o Unbound 1.22.0 com `--enable-rpz`. Confirmado em runtime: `unbound -V`
  mostra `--enable-rpz` + módulo `respip`, o serviço carrega a HaGeZi
  completa (450k entradas) sem crash, bloqueia domínios da blocklist com
  `NXDOMAIN` e resolve domínios normais via forward DNS-over-TLS pro
  1.1.1.1 (sem falso positivo). As duas pedras de tropeço reais ao validar:
  (1) o bloco `rpz:` exige `module-config: "respip validator iterator"` no
  `server:` (sem isso o RPZ não ativa); (2) o arquivo de zona precisa de
  line endings LF (um artifact com CRLF/BOM gerava erro de parse "could not
  parse the RR's class").
- **Kill switch: implementado nos 3 SOs, cada um com o mecanismo certo pra
  plataforma** (não é o mesmo código copiado 3x):
  - **Linux**: nftables via PostUp/PreDown embutido no config do wg-quick.
  - **macOS**: pf (Packet Filter) via PostUp/PreDown — confirmado que
    wg-quick no macOS suporta esses hooks igual Linux, inclusive
    substituição de `%i` pelo nome real da interface.
  - **Windows**: **não** usa PostUp/PreDown do WireGuard for Windows —
    isso exigiria habilitar `DangerousScriptExecution` no registro, que
    roda scripts como usuário SYSTEM (a própria doc oficial do
    `wireguard-windows` avisa pra habilitar "com a maior cautela"). Em vez
    disso, o Electron orquestra o Windows Firewall direto via PowerShell.
    Isso também exigiu descobrir uma armadilha real: o Windows Firewall
    tem precedência fixa onde **Block sempre vence Allow**, então o padrão
    "block all + allow specific" (que funciona no nftables) simplesmente
    não funciona no Windows — a abordagem certa, confirmada na doc oficial
    da Microsoft, é mudar o `DefaultOutboundAction` do perfil pra `Block`
    (menor precedência) e usar só regras `Allow` explícitas.
  - Limitações conhecidas nos 3: Linux/macOS só cobrem tráfego OUTPUT; Windows
    pode quebrar DHCP/renovação de rede básica do próprio SO enquanto ativo
    (aviso da própria doc da Microsoft sobre esse padrão); se o DNS do
    servidor usa múltiplos IPs em round-robin, só o primeiro é liberado.
  - **Resolvido nesta rodada**: as 3 plataformas exigiam IP puro na regra de
    exceção (nftables/pf/`-RemoteAddress` não aceitam hostname). Em vez de
    deixar como TODO nos 3 lugares, `resolve-server-ip.ts` resolve o
    hostname via DNS uma vez antes de montar qualquer regra — testado com
    `node:dns/promises` mockado, cobrindo IP literal (não resolve),
    hostname/DDNS real, round-robin (pega o primeiro), e falha de DNS.
  - **Caminho do `wireguard.exe` no Windows**: não existe chave de registro
    oficial pro install path (só existem `DangerousScriptExecution` e
    `LimitedOperatorUI`, nada de instalação). Corrigido: a detecção agora
    usa `%ProgramFiles%`/`%ProgramFiles(x86)%` reais do processo, com
    fallback pra `where.exe` (busca no PATH), em vez de um caminho `C:\`
    fixo que quebraria em qualquer instalação fora do padrão.
  - **Nenhum dos 3 foi testado contra uma máquina real** — só código escrito
    e revisado contra documentação oficial e código-fonte real (wg-quick,
    wireguard-windows, Microsoft Learn). Testar em VM real de cada SO antes
    de confiar em produção.
- **`@orun/vpn-expo` (mobile) não existe ainda** — WireGuard mobile não tem
  SDK trivial pra Expo managed workflow; provavelmente exige EAS + módulo
  nativo custom, ou usar o app oficial WireGuard via deep link/QR em vez de
  túnel embutido.

## Testes

40 testes rodando de verdade (`vitest run`, conferido passando antes desta
entrega, não só escrito):

- `vpn-core` (19): schema Zod, fluxo completo de `BaseVpnBackend` com backend
  fake, e `WgEasyClient` com `fetch` mockado cobrindo o CONTRATO REAL da v14
  (login `POST /api/session` password-only, prefixo
  `/api/wireguard/client`, `address` campo único, createPeer busca pelo
  nome, enable/disable, getConfig, erro se chamado sem login) — e ainda o
  client compilado testado ao vivo contra a instância real (ver acima).
- `vpn-electron` (21): função pura `buildWireGuardConfig` (endereço real,
  `[Peer]` completo, kill switch nftables/pf só onde faz sentido, nenhum
  PostUp/PreDown no Windows) + `windows-killswitch` (script gera
  `DefaultOutboundAction Block` e nunca uma regra `-Action Block` explícita —
  teste de regressão direto do bug de precedência que encontrei pesquisando;
  restore só toca perfis com estado conhecido; parsing do JSON do PowerShell
  sem depender de mapeamento numérico de enum) + `resolve-server-ip`
  (IP literal não chama DNS, hostname resolve de verdade, round-robin pega
  o primeiro, DNS vazio lança erro claro) + `find-wireguard-exe` (usa env
  vars reais em vez de caminho fixo, cai pro PATH via `where.exe`, erro
  claro se não achar em lugar nenhum).

## Repositórios usados como referência

- [`mullvad/mullvadvpn-app`](https://github.com/mullvad/mullvadvpn-app) —
  app 100% open source, arquitetura "fail closed" de firewall por SO
  (WFP/nftables/PF). Referência de princípio, não de código copiado.
- [`pia-foss/manual-connections`](https://github.com/pia-foss/manual-connections) —
  scripts de kill switch mais simples, mais alinhados com "orquestrar, não
  reinventar" do que reimplementar um daemon inteiro.
- [`wgtunnel/wgtunnel`](https://github.com/wgtunnel/wgtunnel) — cliente
  Android (MIT) construído sobre `wireguard-android` oficial, com kill
  switch e split tunneling — blueprint pro futuro `@orun/vpn-expo`.
- [`netbirdio/netbird`](https://github.com/netbirdio/netbird) — referência
  de arquitetura mesh (NAT traversal, relay fallback) pra quando o HomeLab
  tiver múltiplos sites — não implementado agora, só documentado.
- [`wg-easy/wg-easy`](https://github.com/wg-easy/wg-easy) e
  [`WireGuard/wireguard-windows`](https://github.com/WireGuard/wireguard-windows) —
  código-fonte real lido diretamente pra corrigir os endpoints da API e o
  comportamento de PostUp/PreDown no Windows (não inferido de wrapper de
  terceiro).

## Deploy do servidor (VPS ou HomeLab, mesmo compose)

Passo a passo completo em [`docs/installation.md`](./docs/installation.md)
(inclui a armadilha do `$$` no hash bcrypt do `.env` e o setup do DNS filter).
Resumo:

```bash
cd server/orun-vpn-server
cp .env.example .env   # preencher WG_HOST e WG_EASY_PASSWORD_HASH
./unbound/update-blocklist.sh
docker compose up -d
```

## Uso no client (Electron / Desktop)

```ts
import { WgEasyClient, BaseVpnBackend } from '@orun/vpn-core';
import { ElectronVpnBackend } from '@orun/vpn-electron';

const backend = new ElectronVpnBackend(secretStore); // ISecretStoreLike real do @orun/identity
await backend.connect(profile, peer, serverConfig);
```

## Uso no lado de administração (provisionar peers no servidor)

Fluxo completo (painel web ou script) em [`docs/provisioning.md`](./docs/provisioning.md).

```ts
import { WgEasyClient } from '@orun/vpn-core';

const admin = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
await admin.login('caique', process.env.ORUN_VPN_ADMIN_PASSWORD!);
const peer = await admin.createPeer('Caique-Desktop', serverConfig.id);
```
