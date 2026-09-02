import type {
  VpnConnectionState,
  VpnPeer,
  VpnProfile,
  VpnServerConfig,
} from './schema';

/**
 * @orun/vpn-core — interfaces.ts
 *
 * Segue o padrão *Like do ecossistema: nenhum pacote consumidor importa
 * a implementação concreta diretamente, só estes contratos mínimos.
 */

/** Reduzido de @orun/identity#ISecretStore — evita import direto entre pacotes. */
export interface ISecretStoreLike {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

/**
 * Cliente para o painel de administração do servidor (wg-easy por trás).
 * Roda no lado que administra o servidor (ex: um script de setup, ou
 * a própria Hampton via agente de infra) — não roda no dispositivo cliente comum.
 */
export interface IVpnServerClientLike {
  login(username: string, password: string): Promise<void>;
  listPeers(serverId: string): Promise<VpnPeer[]>;
  createPeer(name: string, serverId: string): Promise<VpnPeer>;
  deletePeer(peerId: string): Promise<void>;
  setPeerEnabled(peerId: string, enabled: boolean): Promise<void>;
  /** Config .conf pronta (inclui chave privada gerada pelo servidor — só usar em setup inicial confiável) */
  getPeerConfig(peerId: string): Promise<string>;
  getPeerQrCodeSvg(peerId: string): Promise<string>;
}

/**
 * O que cada plataforma (Electron, Expo, Tizen) implementa para
 * efetivamente subir/derrubar o túnel local.
 */
export interface IVpnBackendLike {
  connect(profile: VpnProfile, peer: VpnPeer, server: VpnServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  getState(): Promise<VpnConnectionState>;
  onStateChange(cb: (state: VpnConnectionState) => void): () => void;
  /** Kill switch: bloqueia tráfego fora do túnel se a VPN cair inesperadamente */
  setKillSwitch(enabled: boolean): Promise<void>;
}
