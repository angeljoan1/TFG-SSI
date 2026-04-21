// arxiu: src/issuerAtex.ts
// emissor del certificat ATEX (zones explosives)
// executa: npx tsx src/issuerAtex.ts

import { FabricaAgents, AgentIndustrial } from './config/FabricaAgents'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'
import { DID_ATEX, CRED_DEF_ATEX, PORT_ATEX, ENDPOINT_ATEX } from './configuracio'
const endpointPublic = ENDPOINT_ATEX

// data d'expiració en unix timestamp (segons)
// el verificador farà un predicat >= avui per comprovar-ho criptogràficament
// 2026-12-31 en epoch
// un any a partir d'avui evita que la credencial caduqui si la demo es fa l'any que ve
const DATA_EXPIRACIO_ATEX = Math.floor((Date.now() + 365 * 24 * 3600 * 1000) / 1000).toString()

// imprimeix el QR al terminal si no hi ha el paquet, imprimeix la URL i prou
async function imprimirQR(url: string): Promise<void> {
  try {
    const qr = await import('qrcode-terminal')
    qr.default.generate(url, { small: true })
  } catch {
    console.log('[qr no disponible escaneja la URL directament]')
  }
  console.log(`\n📲 URL d'invitació:\n${url}\n`)
}

const main = async () => {
  console.log('================================================================')
  console.log('  EMISSOR ATEX Directiva de Zones Explosives')
  console.log('================================================================\n')

  console.log(`--> [1/3] Arrencant agent ATEX al port ${PORT_ATEX}...`)
  console.log(`          Endpoint públic: ${endpointPublic}\n`)

  const emissorAtex: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-ATEX-V1',
    process.env.WALLET_KEY_ATEX ?? 'clave-maestra-ATEX-V1',
    { port: PORT_ATEX, endpoints: [endpointPublic] }
  )
  await emissorAtex.initialize()
  console.log('[ok] Agent ATEX inicialitzat.\n')

  console.log('--> [2/3] Comprovant CredDef ATEX al ledger...')
  const resultatCredDef = await emissorAtex.modules.anoncreds.getCredentialDefinition(CRED_DEF_ATEX)
  if (!resultatCredDef.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no trobada: ${CRED_DEF_ATEX}`)
    console.error('             Executa setupAtex.ts primer.')
    process.exit(1)
  }
  console.log('[ok] CredDef ATEX verificada.\n')

  // quan l'operari es connecta, li enviam el certificat ATEX automàticament
  emissorAtex.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const idConnexio = payload.connectionRecord.id
        console.log(`\n[connexió] ID: ${idConnexio}`)
        console.log('  enviant certificat ATEX...\n')

        try {
          await emissorAtex.credentials.offerCredential({
            connectionId: idConnexio,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_ATEX,
                attributes: [
                  { name: 'id_cert',         value: `ATEX-${Date.now()}` },
                  { name: 'treballador',      value: 'Operari-Demo' },
                  { name: 'zona',             value: 'Zona-1-Gas' },
                  { name: 'nivell_atex',      value: 'II 2G Ex ia IIC T4' },
                  // epoch en string el verificador fa predicat >= avui
                  { name: 'data_expiracio',   value: DATA_EXPIRACIO_ATEX },
                ],
              },
            },
          })
          console.log('[ok] Oferta ATEX enviada. Esperant acceptació...')
        } catch (error) {
          console.error('[error] en emetre credencial ATEX:', error)
        }
      }
    }
  )

  emissorAtex.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const estat = payload.credentialRecord.state
      console.log(`  [cred atex] -> ${estat}`)
      if (estat === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  CERTIFICAT ATEX EMÈS I ACCEPTAT!')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generant invitació OOB ATEX...\n')
  const oob = await emissorAtex.oob.createInvitation({
    label: 'Directiva ATEX: Rep el teu Certificat de Zona Explosiva',
    multiUseInvitation: true,
  })

  const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointPublic })
  await imprimirQR(urlInvitacio)

  console.log('--> Servidor ATEX escoltant. Ctrl+C per aturar.\n')

  process.on('SIGINT', async () => {
    console.log('\n--> tancant agent ATEX...')
    await emissorAtex.shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})
