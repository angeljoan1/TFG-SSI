// ARCHIVO: src/issuerAtex.ts
// Ejecutar: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerAtex.ts

import { AgentFactory, IndustrialAgent } from './config/AgentFactory'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'

const NGROK_ENDPOINT = process.env.NGROK_ENDPOINT
if (!NGROK_ENDPOINT) {
  console.error(
    'ERROR: Debes definir NGROK_ENDPOINT.\n' +
    'Ejemplo: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/issuerAtex.ts'
  )
  process.exit(1)
}
const PORT = Number(process.env.PORT) || 3003

// ─── Rellena con el output de setupAtex.ts ───
const PUBLIC_DID_ATEX = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B'
const CRED_DEF_ID_ATEX = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152041/default'

const main = async () => {
  console.log('================================================================')
  console.log('  EMISOR ATEX — Directiva de Zonas Explosivas')
  console.log('================================================================\n')

  console.log(`--> [1/3] Levantando agente ATEX en puerto ${PORT}...`)
  console.log(`          Endpoint público: ${NGROK_ENDPOINT}\n`)

  const issuerAtex: IndustrialAgent = await AgentFactory.create(
    'Servidor-ATEX-V1',
    'clave-maestra-ATEX-V1',
    { port: PORT, endpoints: [NGROK_ENDPOINT] }
  )
  await issuerAtex.initialize()
  console.log('[OK] Agente ATEX inicializado.\n')

  console.log('--> [2/3] Verificando CredDef ATEX en el ledger...')
  const credDefResult = await issuerAtex.modules.anoncreds.getCredentialDefinition(CRED_DEF_ID_ATEX)
  if (!credDefResult.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no encontrada: ${CRED_DEF_ID_ATEX}`)
    console.error('              Ejecuta setupAtex.ts primero.')
    process.exit(1)
  }
  console.log(`[OK] CredDef ATEX verificada.\n`)

  // ─── Emisión automática al completar conexión ───
  issuerAtex.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const connId = payload.connectionRecord.id
        console.log(`\n[CONEXIÓN ESTABLECIDA] ID: ${connId}`)
        console.log('  Emitiendo Certificado ATEX al operario...\n')

        try {
          await issuerAtex.credentials.offerCredential({
            connectionId: connId,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_ID_ATEX,
                attributes: [
                  { name: 'id_cert',          value: `ATEX-${Date.now()}` },
                  { name: 'trabajador',        value: 'Operario-Demo' },
                  { name: 'zona',              value: 'Zona-1-Gas' },
                  { name: 'nivel_atex',        value: 'II 2G Ex ia IIC T4' },
                  { name: 'fecha_expiracion',  value: '2026-12-31' },
                ],
              },
            },
          })
          console.log('[OK] Oferta ATEX enviada. Esperando aceptación...')
        } catch (error) {
          console.error('[ERROR] Al emitir credencial ATEX:', error)
        }
      }
    }
  )

  issuerAtex.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const state = payload.credentialRecord.state
      console.log(`  [CRED ATEX] Transición -> ${state}`)
      if (state === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  ¡CERTIFICADO ATEX EMITIDO Y ACEPTADO!')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generando invitación OOB ATEX...\n')
  const oobRecord = await issuerAtex.oob.createInvitation({
    label: 'Directiva ATEX: Recibe tu Certificado de Zona Explosiva',
    multiUseInvitation: true,
  })

  const invitationUrl = oobRecord.outOfBandInvitation.toUrl({ domain: NGROK_ENDPOINT })

  console.log('================================================================')
  console.log('  INVITACIÓN OOB ATEX — Escanea con BC Wallet')
  console.log('================================================================')
  console.log(`\n${invitationUrl}\n`)

  // @ts-ignore — qrcode-terminal es CommonJS
  const qrcode = require('qrcode-terminal')
  qrcode.generate(invitationUrl, { small: true })

  console.log('\n--> Servidor ATEX escuchando. Ctrl+C para detener.\n')
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})