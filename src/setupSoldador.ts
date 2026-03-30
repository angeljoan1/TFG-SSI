// ARCHIVO: src/setupSoldador.ts
import { AgentFactory } from './config/AgentFactory'
import { TypedArrayEncoder, KeyType } from '@credo-ts/core'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  console.log('================================================================')
  console.log('--> SETUP SOLDADOR V1 (Escuela de Soldadores — Infraestructura Independiente)')
  console.log('================================================================\n')

  const nodoSoldador = await AgentFactory.create('Servidor-Soldador-V1', 'clave-maestra-Soldador-V1')

  try {
    await nodoSoldador.initialize()
    let publicDid = ''
    let rawDid = ''

    console.log('--> [1/4] Inicializando identidad Soldador...')
    const didsGuardados = await nodoSoldador.dids.getCreatedDids({ method: 'indy' })

    if (didsGuardados.length > 0) {
      publicDid = didsGuardados[0].did
      rawDid = publicDid.split(':').pop()!
      console.log(`[OK] Identidad recuperada: ${publicDid}`)
    } else {
      console.log('[INFO] Wallet virgen detectada. Generando nueva identidad Soldador...')

      const timestamp = Date.now().toString()
      const randomSeed = `TFG-SOLD-V1-${timestamp}`.padEnd(32, '0').substring(0, 32)
      const seedBytes = TypedArrayEncoder.fromString(randomSeed)

      const key = await nodoSoldador.wallet.createKey({ keyType: KeyType.Ed25519, seed: seedBytes as any })
      rawDid = TypedArrayEncoder.toBase58(key.publicKey.slice(0, 16))
      publicDid = `did:indy:bcovrin:test:${rawDid}`

      console.log(`--> Nuevo DID Soldador generado: ${publicDid}`)
      console.log('    ... Registrando como ENDORSER en BCovrin Faucet...')

      const faucetResponse = await fetch('http://test.bcovrin.vonx.io/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ENDORSER', alias: 'Servidor-Soldador-V1', did: rawDid, seed: randomSeed }),
      })
      if (!faucetResponse.ok) throw new Error('El Faucet denegó la identidad Soldador.')

      console.log('    ... Esperando 5 segundos para propagación en la red...')
      await sleep(5000)

      await nodoSoldador.dids.import({
        did: publicDid,
        overwrite: true,
        privateKeys: [{ privateKey: seedBytes, keyType: KeyType.Ed25519 }],
      })
      console.log('[OK] Identidad Soldador blindada en disco.')
      console.log(`\n⚠️  GUARDA ESTA SEED EN .seed-backup-soldador: ${randomSeed}\n`)
    }

    console.log('\n--> [2/4] Registrando Esquema Soldador...')
    const nombreEsquema = 'Homologacion-Soldador'
    const versionEsquema = '1.0.0'
    let schemaId = ''

    try {
      const schemaResult = await nodoSoldador.modules.anoncreds.registerSchema({
        schema: {
          attrNames: ['id_cert', 'trabajador', 'proceso', 'norma', 'fecha_expiracion'],
          issuerId: publicDid,
          name: nombreEsquema,
          version: versionEsquema,
        },
        options: {},
      })
      if (schemaResult.schemaState.state === 'failed')
        throw new Error(`Fallo de red real: ${schemaResult.schemaState.reason}`)
      schemaId = schemaResult.schemaState.schemaId!
      console.log(`[OK] Esquema Soldador subido. ID: ${schemaId}`)
    } catch (e: any) {
      if (e.message.includes('Fallo de red real')) throw e
      schemaId = `${publicDid}/anoncreds/v0/SCHEMA/${nombreEsquema}/${versionEsquema}`
      console.log(`[INFO] Esquema ya existía. Usando ID: ${schemaId}`)
    }

    console.log('\n--> [3/4] Esperando indexación del esquema en la red...')
    let esquemaDisponible = false
    let intentos = 0

    while (!esquemaDisponible && intentos < 15) {
      const lookup = await nodoSoldador.modules.anoncreds.getSchema(schemaId)
      if (lookup.schema) {
        console.log('[OK] Esquema localizado y validado en la red.')
        esquemaDisponible = true
      } else {
        console.log(`    ... Esperando indexación (Intento ${intentos + 1}/15)`)
        await sleep(4000)
        intentos++
      }
    }
    if (!esquemaDisponible) throw new Error('La red no indexó el esquema Soldador.')

    console.log('\n--> [4/4] Registrando CredDef Soldador...')
    const credDefResult = await nodoSoldador.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: { issuerId: publicDid, schemaId, tag: 'default' },
      options: { supportRevocation: false },
    })

    if (credDefResult.credentialDefinitionState.state === 'failed') {
      const reason = credDefResult.credentialDefinitionState.reason || ''
      if (reason.includes('already exists') || reason.includes('SeqNo')) {
        console.log('[OK] CredDef Soldador ya estaba registrada.')
      } else {
        throw new Error(`CredDef falló: ${reason}`)
      }
    } else {
      console.log('\n[OK] ¡CREDDEF SOLDADOR REGISTRADA CON ÉXITO!')
      console.log('================================================')
      console.log(`DID SOLDADOR: ${publicDid}`)
      console.log(`SCHEMA ID:    ${schemaId}`)
      console.log(`CREDDEF ID:   ${credDefResult.credentialDefinitionState.credentialDefinitionId}`)
      console.log('================================================')
      console.log('⚠️  Copia estos valores en ESTADO_TFG.MD ahora.')
    }

    await nodoSoldador.shutdown()
    console.log('\n--> Setup Soldador completado. Apagado seguro.')
    process.exit(0)
  } catch (error) {
    console.error('\n--> [ERROR FATAL]:', error)
    process.exit(1)
  }
}

main()