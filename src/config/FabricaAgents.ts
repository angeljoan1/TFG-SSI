// arxiu: src/config/FabricaAgents.ts
// la factoria que crea tots els agents (emissor, verificador...)
// tots passen per aquí, si alguna cosa falla en l'arrencada mira primer aquí

import {
  Agent,
  InitConfig,
  ConsoleLogger,
  LogLevel,
  DidsModule,
  ConnectionsModule,
  CredentialsModule,
  V2CredentialProtocol,
  ProofsModule,
  V2ProofProtocol,
  AutoAcceptCredential,
  AutoAcceptProof,
  HttpOutboundTransport,
} from '@credo-ts/core'
import { agentDependencies, HttpInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import {
  AnonCredsModule,
  AnonCredsCredentialFormatService,
  AnonCredsProofFormatService,
  LegacyIndyCredentialFormatService,
  LegacyIndyProofFormatService,
} from '@credo-ts/anoncreds'
import { anoncreds } from '@hyperledger/anoncreds-nodejs'
import {
  IndyVdrModule,
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidResolver,
  IndyVdrIndyDidRegistrar,
} from '@credo-ts/indy-vdr'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'

// configuració de transport: port local + endpoint públic de ngrok
export interface ConfigTransport {
  port: number
  endpoints: string[]
}

// tipus interns per no haver de fer casteos per tot arreu
type ProtocolCredencial = V2CredentialProtocol<
  [LegacyIndyCredentialFormatService, AnonCredsCredentialFormatService]
>

type ProtocolProva = V2ProofProtocol<
  [LegacyIndyProofFormatService, AnonCredsProofFormatService]
>

type ModulsAgent = {
  askar: AskarModule
  anoncreds: AnonCredsModule
  indyVdr: IndyVdrModule
  dids: DidsModule
  connections: ConnectionsModule
  credentials: CredentialsModule<[ProtocolCredencial]>
  proofs: ProofsModule<[ProtocolProva]>
}

export type AgentIndustrial = Agent<ModulsAgent>

// caché del genesis només el descarregam una vegada per sessió
// si el tornam a demanar cada vegada i BCovrin va lent, els arrencades tarden molt
let genesisEnCaché: string | null = null

async function obtenirGenesis(): Promise<string> {
  if (genesisEnCaché) return genesisEnCaché
  console.log('[genesis] descarregant de BCovrin...')
  const resposta = await fetch('https://test.bcovrin.vonx.io/genesis')
  genesisEnCaché = await resposta.text()
  console.log('[genesis] ok, en caché per a la resta de la sessió')
  return genesisEnCaché
}

export class FabricaAgents {
  public static async crear(
    nom: string,
    clauWallet: string,
    transport?: ConfigTransport
  ): Promise<AgentIndustrial> {

    const genesisTransactions = await obtenirGenesis()

    const config: InitConfig = {
      label: nom,
      walletConfig: {
        id: `wallet-${nom.toLowerCase().replace(/\s/g, '-')}`,
        // en producció, passar la clau per variable d'entorn i no hardcoded al codi
        // exemple: WALLET_KEY_OT, WALLET_KEY_VERIFICADOR, etc.
        key: clauWallet,
      },
      logger: new ConsoleLogger(LogLevel.info),
      // només posam endpoints si tenim transport (és a dir, si som un servidor)
      ...(transport ? { endpoints: transport.endpoints } : {}),
    }

    const protocolCredencial: ProtocolCredencial = new V2CredentialProtocol({
      credentialFormats: [
        new LegacyIndyCredentialFormatService(),
        new AnonCredsCredentialFormatService(),
      ],
    })

    const protocolProva: ProtocolProva = new V2ProofProtocol({
      proofFormats: [
        new LegacyIndyProofFormatService(),
        new AnonCredsProofFormatService(),
      ],
    })

    const agent = new Agent<ModulsAgent>({
      config,
      dependencies: agentDependencies,
      modules: {
        // --- cripto base ---
        askar: new AskarModule({ ariesAskar }),

        anoncreds: new AnonCredsModule({
          registries: [new IndyVdrAnonCredsRegistry()],
          anoncreds,
        }),

        indyVdr: new IndyVdrModule({
          indyVdr,
          networks: [
            {
              isProduction: false,
              indyNamespace: 'bcovrin:test',
              genesisTransactions,
              connectOnStartup: true,
            },
          ],
        }),

        dids: new DidsModule({
          registrars: [new IndyVdrIndyDidRegistrar()],
          resolvers: [new IndyVdrIndyDidResolver()],
        }),

        // --- protocols DIDComm ---
        connections: new ConnectionsModule({
          // acceptam connexions automàticament, no cal aprovar-les manualment
          autoAcceptConnections: true,
        }),

        credentials: new CredentialsModule({
          // el wallet de l'operari decideix si accepta, el servidor no bloqueja
          autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
          credentialProtocols: [protocolCredencial],
        }),

        proofs: new ProofsModule({
          // igual que les credencials BC Wallet mostra confirmació a l'usuari
          autoAcceptProofs: AutoAcceptProof.ContentApproved,
          proofProtocols: [protocolProva],
        }),
      },
    })

    // transport de sortida sempre
    agent.registerOutboundTransport(new HttpOutboundTransport())

    // transport d'entrada només si som un servidor (emissor o verificador)
    if (transport) {
      agent.registerInboundTransport(
        new HttpInboundTransport({ port: transport.port })
      )
    }

    return agent
  }
}
