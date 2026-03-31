// arxiu: src/setupAtex.ts
// registra la infraestructura ATEX a BCovrin i emet el certificat a la wallet
// executa: NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/setupAtex.ts
// és idempotent — si el schema i la CredDef ja existeixen, no els torna a crear
// un cop tens la credencial al BC Wallet no cal tornar-lo a executar

import { FabricaAgents, AgentIndustrial } from './config/FabricaAgents'
import { TypedArrayEncoder, KeyType } from '@credo-ts/core'
import {
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  DidExchangeState,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  CredentialState,
} from '@credo-ts/core'
import { writeFileSync } from 'fs'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const endpointNgrok = process.env.NGROK_ENDPOINT
if (!endpointNgrok) {
  console.error('ERROR: cal definir NGROK_ENDPOINT')
  console.error('exemple: NGROK_ENDPOINT=https://xxxx.ngrok-free.app npx tsx src/setupAtex.ts')
  process.exit(1)
}

const PORT_ATEX = 3003

// data d'expiració 2031 en epoch — canvia-la si vols un altre termini
const DATA_EXPIRACIO = Math.floor(new Date('2031-12-31').getTime() / 1000).toString()

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
  console.log('--> SETUP ATEX — Infraestructura + Emissió a wallet personal')
  console.log('================================================================\n')

  const agent: AgentIndustrial = await FabricaAgents.crear(
    'Servidor-ATEX-V1',
    'clave-maestra-ATEX-V1',
    { port: PORT_ATEX, endpoints: [endpointNgrok] }
  )

  try {
    await agent.initialize()
    let didPublic = ''
    let didCru = ''

    // ─── 1. Identitat ─────────────────────────────────────────────────────────
    console.log('--> [1/4] Comprovant identitat ATEX...')
    const didsGuardats = await agent.dids.getCreatedDids({ method: 'indy' })

    if (didsGuardats.length > 0) {
      didPublic = didsGuardats[0].did
      didCru = didPublic.split(':').pop()!
      console.log(`[ok] Identitat recuperada: ${didPublic}`)
    } else {
      console.log('[info] Servidor nou, generant identitat ATEX...')

      const segell = Date.now().toString()
      const llavor = `TFG-ATEX-V1-${segell}`.padEnd(32, '0').substring(0, 32)

      writeFileSync('.seed-backup-atex', JSON.stringify({
        seed: llavor,
        timestamp: new Date().toISOString()
      }, null, 2), 'utf-8')
      console.log('    ... llavor guardada a .seed-backup-atex (no pujar a git!)')

      const llavorBytes = TypedArrayEncoder.fromString(llavor)
      const clau = await agent.wallet.createKey({ keyType: KeyType.Ed25519, seed: llavorBytes as any })
      didCru = TypedArrayEncoder.toBase58(clau.publicKey.slice(0, 16))
      didPublic = `did:indy:bcovrin:test:${didCru}`

      console.log(`--> DID nou: ${didPublic}`)
      console.log('    ... negociant permisos amb el Faucet...')

      const respostaFaucet = await fetch('https://test.bcovrin.vonx.io/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ENDORSER', alias: 'Servidor-ATEX-V1', did: didCru, seed: llavor })
      })
      if (!respostaFaucet.ok) throw new Error('El Faucet ha denegat la identitat.')

      console.log('    ... esperant 5s perquè els nodes reconeguin els permisos...')
      await esperar(5000)

      await agent.dids.import({
        did: didPublic, overwrite: true,
        privateKeys: [{ privateKey: llavorBytes, keyType: KeyType.Ed25519 }]
      })
      console.log('[ok] Identitat guardada al disc.')
    }

    // ─── 2. Schema ────────────────────────────────────────────────────────────
    console.log('\n--> [2/4] Registrant schema Certificat-ATEX v1.0.0...')
    const nomSchema = 'Certificat-ATEX'
    const versioSchema = '1.0.0'
    let schemaId = ''

    try {
      const resultatSchema = await agent.modules.anoncreds.registerSchema({
        schema: {
          attrNames: ['id_cert', 'treballador', 'zona', 'nivell_atex', 'data_expiracio'],
          issuerId: didPublic,
          name: nomSchema,
          version: versioSchema,
        },
        options: {}
      })
      if (resultatSchema.schemaState.state === 'failed')
        throw new Error(`error de xarxa real: ${resultatSchema.schemaState.reason}`)
      schemaId = resultatSchema.schemaState.schemaId!
      console.log(`[ok] Schema pujat. ID: ${schemaId}`)
    } catch (e: any) {
      if (e.message.includes('error de xarxa real')) throw e
      schemaId = `${didPublic}/anoncreds/v0/SCHEMA/${nomSchema}/${versioSchema}`
      console.log(`[info] Schema ja existia. ID: ${schemaId}`)
    }

    // ─── 3. Esperar indexació ─────────────────────────────────────────────────
    console.log('\n--> [3/4] Esperant que la xarxa indexi el schema...')
    let schemaDisponible = false
    let intents = 0

    while (!schemaDisponible && intents < 15) {
      const consulta = await agent.modules.anoncreds.getSchema(schemaId)
      if (consulta.schema) {
        console.log('[ok] Schema localitzat i validat.')
        schemaDisponible = true
      } else {
        console.log(`    ... intent ${intents + 1}/15, esperant 4s...`)
        await esperar(4000)
        intents++
      }
    }
    if (!schemaDisponible) throw new Error('La xarxa no ha indexat el schema — prova-ho més tard.')

    // ─── 4. CredDef ──────────────────────────────────────────────────────────
    console.log('\n--> [4/4] Registrant CredDef ATEX...')
    let credDefId = ''

    const resultatCredDef = await agent.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: { issuerId: didPublic, schemaId, tag: 'default' },
      options: { supportRevocation: false }
    })

    if (resultatCredDef.credentialDefinitionState.state === 'failed') {
      const motiu = resultatCredDef.credentialDefinitionState.reason || ''
      if (motiu.includes('already exists') || motiu.includes('SeqNo')) {
        credDefId = `${didPublic}/anoncreds/v0/CLAIM_DEF/${schemaId.split('/')[5]}/default`
        console.log('[ok] CredDef ja estava registrada.')
      } else {
        throw new Error(motiu)
      }
    } else {
      credDefId = resultatCredDef.credentialDefinitionState.credentialDefinitionId!
      console.log('\n[ok] CredDef registrada!')
      console.log('================================================')
      console.log(`ID CREDDEF ATEX: ${credDefId}`)
      console.log('================================================')
      console.log('\n⚠️  Copia aquest ID i actualitza CRED_DEF_ATEX a src/configuracio.ts')
    }

    // ─── 5. Emetre credencial a la wallet via QR ──────────────────────────────
    console.log('\n--> Generant QR per emetre el certificat ATEX a la wallet...')
    console.log('    Escaneja amb BC Wallet per rebre el certificat.\n')

    agent.events.on<ConnectionStateChangedEvent>(
      ConnectionEventTypes.ConnectionStateChanged,
      async ({ payload }) => {
        if (payload.connectionRecord.state === DidExchangeState.Completed) {
          const idConnexio = payload.connectionRecord.id
          console.log(`\n[connexió] ID: ${idConnexio}`)
          console.log('  enviant certificat ATEX...\n')

          try {
            await agent.credentials.offerCredential({
              connectionId: idConnexio,
              protocolVersion: 'v2',
              credentialFormats: {
                anoncreds: {
                  credentialDefinitionId: credDefId,
                  attributes: [
                    { name: 'id_cert',       value: `ATEX-${Date.now()}` },
                    { name: 'treballador',   value: 'Operari-Demo' },
                    { name: 'zona',          value: 'Zona-1-Gas' },
                    { name: 'nivell_atex',   value: 'II 2G Ex ia IIC T4' },
                    { name: 'data_expiracio', value: DATA_EXPIRACIO },
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

    agent.events.on<CredentialStateChangedEvent>(
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

    const oob = await agent.oob.createInvitation({
      label: 'Directiva ATEX: Rep el teu Certificat de Zona Explosiva',
      multiUseInvitation: true,
    })

    const urlInvitacio = oob.outOfBandInvitation.toUrl({ domain: endpointNgrok! })
    await imprimirQR(urlInvitacio)

    console.log('--> Escaneja el QR amb BC Wallet. Ctrl+C per aturar.\n')

    process.on('SIGINT', async () => {
      console.log('\n--> tancant agent ATEX...')
      await agent.shutdown()
      process.exit(0)
    })

  } catch (error) {
    console.error('\n--> [ERROR FATAL]:', error)
    process.exit(1)
  }
}

main()