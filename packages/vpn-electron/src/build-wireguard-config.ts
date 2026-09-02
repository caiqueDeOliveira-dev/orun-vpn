import type { VpnPeer, VpnServerConfig } from '@orun/vpn-core';
import { buildMacOsPostUpCommand, buildMacOsPreDownCommand } from './macos-killswitch';

/**
 * @orun/vpn-electron — build-wireguard-config.ts
 *
 * Extraído como função pura (sem I/O, sem child_process) especificamente
 * pra poder testar a lógica do arquivo .conf sem precisar mockar SO real.
 *
 * Kill switch embutido no PostUp/PreDown só pra Linux e macOS — ambos usam
 * wg-quick, que suporta esses hooks nativamente. Windows é tratado à parte
 * em windows-killswitch.ts, orquestrado via PowerShell pelo próprio
 * processo Electron (ver comentário lá do porquê).
 */
export function buildWireGuardConfig(
  privateKey: string,
  peer: VpnPeer,
  server: VpnServerConfig,
  killSwitchEnabled: boolean,
  platform: NodeJS.Platform,
  /** IP já resolvido do servidor (ver resolve-server-ip.ts) — mantido separado
   *  de server.host porque o Endpoint do WireGuard pode continuar sendo
   *  hostname (o próprio WireGuard resolve isso na hora de conectar); só a
   *  regra de exceção do kill switch precisa de IP puro. */
  killSwitchServerIp?: string,
): string {
  const lines = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${peer.address}`,
    server.dnsFilter.enabled ? `DNS = 10.8.0.1` : '',
  ];

  if (killSwitchEnabled && platform === 'linux') {
    // Gap do hostname-vs-IP resolvido — usa killSwitchServerIp (já
    // resolvido via DNS antes de chamar esta função) em vez de server.host
    // cru. Se por algum motivo não veio resolvido, cai pra server.host
    // como fallback (só funciona se já for um IP literal).
    const exceptionIp = killSwitchServerIp ?? server.host;
    // TODO(gap real ainda aberto): só bloqueia OUTPUT — não cobre tráfego
    // já em conexões estabelecidas antes do kill switch subir. Suficiente
    // para o caso de "VPN caiu inesperadamente", mas não é um kill switch
    // completo de nível Mullvad (que também trata INPUT/FORWARD).
    lines.push(
      'PostUp = nft add table inet orun_vpn_killswitch; ' +
        "nft add chain inet orun_vpn_killswitch out { type filter hook output priority 0 \\; policy drop \\; }; " +
        'nft add rule inet orun_vpn_killswitch out oifname "%i" accept; ' +
        'nft add rule inet orun_vpn_killswitch out ip daddr ' +
        exceptionIp +
        ' accept',
      'PreDown = nft delete table inet orun_vpn_killswitch',
    );
  }

  if (killSwitchEnabled && platform === 'darwin') {
    const exceptionIp = killSwitchServerIp ?? server.host;
    lines.push(`PostUp = ${buildMacOsPostUpCommand(exceptionIp)}`, `PreDown = ${buildMacOsPreDownCommand()}`);
  }

  lines.push(
    '',
    '[Peer]',
    `PublicKey = ${server.wgPublicKey}`,
    `Endpoint = ${server.host}:${server.wgPort}`,
    `AllowedIPs = 0.0.0.0/0, ::/0`,
    `PersistentKeepalive = 25`,
  );

  return lines.filter((l) => l !== '').join('\n');
}
