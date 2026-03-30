// ARCHIVO: src/verifier.ts
//
// Punto de control de acceso SSI.
// Genera una invitación OOB, espera a que el operario se conecte,
// y le solicita una Zero-Knowledge Proof con revelación selectiva:
// únicamente los atributos 'equipo' y 'tarea' de la CredDef registrada.
//
// Ejecución:
//   NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/verifier.ts

import { AgentFactory, IndustrialAgent } from './config/AgentFactory'
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

// ─── Constantes de infraestructura ───────────────────────────────────────────
// Estos IDs son los registrados en BCovrin por setup.ts.
// Si regeneras la infraestructura, actualiza estos valores.
// ─── Constantes de infraestructura ───────────────────────────────────────────
const CRED_DEF_ID_OT = 'did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3149116/default'
const CRED_DEF_ID_ATEX = 'did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152041/default'
const CRED_DEF_ID_SOLDADOR = 'did:indy:bcovrin:test:BE1hcUv3FSh31ihbfKTo6i/anoncreds/v0/CLAIM_DEF/3152060/default'
// Puerto local del verificador (distinto al del emisor que usa 3001)
const PORT = 3002

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Imprime un QR ASCII en terminal a partir de una URL.
// Usa el paquete 'qrcode-terminal' si está disponible; si no, imprime la URL.
async function printQR(url: string): Promise<void> {
  try {
    const qr = await import('qrcode-terminal')
    qr.default.generate(url, { small: true })
  } catch {
    // qrcode-terminal es opcional; si no está instalado no rompe el flujo
    console.log('\n[QR no disponible — escanea la URL directamente]\n')
  }
  console.log(`\n📲 URL de invitación:\n${url}\n`)
}

interface VerificationEvent {
  ts: string
  valid: boolean
  attrs: Record<string, string>
  missing: string[]
}
let lastEvent: VerificationEvent | null = null

