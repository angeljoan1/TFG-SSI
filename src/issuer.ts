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
import { CRED_DEF_OT, PORT_OT, ENDPOINT_OT, ENDPOINT_OT_WEB } from './configuracio'
import { carregarOGenerarClau, construirPayload, signarStatusList, revocarCredencial, restaurarCredencial } from './statusList'

const endpointPublic = ENDPOINT_OT

// clau de signatura Ed25519 — es genera una vegada i es reutilitza
const clauSignatura = carregarOGenerarClau()

// fitxer on guardam els operaris registrats
const FITXER_OPERARIS = path.join(process.cwd(), 'operaris.json')

// cada OT té el seu propi índex al bitstring — un operari pot tenir-ne moltes
interface OTEmesa {
  id:               string
  revocation_index: number
  emesaEn:          string
}

// l'operari ja no té revocation_index propi — cada OT el té
interface Operari {
  nom:          string
  connectionId: string
  registratEn:  string
  ot_ids:       OTEmesa[]
}

function llegirOperaris(): Operari[] {
  if (!existsSync(FITXER_OPERARIS)) return []
  return JSON.parse(readFileSync(FITXER_OPERARIS, 'utf-8'))
}

function guardarOperaris(llista: Operari[]): void {
  writeFileSync(FITXER_OPERARIS, JSON.stringify(llista, null, 2), 'utf-8')
}

// retorna el següent índex global disponible — busca el màxim entre totes les OT de tots els operaris
function propIndexRevocacio(): number {
  const llista = llegirOperaris()
  const totsEls = llista.flatMap(o => o.ot_ids.map(ot => ot.revocation_index))
  if (totsEls.length === 0) return 0
  return Math.max(...totsEls) + 1
}

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
    process.env.WALLET_KEY_OT ?? 'clave-maestra-V13',
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

  // ─── 4. Servidor Express ──────────────────────────────────────────────────
  const app = express()
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.get('/api/operaris', (_req: Request, res: Response) => {
    res.json(llegirOperaris())
  })

  app.get('/api/pendents', (_req: Request, res: Response) => {
    res.json([...pendents])
  })

  // registrar operari — ja NO s'assigna revocation_index aquí
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
    llista.push({
      nom,
      connectionId,
      registratEn: new Date().toISOString(),
      ot_ids:      [],
    })
    guardarOperaris(llista)
    pendents.delete(connectionId)
    console.log(`[directori] operari registrat: ${nom} → ${connectionId}`)
    res.json({ ok: true })
  })

  // emetre OT — s'assigna un índex de revocació únic per aquesta OT
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
      const idOrdre        = `ORD-${Date.now()}`
      const revocationIndex = propIndexRevocacio()  // índex únic per aquesta OT

      await emissor.credentials.offerCredential({
        connectionId,
        protocolVersion: 'v2',
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: CRED_DEF_OT,
            attributes: [
              { name: 'id_ordre',         value: idOrdre },
              { name: 'equip',            value: equip },
              { name: 'tasca',            value: tasca },
              { name: 'data',             value: data },
              { name: 'riscos',           value: riscos ?? '' },
              { name: 'certificacions',   value: certificacions ?? '' },
              { name: 'revocation_index', value: String(revocationIndex) },
            ],
          },
        },
      })

      // guardar la OT amb el seu índex propi al directori
      const llistaActualitzada = llegirOperaris()
      const idx = llistaActualitzada.findIndex(o => o.connectionId === connectionId)
      if (idx !== -1) {
        llistaActualitzada[idx].ot_ids.push({
          id:               idOrdre,
          revocation_index: revocationIndex,
          emesaEn:          new Date().toISOString(),
        })
        guardarOperaris(llistaActualitzada)
      }

      console.log(`[api] OT emesa → ${idOrdre} | operari: ${connectionId} | índex revocació: ${revocationIndex}`)
      res.json({ ok: true, id_ordre: idOrdre, revocation_index: revocationIndex })
    } catch (error) {
      console.error('[api error]', error)
      res.status(500).json({ error: 'error en emetre la credencial' })
    }
  })

  // ─── Endpoints de revocació ───────────────────────────────────────────────

  // W3C BitstringStatusList — el verificador fa fetch aquí
  app.get('/status-list', (_req: Request, res: Response) => {
    const payload = construirPayload(ENDPOINT_OT_WEB)
    const signat  = signarStatusList(payload, clauSignatura.privateKeyPem)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-cache')
    res.json(signat)
  })

  // clau pública per al verificador
  app.get('/status-list/public-key', (_req: Request, res: Response) => {
    res.json({ publicKeyPem: clauSignatura.publicKeyPem })
  })

  // revocar una OT per id_ordre — cerca l'índex i activa el bit corresponent
  app.post('/api/revocar', (req: Request, res: Response) => {
    const { id_ordre } = req.body as { id_ordre: string }
    if (!id_ordre) {
      res.status(400).json({ error: 'falta id_ordre' })
      return
    }
    const llista = llegirOperaris()
    let indexTrobat: number | null = null
    let nomOperari = ''
    for (const operari of llista) {
      const ot = operari.ot_ids.find(o => o.id === id_ordre)
      if (ot) {
        indexTrobat = ot.revocation_index
        nomOperari  = operari.nom
        break
      }
    }
    if (indexTrobat === null) {
      res.status(404).json({ error: `OT no trobada: ${id_ordre}` })
      return
    }
    try {
      revocarCredencial(indexTrobat)
      console.log(`[api] OT revocada — id: ${id_ordre} | operari: ${nomOperari} | índex: ${indexTrobat}`)
      res.json({ ok: true, id_ordre, revocation_index: indexTrobat, operari: nomOperari })
    } catch (error) {
      res.status(400).json({ error: String(error) })
    }
  })

  // restaurar una OT per id_ordre (per a proves / error administratiu)
  app.post('/api/restaurar', (req: Request, res: Response) => {
    const { id_ordre } = req.body as { id_ordre: string }
    if (!id_ordre) {
      res.status(400).json({ error: 'falta id_ordre' })
      return
    }
    const llista = llegirOperaris()
    let indexTrobat: number | null = null
    for (const operari of llista) {
      const ot = operari.ot_ids.find(o => o.id === id_ordre)
      if (ot) { indexTrobat = ot.revocation_index; break }
    }
    if (indexTrobat === null) {
      res.status(404).json({ error: `OT no trobada: ${id_ordre}` })
      return
    }
    try {
      restaurarCredencial(indexTrobat)
      console.log(`[api] OT restaurada — id: ${id_ordre} | índex: ${indexTrobat}`)
      res.json({ ok: true, id_ordre, revocation_index: indexTrobat })
    } catch (error) {
      res.status(400).json({ error: String(error) })
    }
  })

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