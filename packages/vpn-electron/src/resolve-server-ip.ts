import { isIP } from 'node:net';
import { resolve4 } from 'node:dns/promises';

/**
 * @orun/vpn-electron — resolve-server-ip.ts
 *
 * Resolve o gap repetido nos 3 kill switches (nftables, pf, PowerShell):
 * todos exigem IP na regra de exceção, não hostname/DDNS. Em vez de deixar
 * isso como TODO em 3 lugares, resolve uma vez aqui antes de montar
 * qualquer regra.
 *
 * ⚠️ GAP AINDA REAL (menor, mas honesto): se o DNS do servidor usa múltiplos
 * IPs (round-robin/load balancing), só o primeiro resultado é usado — se o
 * WireGuard reconectar e o handshake for pra outro IP da rotação, o kill
 * switch bloqueia esse handshake por engano. Para um servidor único (nosso
 * caso: uma VPS ou o futuro HomeLab), isso não é problema.
 */
export async function resolveServerIp(host: string): Promise<string> {
  if (isIP(host) !== 0) {
    return host; // já é IP (v4 ou v6), não precisa resolver
  }

  const addresses = await resolve4(host);
  const first = addresses[0];
  if (!first) {
    throw new Error(`resolveServerIp: DNS para "${host}" não retornou nenhum endereço`);
  }
  return first;
}
