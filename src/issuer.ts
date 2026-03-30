// ARCHIVO: src/issuer.ts
// Servidor emisor SSI — Genera invitación OOB y emite credenciales
// de Orden de Mantenimiento a la BC Wallet del operario.

import { AgentFactory, IndustrialAgent } from './config/AgentFactory'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'


// ─── Configuración inyectada por entorno ───
const NGROK_ENDPOINT = process.env.NGROK_ENDPOINT
if (!NGROK_ENDPOINT) {
  console.error(
    'ERROR: Debes definir NGROK_ENDPOINT.\n' +
    'Ejemplo: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/issuer.ts'
  )
  process.exit(1)
}
const PORT = Number(process.env.PORT) || 3001

// ─── IDs de la infraestructura registrada en BCovrin ───
// Estos valores salen del output de setup.ts
const PUBLIC_DID = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM'
const CRED_DEF_ID = `${PUBLIC_DID}/anoncreds/v0/CLAIM_DEF/3149116/default`

const main = async () => {
  console.log('================================================================')
  console.log('  EMISOR SSI - Servidor de Órdenes de Mantenimiento')
  console.log('================================================================\n')

  // ─── 1. Levantar agente emisor con transporte HTTP ───
  console.log(`--> [1/3] Levantando agente emisor en puerto ${PORT}...`)
  console.log(`          Endpoint público: ${NGROK_ENDPOINT}\n`)

  const issuer: IndustrialAgent = await AgentFactory.create(
    'Servidor-Autonomo-V13',
    'clave-maestra-V13',
    { port: PORT, endpoints: [NGROK_ENDPOINT] }
  )
  await issuer.initialize()
  console.log('[OK] Agente emisor inicializado y escuchando.\n')

  // ─── 2. Verificar que la CredDef existe en el ledger ───
  console.log(`--> [2/3] Verificando CredDef en el ledger...`)
  const credDefResult = await issuer.modules.anoncreds.getCredentialDefinition(CRED_DEF_ID)
  if (!credDefResult.credentialDefinition) {
    console.error(`[ERROR FATAL] CredDef no encontrada: ${CRED_DEF_ID}`)
    console.error('              Ejecuta setup.ts primero y verifica el ID.')
    process.exit(1)
  }
  console.log(`[OK] CredDef verificada: ${CRED_DEF_ID}\n`)

  // ─── 3. Registrar event listeners ───

  // Cuando un operario completa el handshake DIDComm, le emitimos la credencial
  issuer.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      if (payload.connectionRecord.state === DidExchangeState.Completed) {
        const connId = payload.connectionRecord.id
        console.log(`\n[CONEXIÓN ESTABLECIDA] ID: ${connId}`)
        console.log('  Emitiendo Orden de Mantenimiento al operario...\n')

        try {
          await issuer.credentials.offerCredential({
            connectionId: connId,
            protocolVersion: 'v2',
            credentialFormats: {
              anoncreds: {
                credentialDefinitionId: CRED_DEF_ID,
                attributes: [
                  { name: 'id_orden',  value: `ORD-${Date.now()}` },
                  { name: 'equipo',    value: 'Turbina-T4-Sector7' },
                  { name: 'tarea',     value: 'Mantenimiento preventivo trimestral' },
                  { name: 'fecha',     value: new Date().toISOString().split('T')[0] },
                ],
              },
            },
          })
          console.log('[OK] Oferta de credencial enviada. Esperando aceptación...')
        } catch (error) {
          console.error('[ERROR] Al emitir credencial:', error)
        }
      }
    }
  )

  // Seguimiento del ciclo de vida de la credencial
  issuer.events.on<CredentialStateChangedEvent>(
    CredentialEventTypes.CredentialStateChanged,
    async ({ payload }) => {
      const state = payload.credentialRecord.state
      console.log(`  [CRED] Transición de estado -> ${state}`)

      if (state === CredentialState.Done) {
        console.log('\n================================================')
        console.log('  ¡CREDENCIAL EMITIDA Y ACEPTADA POR EL OPERARIO!')
        console.log('================================================\n')
      }
    }
  )

  // ─── 4. Generar invitación Out-Of-Band ───
  console.log(`--> [3/3] Generando invitación OOB...\n`)

  const oobRecord = await issuer.oob.createInvitation({
    label: 'Emisor Industrial: Recibe tu Orden de Trabajo',
    multiUseInvitation: true,
  })

  const invitationUrl = oobRecord.outOfBandInvitation.toUrl({
    domain: NGROK_ENDPOINT,
  })

  console.log('================================================================')
  console.log('  INVITACIÓN OOB — Escanea con BC Wallet')
  console.log('================================================================')
  console.log(`\n${invitationUrl}\n`)

// QR en terminal — usamos createRequire porque qrcode-terminal es CommonJS puro

// QR en terminal
  // @ts-ignore — qrcode-terminal es CommonJS, require está disponible en tsx
  const qrcode = require('qrcode-terminal')
  qrcode.generate(invitationUrl, { small: true })

  console.log('\n--> Servidor emisor escuchando. Ctrl+C para detener.\n')
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})