export type SnapshotSeedEnvelope = { version: number; month: string; sourceHash: string; publicKey: string; iv: string; tag: string; data: string }
export function snapshotImportPublicKey(connectionString: string): string
export function encryptSnapshotSeed(publicKey: string, payload: { month: string; sourceHash: string; [key: string]: unknown }): SnapshotSeedEnvelope
export function decryptSnapshotSeed(connectionString: string, envelope: SnapshotSeedEnvelope): { month: string; sourceHash: string; [key: string]: unknown }
