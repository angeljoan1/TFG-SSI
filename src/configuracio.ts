// arxiu: src/configuracio.ts
// totes les constants de la infraestructura aquí
// si registres un schema nou o canvies de testnet, només toques aquest arxiu

// ─── Emissor OT (Oficina Tècnica) ────────────────────────────────────────────
export const DID_OT        = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM'
export const CRED_DEF_OT = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3159509/default'
// schema v1.1.0 — afegits camps 'riscos' i 'certificacions'
// després de fer setup.ts, actualitza CRED_DEF_OT amb el nou ID que imprimeix
export const SCHEMA_OT   = `${DID_OT}/anoncreds/v0/SCHEMA/Ordre-Manteniment/1.2.0`

// ─── Emissor ATEX (Directiva zones explosives) ────────────────────────────────
export const DID_ATEX      = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B'
export const CRED_DEF_ATEX = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152670/default'

// ─── Emissor Soldador (Escola d'homologació) ──────────────────────────────────
export const DID_SOLDADOR      = 'did:indy:bcovrin:test:BHjxHoWTyspfzk4jeevS7w'
export const CRED_DEF_SOLDADOR = 'did:indy:bcovrin:test:BHjxHoWTyspfzk4jeevS7w/anoncreds/v0/CLAIM_DEF/3152687/default'

// ─── Ports ────────────────────────────────────────────────────────────────────
export const PORT_OT       = 3011
export const PORT_VERIFICADOR = 3002
export const PORT_ATEX     = 3003
export const PORT_SOLDADOR = 3004

// ─── Endpoints públics (Cloudflare Tunnels) ───────────────────────────────────
export const ENDPOINT_OT      = 'https://ot-didcomm.angeljoan.com'  // wallet connecta aquí
export const ENDPOINT_OT_WEB  = 'https://ot.angeljoan.com'          // status-list i formulari
export const ENDPOINT_VERIFICADOR = 'https://acces.angeljoan.com'
export const ENDPOINT_ATEX     = 'https://atex.angeljoan.com'
export const ENDPOINT_SOLDADOR = 'https://soldador.angeljoan.com'

// ─── Revocació (Fase 2) ───────────────────────────────────────────────────────
export const STATUS_LIST_URL = 'https://ot.angeljoan.com/status-list'

// clau pública Ed25519 de l'emissor OT ancorada al codi del verificador
// evita que el cercle de confiança depengui del mateix servidor que emet la llista
// en producció vindria del DID Document de l'emissor resolt a la blockchain
export const STATUS_LIST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/X6JsShlqxyhhcxxoAcOeN2s8cHEOTg3SZYma/QXQbs=
-----END PUBLIC KEY-----`

