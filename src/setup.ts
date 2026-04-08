// arxiu: src/setup.ts
// registra la identitat, l'schema i la CredDef a BCovrin
// executa això una vegada abans d'arrencar l'emissor
// si ja existeix tot, no fa res malament — és idempotent

import { FabricaAgents } from './config/FabricaAgents'
import { TypedArrayEncoder, KeyType } from '@credo-ts/core'
import { writeFileSync } from 'fs'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
  console.log('================================================================')
  console.log('--> SETUP — Registre d\'identitat i schema a BCovrin')
  console.log('================================================================\n')

  const node = await FabricaAgents.crear('Servidor-Autonomo-V13', 'clave-maestra-V13')

  try {
    await node.initialize()
    let didPublic = ''
    let didCru = ''

    // ─── 1. Identitat ─────────────────────────────────────────────────────────
    console.log('--> [1/4] Comprovant identitat...')
    const didsGuardats = await node.dids.getCreatedDids({ method: 'indy' })

    if (didsGuardats.length > 0) {
      didPublic = didsGuardats[0].did
      didCru = didPublic.split(':').pop()!
      console.log(`[ok] Identitat recuperada: ${didPublic}`)
    } else {
      console.log('[info] Servidor nou, generant identitat...')

      const segell = Date.now().toString()
      const llavor = `TFG-Prod-V13-${segell}`.padEnd(32, '0').substring(0, 32)

      // guardam la llavor per si BCovrin perd els permisos i hem de recuperar
      writeFileSync('.seed-backup', JSON.stringify({
        seed: llavor,
        timestamp: new Date().toISOString()
      }, null, 2), 'utf-8')
      console.log('    ... llavor guardada a .seed-backup (no pujar a git!)')

      const llavoraBytes = TypedArrayEncoder.fromString(llavor)
      const clau = await node.wallet.createKey({ keyType: KeyType.Ed25519, seed: llavoraBytes as any })
      didCru = TypedArrayEncoder.toBase58(clau.publicKey.slice(0, 16))
      didPublic = `did:indy:bcovrin:test:${didCru}`

      console.log(`--> DID nou: ${didPublic}`)
      console.log('    ... negociant permisos amb el Faucet...')

      const respostaFaucet = await fetch('https://test.bcovrin.vonx.io/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ENDORSER', alias: 'Servidor-Autonomo-V13', did: didCru, seed: llavor })
      })
      if (!respostaFaucet.ok) throw new Error('El Faucet ha denegat la identitat.')

      console.log('    ... esperant 5s perquè els nodes reconeguin els permisos...')
      await esperar(5000)

      await node.dids.import({
        did: didPublic, overwrite: true,
        privateKeys: [{ privateKey: llavoraBytes, keyType: KeyType.Ed25519 }]
      })
      console.log('[ok] Identitat guardada al disc.')
    }

// ─── 2. Schema v1.2.0 ────────────────────────────────────────────────────
    // versió nova perquè afegim 'revocation_index' per a la revocació W3C Bitstring
    console.log('\n--> [2/4] Registrant schema v1.2.0...')
    const nomSchema = 'Ordre-Manteniment'
    const versioSchema = '1.2.0'
    let schemaId = ''

    try {
      const resultatSchema = await node.modules.anoncreds.registerSchema({
        schema: {
          attrNames: ['id_ordre', 'equip', 'tasca', 'data', 'riscos', 'certificacions', 'revocation_index'],
          issuerId: didPublic,
          name: nomSchema,
          version: versioSchema,
        },
        options: {}
      })
      if (resultatSchema.schemaState.state === 'failed')
        throw new Error(`error de xarxa real: ${resultatSchema.schemaState.reason}`)
      schemaId = resultatSchema.schemaState.schemaId!
      console.log(`[ok] Schema nou pujat. ID: ${schemaId}`)
    } catch (e: any) {
      if (e.message.includes('error de xarxa real')) throw e
      // ja existia — calculam l'ID manualment
      schemaId = `${didPublic}/anoncreds/v0/SCHEMA/${nomSchema}/${versioSchema}`
      console.log(`[info] Schema ja existia. ID: ${schemaId}`)
    }

    // ─── 3. Esperar que la xarxa indexi l'schema ─────────────────────────────
    console.log('\n--> [3/4] Esperant que la xarxa indexi el schema...')
    let schemaDisponible = false
    let intents = 0

    while (!schemaDisponible && intents < 15) {
      const consulta = await node.modules.anoncreds.getSchema(schemaId)
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
    console.log('\n--> [4/4] Registrant CredDef...')
    const resultatCredDef = await node.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: { issuerId: didPublic, schemaId, tag: 'default' },
      options: { supportRevocation: false }
    })

    if (resultatCredDef.credentialDefinitionState.state === 'failed') {
      const motiu = resultatCredDef.credentialDefinitionState.reason || ''
      if (motiu.includes('already exists') || motiu.includes('SeqNo')) {
        console.log('[ok] La CredDef ja estava registrada.')
      } else {
        console.log(`\n[ERROR]: ${motiu}`)
      }
    } else {
      const idCredDef = resultatCredDef.credentialDefinitionState.credentialDefinitionId
      console.log('\n[ok] CredDef registrada!')
      console.log('================================================')
      console.log(`ID CREDDEF: ${idCredDef}`)
      console.log('================================================')
      console.log('\n⚠️  Copia aquest ID i actualitza CRED_DEF_OT a src/configuracio.ts')
    }

    await node.shutdown()
    console.log('\n--> Tot llest. Apagat net.')
    process.exit(0)

  } catch (error) {
    console.error('\n--> [ERROR FATAL]:', error)
    process.exit(1)
  }
}

main()