let invitationUrl = ''
// ─── Lógica principal ─────────────────────────────────────────────────────────
const main = async () => {
  console.log('================================================================')
  console.log('--> VERIFICADOR SSI v1.0 (Revelación Selectiva — ZKP)')
  console.log('================================================================\n')

  // ── 1. Leer endpoint de ngrok ─────────────────────────────────────────────
  const ngrokEndpoint = process.env.NGROK_ENDPOINT
  if (!ngrokEndpoint) {
    console.error('[ERROR] Variable de entorno NGROK_ENDPOINT no definida.')
    console.error('        Ejecución correcta:')
    console.error('        NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/verifier.ts')
    process.exit(1)
  }

  // ── 2. Crear e inicializar el agente verificador ──────────────────────────
  // Wallet DIFERENTE a la del emisor (id y clave distintos).
  // El verificador NO necesita las claves privadas del emisor.
  console.log('--> [1/4] Inicializando agente Verificador...')
  const verifier: IndustrialAgent = await AgentFactory.create(
    'Verificador-Acceso-V1',
    'clave-verificador-V1',
    {
      port: PORT,
      endpoints: [ngrokEndpoint],
    }
  )

  await verifier.initialize()
  console.log(`[OK] Agente inicializado. Escuchando en puerto ${PORT}.`)
  console.log(`[OK] Endpoint público: ${ngrokEndpoint}\n`)

  // ── 3. Listener de pruebas (el núcleo del verificador) ────────────────────
  // Este bloque es el "portero": reacciona a cada cambio de estado
  // en el protocolo Present Proof 2.0.
  console.log('--> [2/4] Registrando listener de pruebas ZKP...')

  verifier.events.on<ProofStateChangedEvent>(
    ProofEventTypes.ProofStateChanged,
    async ({ payload }) => {
      const { proofRecord } = payload

      // ── Estado: la prueba ha llegado al verificador ──────────────────────
      if (proofRecord.state === ProofState.RequestSent) {
        console.log('\n[PROOF] Solicitud de prueba enviada al operario.')
        console.log(`        ID de sesión: ${proofRecord.id}`)
      }

      // ── Estado: el operario ha presentado su ZKP ─────────────────────────
      if (proofRecord.state === ProofState.PresentationReceived) {
        console.log('\n[PROOF] ⟶ Presentación ZKP recibida. Verificando...')
      }

      // ── Estado final: prueba verificada criptográficamente ───────────────
      // Credo valida automáticamente la firma AnonCreds contra BCovrin.
      // Aquí leemos el resultado y tomamos la decisión de acceso.
      if (proofRecord.state === ProofState.Done) {
        const isValid = proofRecord.isVerified

if (isValid) {
  console.log('\n✅  ACCESO CONCEDIDO — PRUEBA ZKP VÁLIDA')
  const attrs: Record<string, string> = {}
  try {
    const formattedProof = await verifier.proofs.getFormatData(proofRecord.id)
    const revealedAttrs =
      formattedProof.presentation?.anoncreds?.requested_proof?.revealed_attrs ?? {}
    for (const [k, v] of Object.entries(revealedAttrs)) {
      attrs[k] = (v as any).raw
    }
  } catch {}
  lastEvent = { ts: new Date().toISOString(), valid: true, attrs, missing: [] }
  console.log('[PROOF] Atributos revelados:', attrs)
} else {
  console.log('\n❌  ACCESO DENEGADO — PRUEBA ZKP INVÁLIDA')
  const missing: string[] = []
  try {
    const formattedProof = await verifier.proofs.getFormatData(proofRecord.id)
    const revealedAttrs =
      formattedProof.presentation?.anoncreds?.requested_proof?.revealed_attrs ?? {}
    const revealed = Object.keys(revealedAttrs)
    if (!revealed.includes('grupo_equipo') || !revealed.includes('grupo_tarea'))
      missing.push('Orden de Trabajo')
    if (!revealed.includes('grupo_zona') || !revealed.includes('grupo_nivel_atex'))
      missing.push('Certificado ATEX')
    if (!revealed.includes('grupo_proceso') || !revealed.includes('grupo_norma'))
      missing.push('Homologación Soldador')
  } catch {}
  lastEvent = { ts: new Date().toISOString(), valid: false, attrs: {}, missing }
  console.log('[MOTIVO] Credenciales ausentes:', missing)
}

        console.log('\n[INFO] Verificador listo para el siguiente operario.\n')
      }

      // ── Estado: el operario rechazó presentar la prueba ─────────────────
      if (proofRecord.state === ProofState.Declined) {
        console.log('\n[PROOF] ⚠️  El operario declinó presentar la prueba.')
        console.log('        Acceso denegado por ausencia de credencial.\n')
      }
    }
  )

  console.log('[OK] Listener activo.\n')

  // ── 4. Generar invitación OOB y esperar conexión ──────────────────────────
  // La invitación es multi-uso: múltiples operarios pueden conectarse
  // con el mismo QR sin regenerarlo.
  // ── Servidor Express ──────────────────────────────────────────────────────
const app = express()
app.use(express.static(path.join(__dirname, '..', 'public-verifier')))
app.get('/api/status', (_req: Request, res: Response) => {
  res.json(lastEvent)
})
app.get('/api/qr', (_req: Request, res: Response) => {
  res.json({ url: invitationUrl })
})
const WEB_PORT = PORT + 100 // 3102
app.listen(WEB_PORT, () => {
  console.log(`[WEB] Panel de acceso en http://localhost:${WEB_PORT}\n`)
})

console.log('--> [3/4] Generando invitación OOB para operarios...')

  const oobInvitation = await verifier.oob.createInvitation({
    label: 'Control de Acceso — Planta Industrial',
    multiUseInvitation: true,
    handshakeProtocols: [HandshakeProtocol.DidExchange],
  })

  invitationUrl = oobInvitation.outOfBandInvitation.toUrl({
    domain: ngrokEndpoint,
  })

  console.log('[OK] Invitación generada. Muestra este QR al operario:\n')
  await printQR(invitationUrl)

  // ── 5. Listener de conexiones: enviar Proof Request al conectarse ─────────
  // Cuando un operario escanea el QR y establece el canal DIDComm,
  // el verificador le envía automáticamente la solicitud de prueba.
  console.log('--> [4/4] Esperando conexiones de operarios...\n')

  verifier.events.on<ConnectionStateChangedEvent>(
    ConnectionEventTypes.ConnectionStateChanged,
    async ({ payload }) => {
      const connection = payload.connectionRecord

      // Solo actuar cuando la conexión está completamente establecida
      if (connection.state !== DidExchangeState.Completed) return

      console.log(`\n[CONN] ✓ Operario conectado. ID de conexión: ${connection.id}`)
      console.log('[CONN] Enviando solicitud de prueba ZKP...\n')

      // ── Proof Request con Revelación Selectiva ───────────────────────────
      // Se solicitan ÚNICAMENTE 'equipo' y 'tarea'.
      // AnonCreds permite al holder demostrar que posee estos atributos
      // firmados por el emisor registrado en BCovrin, sin revelar el resto.
      await verifier.proofs.requestProof({
        protocolVersion: 'v2',
        connectionId: connection.id,
        proofFormats: {
          anoncreds: {
            name: 'control-acceso-planta',
            version: '1.0',
            requested_attributes: {
              // ── Orden de Trabajo (Oficina Técnica) ──
              grupo_equipo: {
                name: 'equipo',
                restrictions: [{ cred_def_id: CRED_DEF_ID_OT }],
              },
              grupo_tarea: {
                name: 'tarea',
                restrictions: [{ cred_def_id: CRED_DEF_ID_OT }],
              },
              // ── Certificado ATEX (Directiva Zonas Explosivas) ──
              grupo_zona: {
                name: 'zona',
                restrictions: [{ cred_def_id: CRED_DEF_ID_ATEX }],
              },
              grupo_nivel_atex: {
                name: 'nivel_atex',
                restrictions: [{ cred_def_id: CRED_DEF_ID_ATEX }],
              },
              // ── Homologación Soldador (Escuela de Soldadores) ──
              grupo_proceso: {
                name: 'proceso',
                restrictions: [{ cred_def_id: CRED_DEF_ID_SOLDADOR }],
              },
              grupo_norma: {
                name: 'norma',
                restrictions: [{ cred_def_id: CRED_DEF_ID_SOLDADOR }],
              },
            },
            // Sin predicados en esta versión.
            // Trabajo futuro: añadir predicado sobre 'fecha' para verificar
            // que la orden no ha caducado sin revelar la fecha exacta.
            requested_predicates: {},
          },
        },
      })

      console.log('[PROOF] Solicitud enviada. Esperando ZKP del operario...')
    }
  )

  // Mantener el proceso vivo indefinidamente
  console.log('================================================================')
  console.log('--> Sistema activo. Ctrl+C para detener.')
  console.log('================================================================\n')

  // Capturar señal de apagado para un shutdown limpio
  process.on('SIGINT', async () => {
    console.log('\n\n--> Señal de apagado recibida. Cerrando agente...')
    await verifier.shutdown()
    console.log('[OK] Agente cerrado. Hasta luego.')
    process.exit(0)
  })
}

main()