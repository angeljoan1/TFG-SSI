// ARCHIVO: src/setup.ts
import { AgentFactory } from './config/AgentFactory'
import { TypedArrayEncoder, KeyType } from '@credo-ts/core'
import { writeFileSync } from 'fs'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
    console.log("================================================================")
    console.log("--> ORQUESTADOR V13 (Entorno Sano y DNI Virgen)")
    console.log("================================================================\n")

    const nodoEmisor = await AgentFactory.create('Servidor-Autonomo-V13', 'clave-maestra-V13')

    try {
        await nodoEmisor.initialize()
        let publicDid = "";
        let rawDid = "";

        console.log(`--> [1/4] Inicializando identidad de Producción V13...`)
        const didsGuardados = await nodoEmisor.dids.getCreatedDids({ method: 'indy' })

        if (didsGuardados.length > 0) {
            publicDid = didsGuardados[0].did
            rawDid = publicDid.split(':').pop()!
            console.log(`[OK] Identidad recuperada: ${publicDid}`)
        } else {
            console.log(`[INFO] Servidor virgen detectado. Generando nueva identidad...`)

            const timestamp = Date.now().toString()
            const randomSeed = `TFG-Prod-V13-${timestamp}`.padEnd(32, '0').substring(0, 32)
            // Backup del seed para recuperación futura si BCovrin pierde permisos
            writeFileSync('.seed-backup', JSON.stringify({
                seed: randomSeed,
                timestamp: new Date().toISOString()
            }, null, 2), 'utf-8')
            console.log(`    ... Seed guardado en .seed-backup (NO subir a Git)`)
            const seedBytes = TypedArrayEncoder.fromString(randomSeed)

            const key = await nodoEmisor.wallet.createKey({ keyType: KeyType.Ed25519, seed: seedBytes as any })
            rawDid = TypedArrayEncoder.toBase58(key.publicKey.slice(0, 16))
            publicDid = `did:indy:bcovrin:test:${rawDid}`

            console.log(`--> Nuevo DNI generado: ${publicDid}`)
            console.log(`    ... Negociando permisos de Endorser con el Faucet...`)

            const faucetResponse = await fetch('http://test.bcovrin.vonx.io/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'ENDORSER', alias: 'Servidor-Autonomo-V13', did: rawDid, seed: randomSeed })
            })
            if (!faucetResponse.ok) throw new Error("El Faucet denegó la identidad.")

            console.log(`    ... Esperando 5 segundos para que los nodos reconozcan los permisos...`)
            await sleep(5000)

            await nodoEmisor.dids.import({
                did: publicDid, overwrite: true, privateKeys: [{ privateKey: seedBytes, keyType: KeyType.Ed25519 }]
            })
            console.log(`[OK] Identidad blindada en disco.`)
        }

        console.log(`\n--> [2/4] Verificando/Registrando Esquema...`)
        const nombreEsquema = 'Orden-Mantenimiento'
        const versionEsquema = '1.0.7'
        let schemaId = ""

        try {
            const schemaResult = await nodoEmisor.modules.anoncreds.registerSchema({
                schema: { attrNames: ['id_orden', 'equipo', 'tarea', 'fecha'], issuerId: publicDid, name: nombreEsquema, version: versionEsquema },
                options: {}
            })
            if (schemaResult.schemaState.state === 'failed') throw new Error(`Fallo de red real: ${schemaResult.schemaState.reason}`)
            schemaId = schemaResult.schemaState.schemaId!
            console.log(`[OK] Nuevo esquema subido a la red. ID: ${schemaId}`)
        } catch (e: any) {
            if (e.message.includes('Fallo de red real')) throw e;
            schemaId = `${publicDid}/anoncreds/v0/SCHEMA/${nombreEsquema}/${versionEsquema}`
            console.log(`[INFO] El esquema ya existía en la red. Usando ID: ${schemaId}`)
        }

        console.log(`\n--> [3/4] Sincronizando estado con los nodos de la Blockchain...`)
        let esquemaDisponible = false
        let intentos = 0

        while (!esquemaDisponible && intentos < 15) {
            const lookup = await nodoEmisor.modules.anoncreds.getSchema(schemaId)
            if (lookup.schema) {
                console.log(`[OK] Archivo de esquema localizado y validado.`)
                esquemaDisponible = true
            } else {
                console.log(`    ... Esperando indexación de red (Intento ${intentos + 1}/15)`)
                await sleep(4000); intentos++
            }
        }
        if (!esquemaDisponible) throw new Error("La red está colapsada y no ha indexado el esquema.")

        console.log(`\n--> [4/4] Forjando el Sello Oficial (CredDef)...`)

        const credDefResult = await nodoEmisor.modules.anoncreds.registerCredentialDefinition({
            credentialDefinition: { issuerId: publicDid, schemaId: schemaId, tag: 'default' },
            options: { supportRevocation: false }
        })

        if (credDefResult.credentialDefinitionState.state === 'failed') {
            const reason = credDefResult.credentialDefinitionState.reason || ""
            if (reason.includes('already exists') || reason.includes('SeqNo')) {
                console.log(`[OK] El sello criptográfico ya estaba registrado previamente.`)
            } else {
                console.log(`\n[ERROR CRÍTICO]: ${reason}`)
            }
        } else {
            console.log(`\n[OK] ¡SELLO CRIPTOGRÁFICO REGISTRADO CON ÉXITO!`)
            console.log(`================================================`)
            console.log(`ID DE LA CREDDEF: ${credDefResult.credentialDefinitionState.credentialDefinitionId}`)
            console.log(`================================================`)
        }

        await nodoEmisor.shutdown()
        console.log("\n--> Sistema preparado. Apagado seguro.")
        process.exit(0)

    } catch (error) {
        console.error("\n--> [ERROR FATAL]:", error)
        process.exit(1)
    }
}
main()