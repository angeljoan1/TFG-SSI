// ARCHIVO: src/issuerSoldador.ts
// Ejecutar: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerSoldador.ts

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
    'Ejemplo: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/issuerSoldador.ts'
  )
  process.exit(1)
}
const PORT = Number(process.env.PORT) || 3004

// ─── Rellena con el output de setupSoldador.ts ───
const PUBLIC_DID_SOLDADOR = 'did:indy:bcovrin:test:BE1hcUv3FSh31ihbfKTo6i'
const CRED_DEF_ID_SOLDADOR = 'did:indy:bcovrin:test:BE1hcUv3FSh31ihbfKTo6i/anoncreds/v0/CLAIM_DEF/3152060/default'

const main = async () => {
  console.log('================================================================')
  console.log('  EMISOR SOLDADOR — Escuela de Homologación de Soldadores')
  console.log('================================================================\n')

  console.log(`--> [1/3] Levantando agente Soldador en puerto ${PORT}...`)
  console.log(`          Endpoint público: ${NGROK_ENDPOINT}\n`)

  const issuerSoldador: IndustrialAgent = await AgentFactory.create(
    'Servidor-Soldador-V1',
    'clave-maestra-Soldador-V1',
    { port: PORT, endpoints: [NGROK_ENDPOINT] }
  )
  await issuerSoldador.initialize()
  console.log('[OK] Agente Soldador inicializado.\n')

  console.log('--> [2/3] Verificando CredDef Soldador en el ledger...')
  const credDefResult = await issuerSoldador.modules.anoncreds.getCredentialDefinition(CRED_DEF_ID_SOLDADOR)
  if (!credDefResult.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no encontrada: ${CRED_DEF_ID_SOLDADOR}`)
    console.error('              Ejecuta setupSoldador.ts primero.')
    process.exit(1)
  }
  console.log('[OK] CredDef Soldador verificada.\n')

  issuerSoldador.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const connId = payload.connectionRecord.id
        console.log(`\n[CONEXIÓN ESTABLECIDA] ID: ${connId}`)
        console.log('  Emitiendo Homologación de Soldador al operario...\n')

        try {
          await issuerSoldador.credentials.offerCredential({
            connectionId: connId,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_ID_SOLDADOR,
                attributes: [
                  { name: 'id_cert',          value: `SOLD-${Date.now()}` },
                  { name: 'trabajador',        value: 'Operario-Demo' },
                  { name: 'proceso',           value: 'SMAW' },
                  { name: 'norma',             value: 'EN ISO 9606-1' },
                  { name: 'fecha_expiracion',  value: '2026-12-31' },
                ],
              },
            },
          })
          console.log('[OK] Oferta Soldador enviada. Esperando aceptación...')
        } catch (error) {
          console.error('[ERROR] Al emitir credencial Soldador:', error)
        }
      }
    }
  )

  issuerSoldador.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const state = payload.credentialRecord.state
      console.log(`  [CRED SOLDADOR] Transición -> ${state}`)
      if (state === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  ¡HOMOLOGACIÓN SOLDADOR EMITIDA Y ACEPTADA!')
        console.log('================================================\n')
      }
    }
  )

  console.log('--> [3/3] Generando invitación OOB Soldador...\n')
  const oobRecord = await issuerSoldador.oob.createInvitation({
    label: 'Escuela de Soldadores: Recibe tu Homologación',
    multiUseInvitation: true,
  })

  const invitationUrl = oobRecord.outOfBandInvitation.toUrl({ domain: NGROK_ENDPOINT })

  console.log('================================================================')
  console.log('  INVITACIÓN OOB SOLDADOR — Escanea con BC Wallet')
  console.log('================================================================')
  console.log(`\n${invitationUrl}\n`)

  // @ts-ignore — qrcode-terminal es CommonJS
  const qrcode = require('qrcode-terminal')
  qrcode.generate(invitationUrl, { small: true })

  console.log('\n--> Servidor Soldador escuchando. Ctrl+C para detener.\n')
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})