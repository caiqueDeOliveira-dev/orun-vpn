# Orun VPN — Arquitetura

VPN pessoal do ecossistema Orun OS. Protege o tráfego de rede e dá acesso
remoto seguro ao Desktop / futuro HomeLab, sem depender de provedor terceiro.

## Visão geral

```
+---------------------+          +--------------------------------------------+
| Dispositivo cliente |  WireGuard|           Servidor VPN (Docker)            |
| (desktop/mobile)    |  (UDP)    | +------------+       +-------------------+|
|                     |<--------->| |  wg-easy   |<----->|  Unbound + HaGeZi ||
|  @orun/vpn-electron |  51820    | |   (API+UI) |  DNS  |  (RPZ, bloqueio)  ||
|  @orun/vpn-core     |           | |  10.8.0.1  | 10.8.0.53|               ||
+---------------------+           | +------------+       +-------------------+|
                                  +--------------------------------------------+
```

Duas funções **separadas** que o ecossistema deixa explícitas (mesma filosofia
"orquestrar, não reinventar" dos outros pacotes `@orun/*`):

1. **Provisioning / administração** — roda no lado que administra o servidor
   (um script de setup, uma Hampton de infra). Usa `WgEasyClient` para falar
   com a API do wg-easy: criar/listar/desabilitar peers, gerar config e QR.
2. **Conexão / túnel local** — roda no dispositivo cliente. Usa
   `IVpnBackendLike` (implementado por `ElectronVpnBackend` no desktop) para
   trazer/derrubar o túnel WireGuard nativo do SO.

## Monorepo (pnpm workspaces)

```
packages/
  vpn-core/     # schema Zod + interfaces *Like + BaseVpnBackend + WgEasyClient
  vpn-electron/ # implementação Desktop do túnel (wg-quick / wireguard.exe) + kill switch por SO
server/
  orun-vpn-server/  # docker-compose (wg-easy + Unbound) + Dockerfile do Unbound
docs/               # esta documentação
```

`@orun/vpn-core` é o contrato. Nenhum consumidor importa a implementação
concreta diretamente — só as interfaces `*Like` (padrão do ecossistema).

## Contratos (`vpn-core/src/interfaces.ts`)

- `IVpnServerClientLike` — provisioning/administração (`WgEasyClient`).
- `IVpnBackendLike` — túnel local (implementado por plataforma).
- `ISecretStoreLike` — onde a chave privada fica (reduzido de
  `@orun/identity#ISecretStore`).

## Tipos (`vpn-core/src/schema.ts`, schema-first com Zod)

- `VpnServerConfig` — identificação do servidor wg-easy (host, portas,
  chave pública, DNS filter).
- `VpnPeer` — um dispositivo autorizado no servidor.
- `VpnProfile` — perfil local de conexão (referencia a chave no
  `ISecretStore`, nunca guarda a chave em si).
- `VpnConnectionState` — estado de runtime (não persistido).

## wg-easy v14 (o que o client fala)

> O `WgEasyClient` foi **escrito contra a API real da v14** e validado ao vivo.
> Detalhes no [provisioning](./provisioning.md).

- Login: `POST /api/session` com `{ password }` (sem username na v14).
- Auth: header `Authorization` com a senha crua (robusta a restarts) ou
  cookie de sessão.
- Peers: `/api/wireguard/client`.
- Campo do peer: `address` (único). `createPeer` retorna `{ success: true }`
  (busca o peer pelo nome).

## Unbound + blocklist (DNS filtering)

O IP fixo `10.8.0.53` na rede do tunnel é o DNS de cada peer
(`WG_DEFAULT_DNS=10.8.0.53`). O Unbound custom (compilado com `--enable-rpz`)
carrega a blocklist HaGeZi Pro e responde `NXDOMAIN` para anúncios/trackers
na origem, com forward DoT para `1.1.1.1`/`1.0.0.1` no restante (sem falso
positivo). Ver [installation](./installation.md#dns).
