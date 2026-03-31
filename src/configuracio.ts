// arxiu: src/configuracio.ts
// totes les constants de la infraestructura aquí
// si registres un schema nou o canvies de testnet, només toques aquest arxiu

// ─── Emissor OT (Oficina Tècnica) ────────────────────────────────────────────
export const DID_OT        = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM'
export const CRED_DEF_OT = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3152613/default'
// schema v1.1.0 — afegits camps 'riscos' i 'certificacions'
// després de fer setup.ts, actualitza CRED_DEF_OT amb el nou ID que imprimeix
export const SCHEMA_OT     = `${DID_OT}/anoncreds/v0/SCHEMA/Ordre-Manteniment/1.1.0`

// ─── Emissor ATEX (Directiva zones explosives) ────────────────────────────────
export const DID_ATEX      = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B'
export const CRED_DEF_ATEX = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152670/default'

// ─── Emissor Soldador (Escola d'homologació) ──────────────────────────────────
export const DID_SOLDADOR      = 'did:indy:bcovrin:test:S8RcstynVLEB2ynGpbwYRJ'
export const CRED_DEF_SOLDADOR = 'did:indy:bcovrin:test:S8RcstynVLEB2ynGpbwYRJ/anoncreds/v0/CLAIM_DEF/3152677/default'
// ─── Ports ────────────────────────────────────────────────────────────────────
export const PORT_OT       = 3001
export const PORT_VERIFICADOR = 3002
export const PORT_ATEX     = 3003
export const PORT_SOLDADOR = 3004