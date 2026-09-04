# Orun VPN — Provisioning (adicionar dispositivos)

Provisionar = dar de alta um dispositivo (desktop, iPhone, etc.) no servidor
wg-easy e gerar a config `.conf` + QR pra importar no app WireGuard.

> **Validado ao vivo** nesta rodada contra a instância real (`wg-easy:14`,
> container `orun-vpn-wg-easy`): criar peer, salvar `.conf` (316 bytes com
> `[Interface]` + `[Peer]`) e QR SVG — tudo HTTP 200, e o peer removido após
> o teste (servidor ficou com 0 peers).

## Se você não quer programar (rápido)

Basta abrir o painel web do wg-easy (a senha é a mesma configurada no `.env`):

```
http://127.0.0.1:51821    # ou https://vpn.orun.dev:51821 quando publicado
```

"No Clients" → "New Client" → digite o nome do dispositivo → gera a config e o
QR pra escanear no app WireGuard do celular.

## Se você quer automatizar via `@orun/vpn-core`

Existe um exemplo pronto em
`packages/vpn-core/examples/provision-peer.cjs` — orquestra o `WgEasyClient`
real (validado contra a v14). Uso:

```bash
# 1) compila o pacote (gera dist/)
pnpm --filter @orun/vpn-core run build

# 2) roda com credenciais em ENV (não em argv, pra não expor a senha)
ORUN_VPN_API_URL=http://127.0.0.1:51821   # ou https://vpn.orun.dev:51821
ORUN_VPN_PASSWORD='sua-senha-admin'       # a mesma do painel web
node packages/vpn-core/examples/provision-peer.cjs "Caique-iPhone" ./out
```

Isso cria o peer, salva `./out/Caique-iPhone.conf` e `./out/Caique-iPhone.svg`
(QR). **Não commita a `.conf`** — ela contém a chave privada. No desktop, a
chave privada deve ir pro `ISecretStore` (`@orun/identity`), nunca pra um
arquivo versionado.

## O contrato real da API v14 (o que o client assume)

Para quem integra direto (sem o `WgEasyClient`):

| Operação | Verbo + rota | Body / resposta |
|---|---|---|
| Login | `POST /api/session` | `{ password }` (sem username na v14) → `{ success: true }` |
| Autenticação | header `Authorization` com a **senha crua** | robusto a restarts (o cookie `connect.sid` morre a cada boot) |
| Listar peers | `GET /api/wireguard/client` | array de peers (`id` string, `address` único, `publicKey`, `enabled`, ...) |
| Criar peer | `POST /api/wireguard/client` | `{ name }` → `{ success: true }` (buscar pelo nome depois) |
| Deletar | `DELETE /api/wireguard/client/:id` | `{ success: true }` |
| Habilitar/desabilitar | `POST /api/wireguard/client/:id/enable` / `.../disable` | `{ success: true }` |
| Config `.conf` | `GET /api/wireguard/client/:id/configuration` | texto da config |
| QR | `GET /api/wireguard/client/:id/qrcode.svg` | `image/svg+xml` |

- **Não existe 2FA/TOTP na v14** — erro de login é HTTP 401.
- Se a API responder "empty reply" ao acessar `127.0.0.1:51821` do host num
  Docker Desktop, use a rede interna do container (ou o hostname publicado).
