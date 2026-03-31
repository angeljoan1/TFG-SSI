// arxiu: src/verificador.ts
// punt de control d'accés SSI — corre al portàtil B
// executa: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/verificador.ts
//
// flux de verificació en dues rondes:
//   ronda 1 → demana només la OT (llegim riscos i certificacions)
//   ronda 2 → demana les credencials addicionals que toquin segons la OT
//   si la OT no requereix res addicional → accés concedit directament

import { FabricaAgents, AgentIndustrial } from './config/FabricaAgents'
import {
  ConnectionStateChangedEvent,
  ConnectionEventTypes,
  DidExchangeState,
  ProofStateChangedEvent,
  ProofEventTypes,
  ProofState,
  HandshakeProtocol,
} from '@credo-ts/core'
import express, { Request, Response } from 'express'
import path from 'path'
import {
  CRED_DEF_OT,
  CRED_DEF_ATEX,
  CRED_DEF_SOLDADOR,
  PORT_VERIFICADOR,
} from './configuracio'

const endpointNgrok = process.env.NGROK_ENDPOINT
if (!endpointNgrok) {
  console.error('ERROR: cal definir NGROK_ENDPOINT')
  console.error('exemple: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/verificador.ts')
  process.exit(1)
}

// epoch d'avui a mitjanit (en segons) — per comparar amb data_expiracio de les credencials
function avuiEnEpoch(): number {
  const avui = new Date()
  avui.setHours(0, 0, 0, 0)
  return Math.floor(avui.getTime() / 1000)
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

// estructura que el frontend pol·la per saber si hi ha un resultat nou
interface EsdevenimentVerificacio {
  ts: string
  valid: boolean
  attrs: Record<string, string>
  missing: string[]
}
let ultimEsdeveniment: EsdevenimentVerificacio | null = null
let urlInvitacio = ''

// ─── Estat entre rondes ───────────────────────────────────────────────────────
// quan acabam la ronda 1, guardam aquí els atributs de la OT i el timer del timeout
// per saber que la propera prova d'aquesta connexió és la ronda 2
interface EstatRonda {
  attrsOT: Record<string, string>
  timerId: ReturnType<typeof setTimeout>
}
const rondesPendents = new Map<string, EstatRonda>()
// connectionId → estat de la ronda 1 completada

// ─── Helpers de ProofRequest ──────────────────────────────────────────────────

// ronda 1: demana OT completa (equip, tasca, data, riscos, certificacions)
// data es revela per validar que és d'avui
function proofRequestRonda1(connectionId: string) {
  return {
    protocolVersion: 'v2' as const,
    connectionId,
    proofFormats: {
      anoncreds: {
        name: 'control-acces-ronda-1',
        version: '1.0',
        requested_attributes: {
          grup_equip:          { name: 'equip',          restrictions: [{ cred_def_id: CRED_DEF_OT }] },
          grup_tasca:          { name: 'tasca',          restrictions: [{ cred_def_id: CRED_DEF_OT }] },
          grup_data:           { name: 'data',           restrictions: [{ cred_def_id: CRED_DEF_OT }] },
          grup_riscos:         { name: 'riscos',         restrictions: [{ cred_def_id: CRED_DEF_OT }] },
          grup_certificacions: { name: 'certificacions', restrictions: [{ cred_def_id: CRED_DEF_OT }] },
        },
        requested_predicates: {},
      },
    },
  }
}

// ronda 2: construeix la ProofRequest dinàmicament segons el que diu la OT
// si riscos inclou 'ATEX' → demana zona i nivell_atex amb predicat d'expiració
// si certificacions inclou 'soldador' → demana proces i norma amb predicat d'expiració
function proofRequestRonda2(
  connectionId: string,
  riscos: string,
  certificacions: string
) {
  const atributs: Record<string, any> = {}
  const predicats: Record<string, any> = {}
  const epoch = avuiEnEpoch()

  if (riscos.toLowerCase().includes('atex')) {
    // revelam zona i nivell — id_cert i treballador no surten del wallet
    atributs.grup_zona       = { name: 'zona',       restrictions: [{ cred_def_id: CRED_DEF_ATEX }] }
    atributs.grup_nivell_atex = { name: 'nivell_atex', restrictions: [{ cred_def_id: CRED_DEF_ATEX }] }
    // predicat criptogràfic: data_expiracio >= avui (el wallet ho prova sense revelar la data)
    predicats.atex_no_caducat = {
      name: 'data_expiracio',
      p_type: '>=',
      p_value: epoch,
      restrictions: [{ cred_def_id: CRED_DEF_ATEX }],
    }
  }

  if (certificacions.toLowerCase().includes('soldador')) {
    atributs.grup_proces = { name: 'proces', restrictions: [{ cred_def_id: CRED_DEF_SOLDADOR }] }
    atributs.grup_norma  = { name: 'norma',  restrictions: [{ cred_def_id: CRED_DEF_SOLDADOR }] }
    // igual — prova que no ha caducat sense revelar la data exacta
    predicats.soldador_no_caducat = {
      name: 'data_expiracio',
      p_type: '>=',
      p_value: epoch,
      restrictions: [{ cred_def_id: CRED_DEF_SOLDADOR }],
    }
  }

  return {
    protocolVersion: 'v2' as const,
    connectionId,
    proofFormats: {
      anoncreds: {
        name: 'control-acces-ronda-2',
        version: '1.0',
        requested_attributes: atributs,
        requested_predicates: predicats,
      },
    },
  }
}

// ─── Helpers de neteja ────────────────────────────────────────────────────────

async function regenerarInvitacio(verificador: AgentIndustrial): Promise<void> {
  const nouOob = await verificador.oob.createInvitation({
    label: 'Control d\'Accés — Planta Industrial',
    multiUseInvitation: true,
    handshakeProtocols: [HandshakeProtocol.DidExchange],
  })
  urlInvitacio = nouOob.outOfBandInvitation.toUrl({ domain: endpointNgrok! })
  console.log('[oob] nova invitació generada, llest per al següent operari')
}

async function tancarConnexio(verificador: AgentIndustrial, connectionId: string): Promise<void> {
  try {
    await verificador.connections.deleteById(connectionId)
    console.log('[connexió] eliminada, llest per al següent operari')
  } catch {
    // pot haver estat eliminada ja pel timeout — no és un error greu
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('================================================================')
  console.log('--> VERIFICADOR SSI v2.0 (ZKP dinàmic — dues rondes)')
  console.log('================================================================\n')

  // ── 1. Inicialitzar agent verificador ─────────────────────────────────────
  console.log('--> [1/4] Inicialitzant agent Verificador...')
  const verificador: AgentIndustrial = await FabricaAgents.crear(
    'Verificador-Acceso-V1',
    'clave-verificador-V1',
    { port: PORT_VERIFICADOR, endpoints: [endpointNgrok] }
  )
  await verificador.initialize()
  console.log(`[ok] Agent inicialitzat. Escoltant al port ${PORT_VERIFICADOR}.`)
  console.log(`[ok] Endpoint públic: ${endpointNgrok}\n`)

  // ── 2. Listener de proves — aquí és on passa tota la màgia ───────────────
  console.log('--> [2/4] Registrant listener de proves ZKP...')

  verificador.events.on<ProofStateChangedEvent>(
    ProofEventTypes.ProofStateChanged,
    async ({ payload }) => {
      const { proofRecord } = payload
      const connId = proofRecord.connectionId

      if (proofRecord.state === ProofState.RequestSent) {
        console.log('\n[prova] sol·licitud enviada a l\'operari')
        console.log(`        ID sessió: ${proofRecord.id}`)
      }

      if (proofRecord.state === ProofState.PresentationReceived) {
        console.log('\n[prova] presentació ZKP rebuda, verificant...')
      }

      if (proofRecord.state === ProofState.Done) {
        const esValida = proofRecord.isVerified

        // extreure atributs revelats de la prova
        const attrs: Record<string, string> = {}
        try {
          const dadesProva = await verificador.proofs.getFormatData(proofRecord.id)
          const attrsRevelats =
            dadesProva.presentation?.anoncreds?.requested_proof?.revealed_attrs ?? {}
          for (const [k, v] of Object.entries(attrsRevelats)) {
            attrs[k] = (v as any).raw
          }
        } catch {}

        // ── és ronda 1? ──────────────────────────────────────────────────────
        if (!rondesPendents.has(connId!)) {

          if (!esValida) {
            // la OT en si no és vàlida — denegam directament
            console.log('\n❌ ACCÉS DENEGAT — OT invàlida o no presentada')
            ultimEsdeveniment = {
              ts: new Date().toISOString(),
              valid: false,
              attrs: {},
              missing: ['Ordre de Treball'],
            }
            if (connId) await tancarConnexio(verificador, connId)
            await regenerarInvitacio(verificador)
            return
          }

          // validar que la OT és d'avui
          const avui = new Date().toISOString().split('T')[0]
          if (attrs['grup_data'] !== avui) {
            console.log(`\n❌ ACCÉS DENEGAT — OT caducada (data: ${attrs['grup_data']}, avui: ${avui})`)
            ultimEsdeveniment = {
              ts: new Date().toISOString(),
              valid: false,
              attrs,
              missing: ['Ordre de Treball caducada — no és del dia d\'avui'],
            }
            if (connId) await tancarConnexio(verificador, connId)
            await regenerarInvitacio(verificador)
            return
          }

          const riscos = attrs['grup_riscos'] ?? ''
          const certificacions = attrs['grup_certificacions'] ?? ''

          // si la OT no requereix res addicional → accés concedit aquí mateix
          const necessitaRonda2 =
            riscos.toLowerCase().includes('atex') ||
            certificacions.toLowerCase().includes('soldador')

          if (!necessitaRonda2) {
            console.log('\n✅ ACCÉS CONCEDIT — OT vàlida, sense requisits addicionals')
            ultimEsdeveniment = { ts: new Date().toISOString(), valid: true, attrs, missing: [] }
            if (connId) await tancarConnexio(verificador, connId)
            await regenerarInvitacio(verificador)
            return
          }

          // guardar estat ronda 1 i llançar ronda 2
          console.log(`\n[ronda 1 ok] riscos: "${riscos}" | certs: "${certificacions}"`)
          console.log('[ronda 2] demanant credencials addicionals...')

          // el timeout de la ronda 2: si en 45s no arriba, netejam
          // cancel·lam el timer quan arriba la ronda 2 correctament
          const timerId = setTimeout(async () => {
            if (rondesPendents.has(connId!)) {
              console.log(`[timeout ronda 2] connexió ${connId} sense resposta, netejant`)
              rondesPendents.delete(connId!)
              if (connId) await tancarConnexio(verificador, connId)
              await regenerarInvitacio(verificador)
            }
            // si ja no hi és al map, vol dir que la ronda 2 ja ha acabat bé — no fem res
          }, 45_000)

          rondesPendents.set(connId!, { attrsOT: attrs, timerId })

          try {
            await verificador.proofs.requestProof(
              proofRequestRonda2(connId!, riscos, certificacions)
            )
            console.log('[prova] sol·licitud ronda 2 enviada, esperant ZKP...')
          } catch (error) {
            console.error('[error] en enviar ronda 2:', error)
            rondesPendents.delete(connId!)
            clearTimeout(timerId)
            if (connId) await tancarConnexio(verificador, connId)
            await regenerarInvitacio(verificador)
          }

          return
        }

        // ── és ronda 2 ───────────────────────────────────────────────────────
        const estatRonda = rondesPendents.get(connId!)!
        clearTimeout(estatRonda.timerId) // cancel·lam el timeout, ha arribat a temps
        rondesPendents.delete(connId!)

        // combinar atributs de les dues rondes per al frontend
        const attrsComplets = { ...estatRonda.attrsOT, ...attrs }

        if (esValida) {
          console.log('\n✅ ACCÉS CONCEDIT — totes les credencials vàlides (ZKP)')
          ultimEsdeveniment = {
            ts: new Date().toISOString(),
            valid: true,
            attrs: attrsComplets,
            missing: [],
          }
        } else {
          console.log('\n❌ ACCÉS DENEGAT — credencials addicionals invàlides o absents')
          // intentam esbrinar quines falten
          const falten: string[] = []
          const revelats = Object.keys(attrs)
          if (estatRonda.attrsOT['grup_riscos']?.toLowerCase().includes('atex')) {
            if (!revelats.includes('grup_zona') || !revelats.includes('grup_nivell_atex'))
              falten.push('Certificat ATEX — credencial absent')
            else
              falten.push('Certificat ATEX — credencial caducada')
          }
          if (estatRonda.attrsOT['grup_certificacions']?.toLowerCase().includes('soldador')) {
            if (!revelats.includes('grup_proces') || !revelats.includes('grup_norma'))
              falten.push('Homologació Soldador — credencial absent')
            else
              falten.push('Homologació Soldador — credencial caducada')
          }
          ultimEsdeveniment = {
            ts: new Date().toISOString(),
            valid: false,
            attrs: attrsComplets,
            missing: falten,
          }
          console.log('[motiu] falten:', falten)
        }

        if (connId) await tancarConnexio(verificador, connId)
        await regenerarInvitacio(verificador)
      }

      if (proofRecord.state === ProofState.Declined) {
        console.log('\n[prova] l\'operari ha rebutjat presentar la prova')
        console.log('        accés denegat\n')
        // no netejam la connexió aquí — pot ser que sigui el Decline de la ronda 1
        // i volem que pugui tornar a intentar-ho sense desconnectar-se
      }
    }
  )

  console.log('[ok] Listener actiu.\n')

  // ── 3. Servidor Express — API per al panel web ────────────────────────────
  const app = express()
  app.use(express.static(path.join(__dirname, '..', 'public-verifier')))

  // el frontend pol·la aquest endpoint per saber si hi ha resultat nou
  app.get('/api/estat', (_req: Request, res: Response) => {
    res.json(ultimEsdeveniment)
  })

  // el frontend demana el QR actual per mostrar-lo
  app.get('/api/qr', (_req: Request, res: Response) => {
    res.json({ url: urlInvitacio })
  })

  const PORT_WEB = PORT_VERIFICADOR + 100
  app.listen(PORT_WEB, () => {
    console.log(`[web] Panel d'accés a http://localhost:${PORT_WEB}\n`)
  })

  // ── 4. Generar invitació OOB inicial ──────────────────────────────────────
  const oobInicial = await verificador.oob.createInvitation({
    label: 'Control d\'Accés — Planta Industrial',
    multiUseInvitation: true,
    handshakeProtocols: [HandshakeProtocol.DidExchange],
  })
  urlInvitacio = oobInicial.outOfBandInvitation.toUrl({ domain: endpointNgrok })
  await imprimirQR(urlInvitacio)

  // ── 5. Listener de connexions — quan l'operari escaneja el QR ────────────
  verificador.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      const connexio = payload.connectionRecord
      if (connexio.state !== DidExchangeState.Completed) return

      console.log(`\n[connexió] ✓ operari connectat. ID: ${connexio.id}`)
      console.log('[ronda 1] demanant Ordre de Treball...')

      try {
        await verificador.proofs.requestProof(proofRequestRonda1(connexio.id))
        console.log('[prova] sol·licitud ronda 1 enviada, esperant ZKP...')
      } catch (error) {
        console.error('[error] en enviar ronda 1:', error)
        await tancarConnexio(verificador, connexio.id)
        await regenerarInvitacio(verificador)
        return
      }

      // timeout ronda 1: si en 30s no arriba la OT, netejam
      // compte — si la ronda 1 acaba bé, el seu Done ja gestiona tot
      // aquest timeout és per si l'operari no fa res (se'n va sense presentar)
      const timerId = setTimeout(async () => {
        // si ja hi ha una ronda 2 pendent per aquesta connexió, no fem res
        // vol dir que la ronda 1 ja ha acabat i la ronda 2 té el seu propi timeout
        if (rondesPendents.has(connexio.id)) return

        // comprovam si la connexió segueix oberta (pot ser que ja s'hagi tancat)
        try {
          await verificador.connections.getById(connexio.id)
          // si arriba aquí, la connexió segueix oberta i no ha presentat res
          console.log(`[timeout ronda 1] connexió ${connexio.id} sense resposta, netejant`)
          await tancarConnexio(verificador, connexio.id)
          await regenerarInvitacio(verificador)
        } catch {
          // la connexió ja no existeix — algú ja l'ha tancada, no fem res
        }
      }, 30_000)

      // guardam el timer per si el volem cancel·lar (de moment no cal,
      // el ProofState.Done de ronda 1 va prou ràpid)
      // si en el futur cal cancel·lar-lo, afegir un Map<connId, timer> aquí
    }
  )

  console.log('--> [3/4] Llest. QR generat, esperant operaris...\n')
  console.log('================================================================')
  console.log('--> Sistema actiu. Ctrl+C per aturar.')
  console.log('================================================================\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent verificador...')
    await verificador.shutdown()
    console.log('[ok] Agent tancat. Fins aviat.')
    process.exit(0)
  })
}

main()