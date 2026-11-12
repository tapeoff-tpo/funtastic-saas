import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

const context = Buffer.from('funtastic-inventory-month-end-seed-v1')

function recipient(connectionString) {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(connectionString), context, Buffer.from('recipient'), 32))
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(key)
  return ecdh
}

// This publishes only an encryption key. Imports still require a reviewed main
// deployment and its existing database credentials; there is no HTTP write path.
export function snapshotImportPublicKey(connectionString) {
  return recipient(connectionString).getPublicKey().toString('base64')
}

export function encryptSnapshotSeed(publicKey, payload) {
  const ephemeral = createECDH('prime256v1')
  ephemeral.generateKeys()
  const shared = ephemeral.computeSecret(Buffer.from(publicKey, 'base64'))
  const key = Buffer.from(hkdfSync('sha256', shared, context, Buffer.from('payload'), 32))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))), cipher.final()])
  return { version: 1, month: payload.month, sourceHash: payload.sourceHash, publicKey: ephemeral.getPublicKey().toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

export function decryptSnapshotSeed(connectionString, envelope) {
  if (envelope.version !== 1) throw new Error('Unsupported inventory seed version')
  const shared = recipient(connectionString).computeSecret(Buffer.from(envelope.publicKey, 'base64'))
  const key = Buffer.from(hkdfSync('sha256', shared, context, Buffer.from('payload'), 32))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  const payload = JSON.parse(gunzipSync(clear).toString('utf8'))
  if (payload.month !== envelope.month || payload.sourceHash !== envelope.sourceHash) throw new Error('Inventory seed identity mismatch')
  return payload
}
