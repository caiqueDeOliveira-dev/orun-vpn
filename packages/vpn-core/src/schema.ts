import { z } from 'zod';

/**
 * @orun/vpn-core — schema.ts
 *
 * Schema-first: tudo abaixo é a fonte da verdade. Interfaces e classes
 * derivam destes tipos via z.infer, seguindo o padrão do resto do Orun OS.
 */

// ---------------------------------------------------------------------------
// Servidor (wg-easy por trás)
// ---------------------------------------------------------------------------

export const VpnServerConfigSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1), // ex: "Orun VPN - Hetzner FSN1"
  /** Host/IP do servidor wg-easy (API + WireGuard) */
  host: z.string().min(1),
  /** Porta da API web do wg-easy (padrão 51821) */
  apiPort: z.number().int().positive().default(51821),
  /** Porta UDP do WireGuard em si (padrão 51820) */
  wgPort: z.number().int().positive().default(51820),
  /** Chave pública WireGuard do servidor — necessária no [Peer] da config do cliente */
  wgPublicKey: z.string().min(1),
  useTls: z.boolean().default(true),
  /** DNS filtering integrado (estilo wirebuddy) */
  dnsFilter: z
    .object({
      enabled: z.boolean().default(true),
      upstream: z.enum(['unbound-dot', 'cloudflare', 'quad9']).default('unbound-dot'),
      blocklist: z.enum(['none', 'stevenblack', 'hagezi-pro']).default('hagezi-pro'),
    })
    .default({ enabled: true, upstream: 'unbound-dot', blocklist: 'hagezi-pro' }),
  createdAt: z.string().datetime(),
});
export type VpnServerConfig = z.infer<typeof VpnServerConfigSchema>;

// ---------------------------------------------------------------------------
// Peer (dispositivo do Círculo — desktop, mobile, etc.)
// ---------------------------------------------------------------------------

export const VpnPeerSchema = z.object({
  id: z.string(),
  serverId: z.string().uuid(),
  name: z.string().min(1), // ex: "Caique-Desktop", "Caique-iPhone"
  /** Chave pública WireGuard (privada nunca sai do ISecretStore) */
  publicKey: z.string(),
  address: z.string(), // ex: "10.8.0.2/32"
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  latestHandshakeAt: z.string().datetime().nullable().default(null),
  transferRx: z.number().nonnegative().default(0),
  transferTx: z.number().nonnegative().default(0),
});
export type VpnPeer = z.infer<typeof VpnPeerSchema>;

// ---------------------------------------------------------------------------
// Perfil de conexão local (o que fica salvo no dispositivo cliente)
// ---------------------------------------------------------------------------

export const VpnProfileSchema = z.object({
  id: z.string(),
  serverId: z.string().uuid(),
  peerId: z.string(),
  /** referência ao ISecretStore, nunca a chave em si */
  privateKeySecretRef: z.string(),
  autoConnect: z.boolean().default(false),
  killSwitch: z.boolean().default(true),
});
export type VpnProfile = z.infer<typeof VpnProfileSchema>;

// ---------------------------------------------------------------------------
// Estado de conexão (runtime, não persistido)
// ---------------------------------------------------------------------------

export const VpnConnectionStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
  'error',
]);
export type VpnConnectionStatus = z.infer<typeof VpnConnectionStatusSchema>;

export const VpnConnectionStateSchema = z.object({
  status: VpnConnectionStatusSchema,
  profileId: z.string().nullable(),
  connectedSince: z.string().datetime().nullable(),
  lastError: z.string().nullable().default(null),
  transferRx: z.number().nonnegative().default(0),
  transferTx: z.number().nonnegative().default(0),
});
export type VpnConnectionState = z.infer<typeof VpnConnectionStateSchema>;
