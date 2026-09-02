import type { IVpnServerClientLike } from './interfaces';
import type { VpnPeer } from './schema';

/**
 * @orun/vpn-core — wg-easy-client.ts
 *
 * Orquestra a API do wg-easy (https://github.com/wg-easy/wg-easy) em vez de
 * reimplementar geração de chaves/config WireGuard — "orquestrar, não reinventar".
 *
 * ✅ VERIFICADO CONTRA O CÓDIGO-FONTE REAL (não contra wrapper de terceiro):
 * baixei o repo (`wg-easy/wg-easy`, branch master) e li os handlers em
 * `src/server/api/**` diretamente. A versão atual do wg-easy é uma reescrita
 * em Nuxt/Nitro (não o Express antigo que os wrappers PyPI assumem), então:
 *  - Prefixo real é `/api/client`, não `/api/wireguard/client`.
 *  - Login exige `username` + `password` (não só senha), em
 *    POST /api/auth/password — cookie de sessão se chama "wg-easy".
 *  - `clientId` é numérico (auto-increment no SQLite), não uma string/uuid.
 *    Convertido pra string aqui pra manter o VpnPeer.id estável independente
 *    de qual backend está por trás.
 *  - Campos do peer: `ipv4Address`/`ipv6Address` (não um campo `address`
 *    único), e `latestHandshakeAt`/`transferRx`/`transferTx` só existem
 *    mesclados em runtime (não ficam no schema do banco) — confirmado em
 *    `server/utils/clientStatus.ts`.
 *  - Não existe endpoint de "sessão" separado do login — a sessão nasce do
 *    próprio POST de auth.
 *
 * ⚠️ GAP AINDA REAL: não testei contra uma instância rodando de verdade
 * (Docker não disponível neste ambiente) — só validei lendo o código-fonte.
 * Comportamento de runtime (2FA/TOTP, OAuth, permissões por role) pode ter
 * nuances que só aparecem testando ao vivo.
 */

interface WgEasyClientOptions {
  baseUrl: string; // ex: "https://vpn.orun.dev:51821"
}

interface WgEasyRawClient {
  id: number;
  name: string;
  ipv4Address: string;
  ipv6Address: string;
  publicKey: string;
  enabled: boolean;
  createdAt: string;
  latestHandshakeAt: string | null;
  transferRx: number | null;
  transferTx: number | null;
}

export class WgEasyClient implements IVpnServerClientLike {
  private readonly baseUrl: string;
  private sessionCookie: string | null = null;

  constructor(options: WgEasyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async login(username: string, password: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember: true }),
    });

    if (!res.ok) {
      throw new Error(`wg-easy login falhou: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { status: string };
    if (body.status === 'TOTP_REQUIRED') {
      throw new Error(
        'wg-easy exige TOTP (2FA) — fluxo de verify-2fa ainda não implementado no WgEasyClient.',
      );
    }
    if (body.status !== 'success') {
      throw new Error(`wg-easy login retornou status inesperado: ${body.status}`);
    }

    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('wg-easy login: nenhum cookie de sessão retornado');
    }
    this.sessionCookie = setCookie.split(';')[0] ?? setCookie;
  }

  private authHeaders(): HeadersInit {
    if (!this.sessionCookie) {
      throw new Error('WgEasyClient: chame login() antes de qualquer outra chamada');
    }
    return { Cookie: this.sessionCookie, 'Content-Type': 'application/json' };
  }

  async listPeers(serverId: string): Promise<VpnPeer[]> {
    const res = await fetch(`${this.baseUrl}/api/client`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`listPeers falhou: HTTP ${res.status}`);
    const raw = (await res.json()) as WgEasyRawClient[];
    return raw.map((c) => this.toVpnPeer(c, serverId));
  }

  async createPeer(name: string, serverId: string): Promise<VpnPeer> {
    const createRes = await fetch(`${this.baseUrl}/api/client`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name, expiresAt: null }),
    });
    if (!createRes.ok) throw new Error(`createPeer falhou: HTTP ${createRes.status}`);
    const created = (await createRes.json()) as { success: boolean; clientId: number };

    // A criação só devolve o id — busca os dados completos do peer recém-criado.
    const listRes = await fetch(`${this.baseUrl}/api/client`, {
      headers: this.authHeaders(),
    });
    if (!listRes.ok) throw new Error(`createPeer: falha ao buscar peer criado: HTTP ${listRes.status}`);
    const all = (await listRes.json()) as WgEasyRawClient[];
    const match = all.find((c) => c.id === created.clientId);
    if (!match) throw new Error(`createPeer: peer ${created.clientId} não encontrado após criação`);
    return this.toVpnPeer(match, serverId);
  }

  async deletePeer(peerId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/client/${peerId}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`deletePeer falhou: HTTP ${res.status}`);
  }

  async setPeerEnabled(peerId: string, enabled: boolean): Promise<void> {
    const action = enabled ? 'enable' : 'disable';
    const res = await fetch(`${this.baseUrl}/api/client/${peerId}/${action}`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`setPeerEnabled falhou: HTTP ${res.status}`);
  }

  async getPeerConfig(peerId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/client/${peerId}/configuration`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`getPeerConfig falhou: HTTP ${res.status}`);
    return res.text();
  }

  async getPeerQrCodeSvg(peerId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/client/${peerId}/qrcode.svg`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`getPeerQrCodeSvg falhou: HTTP ${res.status}`);
    return res.text();
  }

  private toVpnPeer(raw: WgEasyRawClient, serverId: string): VpnPeer {
    return {
      id: String(raw.id),
      serverId,
      name: raw.name,
      publicKey: raw.publicKey,
      address: raw.ipv4Address,
      enabled: raw.enabled,
      createdAt: raw.createdAt,
      latestHandshakeAt: raw.latestHandshakeAt,
      transferRx: raw.transferRx ?? 0,
      transferTx: raw.transferTx ?? 0,
    };
  }
}
