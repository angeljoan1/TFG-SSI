// arxiu: src/setupSoldador.ts
// registra la infraestructura Soldador a BCovrin (DID + Schema + CredDef)
// executa UNA VEGADA abans d'usar issuerSoldador.ts
// és idempotent si ja existeix tot, no fa res malament

import { FabricaAgents } from './config/FabricaAgents'
import { TypedArrayEncoder, KeyType } from '@credo-ts/core'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
 console.log('================================================================')
 console.log('--> SETUP SOLDADOR Registre d\'identitat i schema a BCovrin')
 console.log('================================================================\n')

 const agent = await FabricaAgents.crear('Servidor-Soldador-V1', 'clave-maestra-Soldador-V1')

 try {
  await agent.initialize()
  let didPublic = ''
  let didCru = ''

  console.log('--> [1/4] Comprovant identitat Soldador...')
  const didsGuardats = await agent.dids.getCreatedDids({ method: 'indy' })

  if (didsGuardats.length > 0) {
   didPublic = didsGuardats[0].did
   didCru = didPublic.split(':').pop()!
   console.log(`[ok] Identitat recuperada: ${didPublic}`)
  } else {
   console.log('[info] Servidor nou, generant identitat Soldador...')

   const FITXER_SEED = '.seed-backup-soldador'
   const llavor = existsSync(FITXER_SEED)
    ? (JSON.parse(readFileSync(FITXER_SEED, 'utf-8')) as { seed: string }).seed
    : `TFG-SOLD-V1-${Date.now()}`.padEnd(32, '0').substring(0, 32)

   if (!existsSync(FITXER_SEED)) {
    writeFileSync(FITXER_SEED, JSON.stringify({ seed: llavor, timestamp: new Date().toISOString() }, null, 2), 'utf-8')
    console.log('  ... llavor guardada a .seed-backup-soldador (no pujar a git!)')
   }

   const llavorBytes = TypedArrayEncoder.fromString(llavor)
   const clau = await agent.wallet.createKey({ keyType: KeyType.Ed25519, seed: llavorBytes as any })
   didCru = TypedArrayEncoder.toBase58(clau.publicKey.slice(0, 16))
   didPublic = `did:indy:bcovrin:test:${didCru}`

   console.log(`--> DID nou: ${didPublic}`)
   console.log('  ... negociant permisos amb el Faucet...')

   const respostaFaucet = await fetch('https://test.bcovrin.vonx.io/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'ENDORSER', alias: 'Servidor-Soldador-V1', did: didCru, seed: llavor })
   })
   if (!respostaFaucet.ok) throw new Error('El Faucet ha denegat la identitat.')

   console.log('  ... esperant 5s perquè els nodes reconeguin els permisos...')
   await esperar(5000)

   await agent.dids.import({
    did: didPublic, overwrite: true,
    privateKeys: [{ privateKey: llavorBytes, keyType: KeyType.Ed25519 }]
   })
   console.log('[ok] Identitat guardada al disc.')
  }

  console.log('\n--> [2/4] Registrant schema Homologacio-Soldador v1.0.0...')
  const nomSchema = 'Homologacio-Soldador'
  const versioSchema = '1.0.0'
  let schemaId = ''

  try {
   const resultatSchema = await agent.modules.anoncreds.registerSchema({
    schema: {
     attrNames: ['id_cert', 'treballador', 'proces', 'norma', 'data_expiracio'],
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

  console.log('\n--> [3/4] Esperant que la xarxa indexi el schema...')
  let schemaDisponible = false
  let intents = 0

  while (!schemaDisponible && intents < 15) {
   const consulta = await agent.modules.anoncreds.getSchema(schemaId)
   if (consulta.schema) {
    console.log('[ok] Schema localitzat i validat.')
    schemaDisponible = true
   } else {
    console.log(`  ... intent ${intents + 1}/15, esperant 4s...`)
    await esperar(4000)
    intents++
   }
  }
  if (!schemaDisponible) throw new Error('La xarxa no ha indexat el schema prova-ho més tard.')

  console.log('\n--> [4/4] Registrant CredDef Soldador...')
  const resultatCredDef = await agent.modules.anoncreds.registerCredentialDefinition({
   credentialDefinition: { issuerId: didPublic, schemaId, tag: 'default' },
   options: { supportRevocation: false }
  })

  if (resultatCredDef.credentialDefinitionState.state === 'failed') {
   const motiu = resultatCredDef.credentialDefinitionState.reason || ''
   if (motiu.includes('already exists') || motiu.includes('SeqNo')) {
    console.log('[ok] CredDef Soldador ja estava registrada.')
   } else {
    throw new Error(`CredDef fallida: ${motiu}`)
   }
  } else {
   console.log('\n[ok] CredDef Soldador registrada!')
   console.log('================================================')
   console.log(`ID CREDDEF SOLDADOR: ${resultatCredDef.credentialDefinitionState.credentialDefinitionId}`)
   console.log('================================================')
   console.log('\n⚠️ Copia aquest ID i actualitza CRED_DEF_SOLDADOR a src/configuracio.ts')
  }

  await agent.shutdown()
  console.log('\n--> Setup Soldador completat. Apagat net.')
  process.exit(0)

 } catch (error) {
  console.error('\n--> [ERROR FATAL]:', error)
  process.exit(1)
 }
}

main()
