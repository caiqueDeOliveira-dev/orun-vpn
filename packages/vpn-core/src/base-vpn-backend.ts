import type { VpnConnectionState, VpnPeer, VpnProfile, VpnServerConfig } from './schema';
import type { IVpnBackendLike, ISecretStoreLike } from './interfaces';

/**
 * @orun/vpn-core — base-vpn-backend.ts
 *
 * Padrão do ecossistema: `Base*` concentra estado + notificação de listeners;
 * subclasses por plataforma (Electron, Expo, Tizen) implementam só o
 * `doConnect`/`doDisconnect` específico do SO.
 */
export abstract class BaseVpnBackend implements IVpnBackendLike {
  protected secretStore: ISecretStoreLike;
  protected state: VpnConnectionState = {
    status: 'disconnected',
    profileId: null,
    connectedSince: null,
    lastError: null,
    transferRx: 0,
    transferTx: 0,
  };
  private listeners = new Set<(state: VpnConnectionState) => void>();

  constructor(secretStore: ISecretStoreLike) {
    this.secretStore = secretStore;
  }

  async connect(profile: VpnProfile, peer: VpnPeer, server: VpnServerConfig): Promise<void> {
    this.setState({ status: 'connecting', profileId: profile.id, lastError: null });
    try {
      const privateKey = await this.secretStore.get(profile.privateKeySecretRef);
      if (!privateKey) {
        throw new Error(
          `Chave privada não encontrada no ISecretStore para ref "${profile.privateKeySecretRef}"`,
        );
      }
      await this.doConnect(profile, peer, server, privateKey);
      this.setState({
        status: 'connected',
        connectedSince: new Date().toISOString(),
      });
    } catch (err) {
      this.setState({
        status: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.doDisconnect();
    this.setState({
      status: 'disconnected',
      profileId: null,
      connectedSince: null,
    });
  }

  async getState(): Promise<VpnConnectionState> {
    return this.state;
  }

  onStateChange(cb: (state: VpnConnectionState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async setKillSwitch(_enabled: boolean): Promise<void> {
    // Implementado por subclasse — depende de firewall nativo do SO
    // (Windows Filtering Platform, pf no macOS, nftables no Linux).
    throw new Error('setKillSwitch não implementado nesta plataforma');
  }

  protected setState(partial: Partial<VpnConnectionState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Traz o túnel WireGuard para cima usando o mecanismo nativo da plataforma. */
  protected abstract doConnect(
    profile: VpnProfile,
    peer: VpnPeer,
    server: VpnServerConfig,
    privateKey: string,
  ): Promise<void>;

  /** Derruba o túnel. */
  protected abstract doDisconnect(): Promise<void>;
}
