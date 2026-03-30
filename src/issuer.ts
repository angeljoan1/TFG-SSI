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
import express, { Request, Response } from 'express'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import express, { Request, Response } from 'express'
import path from 'path'


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

const OPERARIOS_FILE = path.join(process.cwd(), 'operarios.json')

interface Operario {
  nombre: string
  connectionId: string
  registradoEn: string
}

function leerOperarios(): Operario[] {
  if (!existsSync(OPERARIOS_FILE)) return []
  return JSON.parse(readFileSync(OPERARIOS_FILE, 'utf-8'))
}

function guardarOperarios(lista: Operario[]): void {
  writeFileSync(OPERARIOS_FILE, JSON.stringify(lista, null, 2), 'utf-8')
}

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
 
  // Mapa en memoria: connectionId → estado
  const pendientes = new Set<string>()
  const connections: Map<string, { id: string; state: string; connectedAt: string }> = new Map()
 
issuer.events.on<ConnectionStateChangedEvent>(
  ConnectionEventTypes.ConnectionStateChanged,
  async ({ payload }) => {
    const record = payload.connectionRecord
    if (record.state === DidExchangeState.Completed) {
      console.log(`\n[CONEXIÓN ESTABLECIDA] ID: ${record.id}`)
      // Solo registrar si no está ya en el directorio
      const lista = leerOperarios()
      const yaExiste = lista.some((o) => o.connectionId === record.id)
      if (!yaExiste) {
        pendientes.add(record.id)
        console.log('  → Conexión nueva. Pendiente de nombrar en el formulario web.')
      } else {
        console.log('  → Operario ya registrado.')
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
 
  // ─── 4. Servidor Express (formulario web + API REST) ───────────────────────
  const app = express()
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))
 
  // GET /api/connections — lista de conexiones activas (estado Completed)
// GET /api/operarios — directorio completo
app.get('/api/operarios', (_req: Request, res: Response) => {
  res.json(leerOperarios())
})

// GET /api/pendientes — conexiones nuevas sin nombrar
app.get('/api/pendientes', (_req: Request, res: Response) => {
  res.json([...pendientes])
})

// POST /api/operarios — asignar nombre a una conexión pendiente
app.post('/api/operarios', (req: Request, res: Response) => {
  const { connectionId, nombre } = req.body as { connectionId: string; nombre: string }
  if (!connectionId || !nombre) {
    res.status(400).json({ error: 'Faltan campos: connectionId, nombre' })
    return
  }
  const lista = leerOperarios()
  if (lista.some((o) => o.connectionId === connectionId)) {
    res.status(409).json({ error: 'Este connectionId ya está registrado' })
    return
  }
  lista.push({ nombre, connectionId, registradoEn: new Date().toISOString() })
  guardarOperarios(lista)
  pendientes.delete(connectionId)
  console.log(`[DIRECTORIO] Operario registrado: ${nombre} → ${connectionId}`)
  res.json({ ok: true })
})

// POST /api/emitir — emite OT a un operario del directorio
app.post('/api/emitir', async (req: Request, res: Response) => {
  const { connectionId, equipo, tarea, fecha } = req.body as {
    connectionId: string; equipo: string; tarea: string; fecha: string
  }
  if (!connectionId || !equipo || !tarea || !fecha) {
    res.status(400).json({ error: 'Faltan campos: connectionId, equipo, tarea, fecha' })
    return
  }
  const lista = leerOperarios()
  if (!lista.some((o) => o.connectionId === connectionId)) {
    res.status(404).json({ error: 'Operario no encontrado en el directorio' })
    return
  }
  try {
    const idOrden = `ORD-${Date.now()}`
    await issuer.credentials.offerCredential({
      connectionId,
      protocolVersion: 'v2',
      credentialFormats: {
        anoncreds: {
          credentialDefinitionId: CRED_DEF_ID,
          attributes: [
            { name: 'id_orden', value: idOrden },
            { name: 'equipo',   value: equipo },
            { name: 'tarea',    value: tarea },
            { name: 'fecha',    value: fecha },
          ],
        },
      },
    })
    console.log(`[API] OT emitida → ${connectionId} | ${idOrden}`)
    res.json({ ok: true, id_orden: idOrden })
  } catch (error) {
    console.error('[API ERROR]', error)
    res.status(500).json({ error: 'Error al emitir la credencial' })
  }

 
    if (!connectionId || !equipo || !tarea || !fecha) {
      res.status(400).json({ error: 'Faltan campos: connectionId, equipo, tarea, fecha' })
      return
    }
 
    if (!connections.has(connectionId)) {
      res.status(404).json({ error: 'connectionId no encontrado. El operario debe conectarse primero.' })
      return
    }
 
    try {
      await issuer.credentials.offerCredential({
        connectionId,
        protocolVersion: 'v2',
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: CRED_DEF_ID,
            attributes: [
              { name: 'id_orden', value: `ORD-${Date.now()}` },
              { name: 'equipo',   value: equipo },
              { name: 'tarea',    value: tarea },
              { name: 'fecha',    value: fecha },
            ],
          },
        },
      })
      console.log(`\n[API] Orden emitida → connectionId: ${connectionId}`)
      res.json({ ok: true, id_orden: `ORD-${Date.now()}` })
    } catch (error) {
      console.error('[API ERROR]', error)
      res.status(500).json({ error: 'Error al emitir la credencial' })
    }
  })
 
  const WEB_PORT = PORT + 100 // 3101 para no colisionar con el inbound DIDComm
  app.listen(WEB_PORT, () => {
    console.log(`[WEB] Formulario disponible en http://localhost:${WEB_PORT}\n`)
  })
 
  // ─── 5. Generar invitación Out-Of-Band (igual que antes) ───────────────────
  console.log(`--> [3/3] Generando invitación OOB...\n`)
 
  const oobRecord = await issuer.oob.createInvitation({
    label: 'Emisor Industrial: Recibe tu Orden de Trabajo',
    multiUseInvitation: true,
  })
 
  const invitationUrl = oobRecord.outOfBandInvitation.toUrl({
    domain: NGROK_ENDPOINT,
  })
 
  console.log('================================================================')
  console.log('  INVITACIÓN OOB — Escanea con BC Wallet (primera conexión)')
  console.log('================================================================')
  console.log(`\n${invitationUrl}\n`)
 
  // @ts-ignore — qrcode-terminal es CommonJS, require está disponible en tsx
  const qrcode = require('qrcode-terminal')
  qrcode.generate(invitationUrl, { small: true })
 
  console.log('\n--> Servidor emisor escuchando. Ctrl+C para detener.\n')
}

main().catch((error) => {
  console.error('\n[ERROR FATAL]:', error)
  process.exit(1)
})