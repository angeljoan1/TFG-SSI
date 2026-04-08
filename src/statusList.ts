// arxiu: src/statusList.ts
// W3C BitstringStatusList — gestió de la llista de revocació de les OT
// format: GZIP(bitstring) → base64url, capacitat 16384 entrades
// signatura: Ed25519 sobre JSON canònic (claus ordenades alfabèticament)

import { generateKeyPairSync, createSign, createVerify, sign, verify } from 'crypto'
import { gzipSync, gunzipSync } from 'zlib'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

// ─── Constants ────────────────────────────────────────────────────────────────
const MIDA_BITS        = 16_384
const FITXER_CLAU      = path.join(process.cwd(), 'ot-signing-key.json')
const FITXER_BITSTRING = path.join(process.cwd(), 'ot-status-bits.bin')

// ─── Clau de signatura Ed25519 ────────────────────────────────────────────────

export interface ParellClaus {
  publicKeyPem:  string
  privateKeyPem: string
}

export function carregarOGenerarClau(): ParellClaus {
  if (existsSync(FITXER_CLAU)) {
    return JSON.parse(readFileSync(FITXER_CLAU, 'utf-8')) as ParellClaus
  }
  console.log('[status-list] generant parella de claus Ed25519...')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const parell: ParellClaus = { publicKeyPem: publicKey, privateKeyPem: privateKey }
  writeFileSync(FITXER_CLAU, JSON.stringify(parell, null, 2), 'utf-8')
  console.log(`[status-list] clau guardada a ${FITXER_CLAU}`)
  return parell
}

// ─── Bitstring ────────────────────────────────────────────────────────────────

function carregarBuffer(): Buffer {
  const midaBytes = MIDA_BITS / 8   // 2048 bytes
  if (existsSync(FITXER_BITSTRING)) {
    const buf = readFileSync(FITXER_BITSTRING)
    if (buf.length === midaBytes) return buf
    console.warn('[status-list] buffer corrupte, reinicialitzant')
  }
  return Buffer.alloc(midaBytes, 0)
}

function guardarBuffer(buf: Buffer): void {
  writeFileSync(FITXER_BITSTRING, buf)
}

// MSB first — especificació W3C §2.1
function coordenades(index: number): { byte: number; bit: number } {
  return { byte: Math.floor(index / 8), bit: 7 - (index % 8) }
}

export function llegirBit(index: number): 0 | 1 {
  if (index < 0 || index >= MIDA_BITS) throw new RangeError(`index fora de rang: ${index}`)
  const buf = carregarBuffer()
  const { byte, bit } = coordenades(index)
  return ((buf[byte] >> bit) & 1) as 0 | 1
}

export function revocarCredencial(index: number): void {
  if (index < 0 || index >= MIDA_BITS) throw new RangeError(`index fora de rang: ${index}`)
  const buf = carregarBuffer()
  const { byte, bit } = coordenades(index)
  buf[byte] |= (1 << bit)
  guardarBuffer(buf)
  console.log(`[status-list] OT índex ${index} marcada com a REVOCADA`)
}

export function restaurarCredencial(index: number): void {
  if (index < 0 || index >= MIDA_BITS) throw new RangeError(`index fora de rang: ${index}`)
  const buf = carregarBuffer()
  const { byte, bit } = coordenades(index)
  buf[byte] &= ~(1 << bit)
  guardarBuffer(buf)
  console.log(`[status-list] OT índex ${index} RESTAURADA (vàlida)`)
}

// ─── Serialització W3C ────────────────────────────────────────────────────────

export interface StatusListPayload {
  '@context':        string[]
  id:                string
  type:              string
  statusPurpose:     string
  encodedList:       string          // GZIP → base64url
  issuedAt:          string          // ISO 8601
  validUntil:        string          // ISO 8601 la llista caduca en 5 minuts
}

export function construirPayload(urlPublica: string): StatusListPayload {
  const buf         = carregarBuffer()
  const comprimida  = gzipSync(buf)
  const encodedList = comprimida.toString('base64url')

  return {
    '@context':    ['https://www.w3.org/ns/credentials/v2'],
    id:            `${urlPublica}/status-list`,
    type:          'BitstringStatusList',
    statusPurpose: 'revocation',
    encodedList,
    issuedAt:      new Date().toISOString(),
    validUntil:    new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }
}

// ─── Signatura i verificació ──────────────────────────────────────────────────

// JSON canònic: claus ordenades — garanteix que el verificador calcula el mateix hash
function canonicalitzar(obj: object): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

export interface StatusListSignat {
  payload:   StatusListPayload
  signature: string   // base64url, Ed25519 sobre canonicalitzar(payload)
}

export function signarStatusList(
  payload:    StatusListPayload,
  privateKey: string
): StatusListSignat {
  // Ed25519 a Node.js 20 usa sign() directament, no createSign()
  const data      = Buffer.from(canonicalitzar(payload), 'utf-8')
  const signature = sign(null, data, { key: privateKey, format: 'pem' }).toString('base64url')
  return { payload, signature }
}

export function verificarSignatura(
  signat:    StatusListSignat,
  publicKey: string
): boolean {
  try {
    const data = Buffer.from(canonicalitzar(signat.payload), 'utf-8')
    const sig  = Buffer.from(signat.signature, 'base64url')
    return verify(null, data, { key: publicKey, format: 'pem' }, sig)
  } catch {
    return false
  }
}

// ─── Descodificació (per al verificador) ─────────────────────────────────────

export function descodificarEncodedList(encodedList: string): Buffer {
  const comprimida = Buffer.from(encodedList, 'base64url')
  return gunzipSync(comprimida)
}

export function llegirBitDeBuffer(buf: Buffer, index: number): 0 | 1 {
  const { byte, bit } = coordenades(index)
  return ((buf[byte] >> bit) & 1) as 0 | 1
}