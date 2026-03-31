// arxiu: src/setupAtex.ts
// emet el certificat ATEX a la teva wallet personal (una vegada i prou)
// executa: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/setupAtex.ts
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
import { CRED_DEF_ATEX, PORT_ATEX } from './configuracio'

const endpointNgrok = process.env.NGROK_ENDPOINT
if (!endpointNgrok) {
  console.error('ERROR: cal definir NGROK_ENDPOINT')
  console.error('exemple: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/setupAtex.ts')
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
  console.log('  SETUP ATEX — Emissió del certificat a la wallet personal')
  console.log('================================================================\n')

  console.log(`--> [1/3] Arrencant agent ATEX al port ${PORT_ATEX}...`)
  console.log(`          Endpoint públic: ${endpointNgrok}\n`)

  const agentAtex: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-ATEX-V1',
    'clave-maestra-ATEX-V1',
    { port: PORT_ATEX, endpoints: [endpointNgrok] }
  )
  await agentAtex.initialize()
  console.log('[ok] Agent ATEX inicialitzat.\n')

  console.log('--> [2/3] Comprovant CredDef ATEX al ledger...')
  const resultatCredDef = await agentAtex.modules.anoncreds.getCredentialDefinition(CRED_DEF_ATEX)
  if (!resultatCredDef.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no trobada: ${CRED_DEF_ATEX}`)
    console.error('             Comprova que la infraestructura ATEX està registrada a BCovrin.')
    process.exit(1)
  }
  console.log('[ok] CredDef ATEX verificada.\n')

  // quan escanegis el QR amb el BC Wallet, s'emet automàticament
  agentAtex.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const idConnexio = payload.connectionRecord.id
        console.log(`\n[connexió] ID: ${idConnexio}`)
        console.log('  enviant certificat ATEX...\n')

        try {
          await agentAtex.credentials.offerCredential({
            connectionId: idConnexio,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_ATEX,
                attributes: [
                  { name: 'id_cert',         value: `ATEX-${Date.now()}` },
                  { name: 'trabajador',       value: 'Operario-Demo' },
                  { name: 'zona',             value: 'Zona-1-Gas' },
                  { name: 'nivel_atex',       value: 'II 2G Ex ia IIC T4' },
                  { name: 'fecha_expiracion', value: '2031-12-31' },
                ],
              },
            },
          })
          console.log('[ok] Oferta ATEX enviada. Accepta-la al BC Wallet...')
        } catch (error) {
          console.error('[error] en emetre credencial ATEX:', error)
        }
      }
    }
  )

  agentAtex.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const estat = payload.credentialRecord.state
      console.log(`  [cred atex] -> ${estat}`)
      if (estat === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  CERTIFICAT ATEX EMÈS I ACCEPTAT!')
        console.log('  Ja pots aturar el servidor amb Ctrl+C')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generant invitació OOB...\n')
  const oob = await agentAtex.oob.createInvitation({
    label: 'Directiva ATEX: Rep el teu Certificat de Zona Explosiva',
    multiUseInvitation: true,
  })

  const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointNgrok })
  await imprimirQR(urlInvitacio)

  console.log('--> Escaneja el QR amb BC Wallet. Ctrl+C per aturar.\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent ATEX...')
    await agentAtex.shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})