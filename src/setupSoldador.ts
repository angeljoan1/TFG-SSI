// arxiu: src/setupSoldador.ts
// emet l'homologació de soldador a la teva wallet personal (una vegada i prou)
// executa: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/setupSoldador.ts
// un cop tens la credencial al BC Wallet no cal tornar-lo a executar

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
  console.error('exemple: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/setupSoldador.ts')
  process.exit(1)
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
  console.log('  SETUP SOLDADOR — Emissió de l\'homologació a la wallet personal')
  console.log('================================================================\n')

  console.log(`--> [1/3] Arrencant agent Soldador al port ${PORT_SOLDADOR}...`)
  console.log(`          Endpoint públic: ${endpointNgrok}\n`)

  const agentSoldador: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-Soldador-V1',
    'clave-maestra-Soldador-V1',
    { port: PORT_SOLDADOR, endpoints: [endpointNgrok] }
  )
  await agentSoldador.initialize()
  console.log('[ok] Agent Soldador inicialitzat.\n')

  console.log('--> [2/3] Comprovant CredDef Soldador al ledger...')
  const resultatCredDef = await agentSoldador.modules.anoncreds.getCredentialDefinition(CRED_DEF_SOLDADOR)
  if (!resultatCredDef.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no trobada: ${CRED_DEF_SOLDADOR}`)
    console.error('             Comprova que la infraestructura Soldador està registrada a BCovrin.')
    process.exit(1)
  }
  console.log('[ok] CredDef Soldador verificada.\n')

  // quan escanegis el QR amb el BC Wallet, s'emet automàticament
  agentSoldador.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const idConnexio = payload.connectionRecord.id
        console.log(`\n[connexió] ID: ${idConnexio}`)
        console.log('  enviant homologació de soldador...\n')

        try {
          await agentSoldador.credentials.offerCredential({
            connectionId: idConnexio,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_SOLDADOR,
                attributes: [
                  { name: 'id_cert',          value: `SOLD-${Date.now()}` },
                  { name: 'trabajador',        value: 'Operario-Demo' },
                  { name: 'proceso',           value: 'SMAW' },
                  { name: 'norma',             value: 'EN ISO 9606-1' },
                  { name: 'fecha_expiracion',  value: '2031-12-31' },
                ],
              },
            },
          })
          console.log('[ok] Oferta Soldador enviada. Accepta-la al BC Wallet...')
        } catch (error) {
          console.error('[error] en emetre credencial Soldador:', error)
        }
      }
    }
  )

  agentSoldador.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const estat = payload.credentialRecord.state
      console.log(`  [cred soldador] -> ${estat}`)
      if (estat === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  HOMOLOGACIÓ SOLDADOR EMESA I ACCEPTADA!')
        console.log('  Ja pots aturar el servidor amb Ctrl+C')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generant invitació OOB...\n')
  const oob = await agentSoldador.oob.createInvitation({
    label: 'Escola de Soldadors: Rep la teva Homologació',
    multiUseInvitation: true,
  })

  const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointNgrok })
  await imprimirQR(urlInvitacio)

  console.log('--> Escaneja el QR amb BC Wallet. Ctrl+C per aturar.\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent Soldador...')
    await agentSoldador.shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})