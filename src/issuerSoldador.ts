// arxiu: src/issuerSoldador.ts
// emissor de l'homologació de soldador
// executa: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerSoldador.ts
// normalment s'emet a casa abans de la demo — no cal tenir-lo encès a la defensa

import { FabricaAgents, AgentIndustrial } from './config/FabricaAgents'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'
import { CRED_DEF_SOLDADOR, PORT_SOLDADOR } from './configuracio'

const endpointNgrok = process.env.NGROK_ENDPOINT
if (!endpointNgrok) {
  console.error('ERROR: cal definir NGROK_ENDPOINT')
  console.error('exemple: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/issuerSoldador.ts')
  process.exit(1)
}

// data d'expiració en unix timestamp (segons) — el verificador fa predicat >= avui
// 2026-12-31 en epoch
const DATA_EXPIRACIO_SOLDADOR = Math.floor(new Date('2026-12-31').getTime() / 1000).toString()

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
  console.log('  EMISSOR SOLDADOR — Escola d\'Homologació de Soldadors')
  console.log('================================================================\n')

  console.log(`--> [1/3] Arrencant agent Soldador al port ${PORT_SOLDADOR}...`)
  console.log(`          Endpoint públic: ${endpointNgrok}\n`)

  const emissorSoldador: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-Soldador-V1',
    'clave-maestra-Soldador-V1',
    { port: PORT_SOLDADOR, endpoints: [endpointNgrok] }
  )
  await emissorSoldador.initialize()
  console.log('[ok] Agent Soldador inicialitzat.\n')

  console.log('--> [2/3] Comprovant CredDef Soldador al ledger...')
  const resultatCredDef = await emissorSoldador.modules.anoncreds.getCredentialDefinition(CRED_DEF_SOLDADOR)
  if (!resultatCredDef.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no trobada: ${CRED_DEF_SOLDADOR}`)
    console.error('             Executa setupSoldador.ts primer.')
    process.exit(1)
  }
  console.log('[ok] CredDef Soldador verificada.\n')

  // quan l'operari es connecta, li enviam l'homologació automàticament
  emissorSoldador.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const idConnexio = payload.connectionRecord.id
        console.log(`\n[connexió] ID: ${idConnexio}`)
        console.log('  enviant homologació de soldador...\n')

        try {
          await emissorSoldador.credentials.offerCredential({
            connectionId: idConnexio,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_SOLDADOR,
                attributes: [
                  { name: 'id_cert',        value: `SOLD-${Date.now()}` },
                  { name: 'treballador',    value: 'Operari-Demo' },
                  { name: 'proces',         value: 'SMAW' },
                  { name: 'norma',          value: 'EN ISO 9606-1' },
                  // epoch en string — el verificador fa predicat >= avui
                  { name: 'data_expiracio', value: DATA_EXPIRACIO_SOLDADOR },
                ],
              },
            },
          })
          console.log('[ok] Oferta Soldador enviada. Esperant acceptació...')
        } catch (error) {
          console.error('[error] en emetre credencial Soldador:', error)
        }
      }
    }
  )

  emissorSoldador.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const estat = payload.credentialRecord.state
      console.log(`  [cred soldador] -> ${estat}`)
      if (estat === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  HOMOLOGACIÓ SOLDADOR EMESA I ACCEPTADA!')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generant invitació OOB Soldador...\n')
  const oob = await emissorSoldador.oob.createInvitation({
    label: 'Escola de Soldadors: Rep la teva Homologació',
    multiUseInvitation: true,
  })

  const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointNgrok })
  await imprimirQR(urlInvitacio)

  console.log('--> Servidor Soldador escoltant. Ctrl+C per aturar.\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent Soldador...')
    await emissorSoldador.shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})
