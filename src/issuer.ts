// arxiu: src/issuer.ts
// emissor de les Ordres de Treball (OT) — corre al portàtil A
// executa: npx tsx src/issuer.ts

import { FabricaAgents, AgentIndustrial } from './config/FabricaAgents'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'
import express, { Request, Response } from 'express'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { CRED_DEF_OT, PORT_OT, ENDPOINT_OT } from './configuracio'

const endpointPublic = ENDPOINT_OT

// fitxer on guardam els operaris registrats (connectionId <-> nom)
const FITXER_OPERARIS = path.join(process.cwd(), 'operaris.json')

interface Operari {
  nom: string
  connectionId: string
  registratEn: string
}

function llegirOperaris(): Operari[] {
  if (!existsSync(FITXER_OPERARIS)) return []
  return JSON.parse(readFileSync(FITXER_OPERARIS, 'utf-8'))
}

function guardarOperaris(llista: Operari[]): void {
  writeFileSync(FITXER_OPERARIS, JSON.stringify(llista, null, 2), 'utf-8')
}

// imprimeix QR al terminal — si no hi ha el paquet, imprimeix la URL i prou
async function imprimirQR(url: string): Promise<void> {
  try {
    const qr = await import('qrcode-terminal')
    qr.default.generate(url, { small: true })
  } catch {
    console.log('[qr no disponible — escaneja la URL directament]')
  }
  console.log(`\n📲 URL d'invitació:\n${url}\n`)
}

const main = async () => {
  console.log('================================================================')
  console.log('  EMISSOR OT — Servidor d\'Ordres de Treball')
  console.log('================================================================\n')

  // ─── 1. Arrencar agent emissor ────────────────────────────────────────────
  console.log(`--> [1/3] Arrencant agent emissor al port ${PORT_OT}...`)
console.log(`          Endpoint públic (Cloudflare): ${endpointPublic}\n`)
  const emissor: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-Autonomo-V13',
    'clave-maestra-V13',
    { port: PORT_OT, endpoints: [endpointPublic] }
  )
  await emissor.initialize()
  console.log('[ok] Agent emissor inicialitzat i escoltant.\n')

  // ─── 2. Comprovar que la CredDef existeix al ledger ───────────────────────
  console.log('--> [2/3] Comprovant CredDef al ledger...')
  const resultatCredDef = await emissor.modules.anoncreds.getCredentialDefinition(CRED_DEF_OT)
  if (!resultatCredDef.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no trobada: ${CRED_DEF_OT}`)
    console.error('             Executa setup.ts primer.')
    process.exit(1)
  }
  console.log(`[ok] CredDef verificada: ${CRED_DEF_OT}\n`)

  // ─── 3. Listeners d'events ────────────────────────────────────────────────

  // connexions noves sense nom assignat encara
  const pendents = new Set<string>()

  emissor.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      const registre = payload.connectionRecord
      if (registre.state === DidExchangeState.Completed) {
        console.log(`\n[connexió] ID: ${registre.id}`)
        const llista = llegirOperaris()
        const jaExisteix = llista.some((o) => o.connectionId === registre.id)
        if (!jaExisteix) {
          pendents.add(registre.id)
          console.log('  → connexió nova, pendent de posar nom al formulari web')
        } else {
          console.log('  → operari ja registrat')
        }
      }
    }
  )

  emissor.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const estat = payload.credentialRecord.state
      console.log(`  [cred] -> ${estat}`)
      if (estat === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  CREDENCIAL EMESA I ACCEPTADA PER L\'OPERARI!')
        console.log('================================================\n')
      }
    }
  )

  // ─── 4. Servidor Express (formulari web + API REST) ───────────────────────
  const app = express()
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))

  // llista completa d'operaris registrats
  app.get('/api/operaris', (_req: Request, res: Response) => {
    res.json(llegirOperaris())
  })

  // connexions noves sense nom assignat
  app.get('/api/pendents', (_req: Request, res: Response) => {
    res.json([...pendents])
  })

  // assignar nom a una connexió pendent
  app.post('/api/operaris', (req: Request, res: Response) => {
    const { connectionId, nom } = req.body as { connectionId: string; nom: string }
    if (!connectionId || !nom) {
      res.status(400).json({ error: 'falten camps: connectionId, nom' })
      return
    }
    const llista = llegirOperaris()
    if (llista.some((o) => o.connectionId === connectionId)) {
      res.status(409).json({ error: 'aquest connectionId ja està registrat' })
      return
    }
    llista.push({ nom, connectionId, registratEn: new Date().toISOString() })
    guardarOperaris(llista)
    pendents.delete(connectionId)
    console.log(`[directori] operari registrat: ${nom} → ${connectionId}`)
    res.json({ ok: true })
  })

  // emetre OT a un operari del directori
  // rep: connectionId, equip, tasca, data, riscos (string), certificacions (string)
  // riscos i certificacions vénen dels checkboxes del formulari serialitzats amb comes
  app.post('/api/emetre', async (req: Request, res: Response) => {
    const { connectionId, equip, tasca, data, riscos, certificacions } = req.body as {
      connectionId: string
      equip: string
      tasca: string
      data: string
      riscos: string
      certificacions: string
    }

    if (!connectionId || !equip || !tasca || !data) {
      res.status(400).json({ error: 'falten camps obligatoris: connectionId, equip, tasca, data' })
      return
    }

    const llista = llegirOperaris()
    if (!llista.some((o) => o.connectionId === connectionId)) {
      res.status(404).json({ error: 'operari no trobat al directori' })
      return
    }

    try {
      const idOrdre = `ORD-${Date.now()}`
      await emissor.credentials.offerCredential({
        connectionId,
        protocolVersion: 'v2',
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: CRED_DEF_OT,
            attributes: [
              { name: 'id_ordre',        value: idOrdre },
              { name: 'equip',           value: equip },
              { name: 'tasca',           value: tasca },
              { name: 'data',            value: data },
              // si no s'han marcat riscos o certificacions, guardam string buit
              { name: 'riscos',          value: riscos ?? '' },
              { name: 'certificacions',  value: certificacions ?? '' },
            ],
          },
        },
      })
      console.log(`[api] OT emesa → ${connectionId} | ${idOrdre} | riscos: ${riscos} | certs: ${certificacions}`)
      res.json({ ok: true, id_ordre: idOrdre })
    } catch (error) {
      console.error('[api error]', error)
      res.status(500).json({ error: 'error en emetre la credencial' })
    }
  })

  // el port web és el de DIDComm + 100 per no col·lisionar
  const PORT_WEB = PORT_OT + 100
  app.listen(PORT_WEB, () => {
    console.log(`[web] Formulari disponible a http://localhost:${PORT_WEB}\n`)
  })

  // ─── 5. Generar invitació OOB ─────────────────────────────────────────────
  console.log('--> [3/3] Generant invitació OOB...\n')

  const oob = await emissor.oob.createInvitation({
    label: 'Emissor Industrial: Rep la teva Ordre de Treball',
    multiUseInvitation: true,
  })

  const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointPublic })
  await imprimirQR(urlInvitacio)

  console.log('--> Servidor emissor escoltant. Ctrl+C per aturar.\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent emissor...')
    await emissor.shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})