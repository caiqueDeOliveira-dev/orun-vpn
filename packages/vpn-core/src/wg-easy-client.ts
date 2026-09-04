import type { IVpnServerClientLike } from './interfaces';
import type { VpnPeer } from './schema';

/**
 * @orun/vpn-core — wg-easy-client.ts
 *
 * Orquestra a API do wg-easy (https://github.com/wg-easy/wg-easy) em vez de
 * reimplementar geração de chaves/config WireGuard — "orquestrar, não reinventar".
 *
 * ✅ VERIFICADO CONTRA O CÓDIGO-FONTE REAL DESTA INSTÂNCIA (ghcr.io/wg-easy/wg-easy:14):
 * li o `/app/lib/Server.js` e `/app/lib/WireGuard.js` DENTRO do container real
 * que está rodando (`orun-vpn-wg-easy`), e validei o fluxo ao vivo. A API real
 * do wg-easy v14 é DIFERENTE do que o client original assumia (ele foi escrito
 * contra uma versão Nova/Nitro mais nova que não era a que rodamos). Contrato real:
 *  - Login: POST /api/session com body `{ password }` (sem username nesta versão).
 *    Resposta de sucesso: `{ success: true }`. Erro: 401 createError.
 *    O cookie de sessão é `connect.sid` de express-session com secret random a cada
 *    boot — não é estável entre restarts.
 *  - Auth robusta do client: além do cookie, o middleware de autenticação aceita
 *    o header `Authorization` contendo a SENHA crua (Server.js: `isPasswordValid(req.headers['authorization'])`).
 *    Usar isso é a forma mais robusta pra um client programático (sobrevive a
 *    restart do container, sem depender de cookie). auth() envia password crua
 *    no header; se o server mudar e deixar de aceitar, cai pro cookie de sessão.
 *  - Prefixo real: `/api/wireguard/client` (não `/api/client`).
 *  - Campos do peer: `id` (string/chave do config), `name`, `enabled`, `address`
 *    (um único campo, não `ipv4Address` + `ipv6Address`), `publicKey`, `createdAt`,
 *    `latestHandshakeAt`, `transferRx`, `transferTx`, `downloadableConfig`.
 *  - createPeer: POST { name } retorna `{ success: true }` (NÃO devolve o id).
 *    Após criar, faz GET e encontra o peer recem-criado pelo nome.
 *  - Não há 2FA/TOTP na versão 14 — o fluxo TOTP do client original foi escrito
 *    contra uma versão mais nova; aqui o contrato de erro é 401 do createError.
 */

interface WgEasyClientOptions {
  baseUrl: string; // ex: "https://vpn.orun.dev:51821"
}

interface WgEasyRawClient {
  id: string;
  name: string;
  address: string;
  publicKey: string;
  enabled: boolean;
  createdAt: string;
  latestHandshakeAt: string | null;
  transferRx: number | null;
  transferTx: number | null;
}

export class WgEasyClient implements IVpnServerClientLike {
  private readonly baseUrl: string;
  private password: string | null = null;
  private sessionCookie: string | null = null;

  constructor(options: WgEasyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async login(username: string, password: string): Promise<void> {
    // wg-easy v14 ignora username (só exige password). Chamamos /api/session pra
    // validar a credencial já no login (falha rápido se estiver errada) e guardar
    // o cookie de sessão como fallback.
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      throw new Error(`wg-easy login falhou: HTTP ${res.status}`);
    }

    const body = (await res.json().catch(() => ({}))) as { success?: boolean };
    if (body.success !== true) {
      throw new Error('wg-easy login retornou status inesperado (login sem sucesso)');
    }

    // Guarda a senha p/ autenticar via header Authorization (robusto a restarts).
    this.password = password;

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.sessionCookie = setCookie.split(';')[0] ?? null;
    }
  }

  private authHeaders(): HeadersInit {
    if (!this.password && !this.sessionCookie) {
      throw new Error('WgEasyClient: chame login() antes de qualquer outra chamada');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.password) {
      // Middleware do wg-easy v14 aceita a senha crua no header Authorization.
      headers.Authorization = this.password;
    } else if (this.sessionCookie) {
      headers.Cookie = this.sessionCookie;
    }
    return headers;
  }

  async listPeers(serverId: string): Promise<VpnPeer[]> {
    const res = await fetch(`${this.baseUrl}/api/wireguard/client`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`listPeers falhou: HTTP ${res.status}`);
    const raw = (await res.json()) as WgEasyRawClient[];
    return raw.map((c) => this.toVpnPeer(c, serverId));
  }

  async createPeer(name: string, serverId: string): Promise<VpnPeer> {
    const createRes = await fetch(`${this.baseUrl}/api/wireguard/client`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) throw new Error(`createPeer falhou: HTTP ${createRes.status}`);

    // A criação só devolve { success: true } — busca o peer recem-criado pelo nome.
    const listRes = await fetch(`${this.baseUrl}/api/wireguard/client`, {
      headers: this.authHeaders(),
    });
    if (!listRes.ok) throw new Error(`createPeer: falha ao buscar peer criado: HTTP ${listRes.status}`);
    const all = (await listRes.json()) as WgEasyRawClient[];
    const match = all.find((c) => c.name === name);
    if (!match) throw new Error(`createPeer: peer "${name}" não encontrado após criação`);
    return this.toVpnPeer(match, serverId);
  }

  async deletePeer(peerId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/wireguard/client/${peerId}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`deletePeer falhou: HTTP ${res.status}`);
  }

  async setPeerEnabled(peerId: string, enabled: boolean): Promise<void> {
    const action = enabled ? 'enable' : 'disable';
    const res = await fetch(`${this.baseUrl}/api/wireguard/client/${peerId}/${action}`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`setPeerEnabled falhou: HTTP ${res.status}`);
  }

  async getPeerConfig(peerId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/wireguard/client/${peerId}/configuration`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`getPeerConfig falhou: HTTP ${res.status}`);
    return res.text();
  }

  async getPeerQrCodeSvg(peerId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/wireguard/client/${peerId}/qrcode.svg`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`getPeerQrCodeSvg falhou: HTTP ${res.status}`);
    return res.text();
  }

  private toVpnPeer(raw: WgEasyRawClient, serverId: string): VpnPeer {
    return {
      id: raw.id,
      serverId,
      name: raw.name,
      publicKey: raw.publicKey,
      presharedKey: null, // PSK só vem no .conf do getPeerConfig (provisioning); lista não expõe
      address: raw.address,
      enabled: raw.enabled,
      createdAt: raw.createdAt,
      latestHandshakeAt: raw.latestHandshakeAt,
      transferRx: raw.transferRx ?? 0,
      transferTx: raw.transferTx ?? 0,
    };
  }
}
