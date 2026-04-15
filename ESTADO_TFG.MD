# PROJECTE: TFG - Arquitectura SSI Industrial

## 1. Stack Tecnològic
* **Entorn:** WSL (Ubuntu) sobre Windows 10/11
* **Motor:** Node.js v20.x
* **Execució:** TypeScript amb `tsx` (`npx tsx` o `./node_modules/.bin/tsx`)
* **Framework SSI:** `@credo-ts` (^0.5.x)
* **Motor Criptogràfic:** `@hyperledger/anoncreds-nodejs` (^0.3.4)
* **IDE:** Cursor connectat a WSL

## 2. Topologia de Xarxa
* **Blockchain:** BCovrin Testnet (Identitats Indy)
* **Túnel:** ngrok (dues comptes independents — Issuer port 3001, Verificador port 3002)
* **Wallet Operari:** BC Wallet (Govern de British Columbia, basat en Bifold/Credo)
* **Mediador DIDComm:** `mediator.digitaltrust.gov.bc.ca`

## 3. Infraestructura Registrada a BCovrin

### Issuer 1 — Oficina Tècnica (Ordre de Treball)
- **Wallet:** Servidor-Autonomo-V13 / clave-maestra-V13
- **DID:** did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM
- **Schema:** Ordre-Manteniment v1.2.0 — atributs: id_ordre, equip, tasca, data, riscos, certificacions, revocation_index
- **CredDef ID:** did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3159509/default
- **Port emissor:** 3001

### Issuer 2 — Directiva ATEX
- **Wallet:** Servidor-ATEX-V1 / clave-maestra-ATEX-V1
- **DID:** did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B
- **Schema:** Certificat-ATEX v1.0.0 — atributs: id_cert, treballador, zona, nivell_atex, data_expiracio
- **CredDef ID:** did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152670/default
- **Port emissor:** 3003

### Issuer 3 — Escola de Soldadors
- **Wallet:** Servidor-Soldador-V1 / clave-maestra-Soldador-V1
- **DID:** did:indy:bcovrin:test:BHjxHoWTyspfzk4jeevS7w
- **Schema:** Homologacio-Soldador v1.0.0 — atributs: id_cert, treballador, proces, norma, data_expiracio
- **CredDef ID:** did:indy:bcovrin:test:BHjxHoWTyspfzk4jeevS7w/anoncreds/v0/CLAIM_DEF/3152687/default
- **Port emissor:** 3004

### Verificador — Control d'Accés
- **Wallet:** Verificador-Acceso-V1 / clave-verificador-V1
- **Port:** 3002
- **Flux:** dues rondes dinàmiques (veure secció 5)

## 4. Arxius del Projecte
* `src/config/FabricaAgents.ts` — Factoria d'agents Credo amb transport HTTP i mòduls DIDComm
* `src/configuracio.ts` — Totes les constants d'infraestructura (DIDs, CredDefs, ports)
* `src/setup.ts` — Registra DID + Schema + CredDef OT a BCovrin (idempotent)
* `src/setupAtex.ts` — Registra DID + Schema + CredDef ATEX a BCovrin (idempotent)
* `src/setupSoldador.ts` — Registra DID + Schema + CredDef Soldador a BCovrin (idempotent)
* `src/issuer.ts` — Servidor emissor OT amb formulari web, directori d'operaris
* `src/issuerAtex.ts` — Servidor emissor ATEX (permanent, multi-ús)
* `src/issuerSoldador.ts` — Servidor emissor Soldador (permanent, multi-ús)
* `src/verificador.ts` — Control d'accés: ZKP dinàmic en dues rondes
* `public/index.html` — Formulari web d'emissió d'OT (Portàtil A)
* `public-verifier/index.html` — Panel de control d'accés (Portàtil B)
* `operaris.json` — Directori d'operaris registrats (NO versionar)

## 5. Flux de Verificació — Dues Rondes Dinàmiques
**Ronda 1:** El verificador demana la OT completa (equip, tasca, data, riscos, certificacions)
- Si la data no és d'avui → ACCÉS DENEGAT
- Si riscos i certificacions estan buits → ACCÉS CONCEDIT directament

**Ronda 2** (només si la OT ho requereix):
- `riscos` conté "atex" → demana zona + nivell_atex + predicat `data_expiracio >= avui`
- `certificacions` conté "soldador" → demana proces + norma + predicat `data_expiracio >= avui`
- Els predicats són ZKP purs: el wallet prova que no ha caducat sense revelar la data exacta

## 6. Estat d'Implementació

| Fase | Estat |
|------|-------|
| Infraestructura — DID, Schema, CredDef × 3 issuers | ✅ Completat |
| Emisió OT — formulari web, directori operaris | ✅ Completat |
| Emissió ATEX — issuer permanent | ✅ Completat |
| Emissió Soldador — issuer permanent | ✅ Completat |
| Verificació dinàmica — dues rondes ZKP | ✅ Completat |
| Predicats d'expiració criptogràfics (ATEX + Soldador) | ✅ Completat |
| Validació data OT (ha de ser del dia) | ✅ Completat |
| Panel web verificador — QR + resultat verd/vermell | ✅ Completat |
| Formulari web emissor OT | ✅ Completat |
| Memòria del TFG | 🔄 En curs |

## 7. Casos de Prova Validats
| Cas | Resultat |
|-----|---------|
| OT vàlida sense riscos | ✅ Accés concedit |
| OT + ATEX + Soldador vàlids | ✅ Accés concedit |
| OT + ATEX sense Soldador | ✅ Accés concedit |
| OT d'un altre dia | ❌ Accés denegat |
| OT requereix certs, no els té | ❌ Accés denegat |
| Credencial caducada | ❌ BC Wallet rebutja presentar |

## 8. Notes Operatives
* **Setup (una vegada):** `npx tsx src/setup.ts` · `npx tsx src/setupAtex.ts` · `npx tsx src/setupSoldador.ts`
* **Emissor OT:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuer.ts`
* **Emissor ATEX:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerAtex.ts`
* **Emissor Soldador:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerSoldador.ts`
* **Verificador:** `NGROK_ENDPOINT=https://yyy.ngrok-free.app npx tsx src/verificador.ts`
* **Instal·lació WSL nova:** `npm install --ignore-scripts && npm rebuild` + `appendWindowsPath = false` a `/etc/wsl.conf`
* **Risc BCovrin:** Executar `setup*.ts` 15 minuts abans de la defensa. Pla B: VON Network local (Docker)
* **Estratègia demo defensa:** ATEX i Soldador emesos a casa prèviament. En viu: OT (port 3001) + Verificador (port 3002) en dos portàtils amb dues comptes ngrok independents