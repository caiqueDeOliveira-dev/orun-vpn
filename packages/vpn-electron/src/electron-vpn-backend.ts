import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  BaseVpnBackend,
  type ISecretStoreLike,
  type VpnPeer,
  type VpnProfile,
  type VpnServerConfig,
} from '@orun/vpn-core';
import { buildWireGuardConfig } from './build-wireguard-config';
import { resolveServerIp } from './resolve-server-ip';
import { findWireGuardExe } from './find-wireguard-exe';
import {
  buildDisableKillSwitchScript,
  buildEnableKillSwitchScript,
  buildGetProfileStateScript,
  parseProfileState,
  type FirewallProfileState,
} from './windows-killswitch';

const execFileAsync = promisify(execFile);

/**
 * @orun/vpn-electron — electron-vpn-backend.ts
 *
 * Orquestra o cliente WireGuard nativo do SO em vez de reimplementar o
 * protocolo:
 *  - Linux/macOS: `wg-quick up/down <config>` — kill switch embutido como
 *    PostUp/PreDown no próprio config (nftables no Linux, pf no macOS).
 *  - Windows: `wireguard.exe /installtunnelservice` / `/uninstalltunnelservice`
 *    pro túnel em si, e PowerShell orquestrado direto por este processo pro
 *    kill switch (não via PostUp/PreDown do WireGuard — ver windows-killswitch.ts
 *    pra entender por quê).
 *
 * Caminho do binário `wireguard.exe` no Windows: resolvido dinamicamente
 * (ver find-wireguard-exe.ts) em vez de fixo — não existe chave de registro
 * oficial pro install path (confirmado na doc oficial), então a detecção
 * tenta %ProgramFiles%, %ProgramFiles(x86)%, e cai pro PATH via where.exe.
 * Nenhuma das 3 plataformas foi validada contra um SO real neste ambiente
 * de desenvolvimento — só código lido/confirmado contra fonte oficial.
 */

export class ElectronVpnBackend extends BaseVpnBackend {
  private tunnelConfigDir: string | null = null;
  private tunnelName = 'orun-vpn';
  private killSwitchEnabled = false;
  private windowsFirewallSnapshot: FirewallProfileState[] | null = null;
  private cachedWireGuardExePath: string | null = null;

  constructor(secretStore: ISecretStoreLike) {
    super(secretStore);
  }

  private async wireGuardExePath(): Promise<string> {
    if (!this.cachedWireGuardExePath) {
      this.cachedWireGuardExePath = await findWireGuardExe();
    }
    return this.cachedWireGuardExePath;
  }

  protected async doConnect(
    profile: VpnProfile,
    peer: VpnPeer,
    server: VpnServerConfig,
    privateKey: string,
  ): Promise<void> {
    const killSwitchServerIp = this.killSwitchEnabled ? await resolveServerIp(server.host) : undefined;
    const configText = buildWireGuardConfig(
      privateKey,
      peer,
      server,
      this.killSwitchEnabled,
      process.platform,
      killSwitchServerIp,
    );

    this.tunnelConfigDir = await mkdtemp(join(tmpdir(), 'orun-vpn-'));
    const configPath = join(this.tunnelConfigDir, `${this.tunnelName}.conf`);
    await writeFile(configPath, configText, { mode: 0o600 });

    if (process.platform === 'win32') {
      const wireguardExe = await this.wireGuardExePath();
      await execFileAsync(wireguardExe, ['/installtunnelservice', configPath]);
      if (this.killSwitchEnabled) {
        await this.enableWindowsKillSwitch(server);
      }
    } else {
      // Linux/macOS: requer wg-quick instalado (wireguard-tools) e
      // privilégio para subir a interface — Electron precisa rodar essa
      // chamada com elevação (sudo prompt nativo do SO), já que criar
      // interface de rede exige permissão administrativa. O kill switch
      // (se habilitado) já vem embutido no configText via PostUp/PreDown.
      await execFileAsync('wg-quick', ['up', configPath]);
    }
  }

  protected async doDisconnect(): Promise<void> {
    if (process.platform === 'win32') {
      if (this.killSwitchEnabled && this.windowsFirewallSnapshot) {
        await this.disableWindowsKillSwitch();
      }
      await execFileAsync(await this.wireGuardExePath(), ['/uninstalltunnelservice', this.tunnelName]);
    } else if (this.tunnelConfigDir) {
      const configPath = join(this.tunnelConfigDir, `${this.tunnelName}.conf`);
      await execFileAsync('wg-quick', ['down', configPath]);
    }

    if (this.tunnelConfigDir) {
      await rm(this.tunnelConfigDir, { recursive: true, force: true });
      this.tunnelConfigDir = null;
    }
  }

  /**
   * Linux/macOS: aplicado nas regras PostUp/PreDown do próximo `connect()`
   * (embutidas no config, não dá pra ligar a quente sem reconectar).
   * Windows: aplicado direto via PowerShell no próximo connect/disconnect.
   */
  async setKillSwitch(enabled: boolean): Promise<void> {
    this.killSwitchEnabled = enabled;
    if (this.state.status === 'connected') {
      throw new Error(
        'Kill switch alterado, mas exige reconectar (down + up) para aplicar as novas regras.',
      );
    }
  }

  /**
   * Windows: muda DefaultOutboundAction dos 3 perfis pra Block e libera só
   * o adaptador do túnel + IP do servidor. Ver windows-killswitch.ts pro
   * porquê dessa abordagem (block-all + allow-specific NÃO funciona no
   * Windows Firewall — block sempre vence allow, independente de ordem).
   */
  private async enableWindowsKillSwitch(server: VpnServerConfig): Promise<void> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      buildGetProfileStateScript(),
    ]);
    this.windowsFirewallSnapshot = parseProfileState(stdout);

    const serverIp = await resolveServerIp(server.host);
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      buildEnableKillSwitchScript(this.tunnelName, serverIp),
    ]);
  }

  private async disableWindowsKillSwitch(): Promise<void> {
    if (!this.windowsFirewallSnapshot) return;
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      buildDisableKillSwitchScript(this.windowsFirewallSnapshot),
    ]);
    this.windowsFirewallSnapshot = null;
  }
}
