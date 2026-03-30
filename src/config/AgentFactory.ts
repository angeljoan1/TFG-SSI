// ARCHIVO: src/config/AgentFactory.ts
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

export interface AgentTransportConfig {
  port: number
  endpoints: string[] // ej: ['https://xxxx.ngrok-free.app']
}

type IndustrialCredentialProtocol = V2CredentialProtocol<
  [LegacyIndyCredentialFormatService, AnonCredsCredentialFormatService]
>

type IndustrialProofProtocol = V2ProofProtocol<
  [LegacyIndyProofFormatService, AnonCredsProofFormatService]
>

type IndustrialAgentModules = {
  askar: AskarModule
  anoncreds: AnonCredsModule
  indyVdr: IndyVdrModule
  dids: DidsModule
  connections: ConnectionsModule
  credentials: CredentialsModule<[IndustrialCredentialProtocol]>
  proofs: ProofsModule<[IndustrialProofProtocol]>
}

export type IndustrialAgent = Agent<IndustrialAgentModules>

export class AgentFactory {
  public static async create(
    name: string,
    walletKey: string,
    transport?: AgentTransportConfig
  ): Promise<IndustrialAgent> {

    const genesisResponse = await fetch('https://test.bcovrin.vonx.io/genesis')
    const genesisTransactions = await genesisResponse.text()

    const config: InitConfig = {
      label: name,
      walletConfig: {
        id: `wallet-${name.toLowerCase().replace(/\s/g, '-')}`,
        key: walletKey,
      },
      logger: new ConsoleLogger(LogLevel.info),
      // Solo se declaran endpoints si hay transporte (servidor)
      ...(transport ? { endpoints: transport.endpoints } : {}),
    }

    const credentialProtocol: IndustrialCredentialProtocol = new V2CredentialProtocol({
      credentialFormats: [
        new LegacyIndyCredentialFormatService(),
        new AnonCredsCredentialFormatService(),
      ],
    })

    const proofProtocol: IndustrialProofProtocol = new V2ProofProtocol({
      proofFormats: [
        new LegacyIndyProofFormatService(),
        new AnonCredsProofFormatService(),
      ],
    })

    const agent = new Agent<IndustrialAgentModules>({
      config,
      dependencies: agentDependencies,
      modules: {
        // --- Infraestructura cripto ---
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

        // --- Protocolos DIDComm ---
        connections: new ConnectionsModule({
          autoAcceptConnections: true,
        }),

        credentials: new CredentialsModule({
          autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
          credentialProtocols: [credentialProtocol],
        }),

        proofs: new ProofsModule({
          autoAcceptProofs: AutoAcceptProof.ContentApproved,
          proofProtocols: [proofProtocol],
        }),
      },
    })

    // --- Registrar transportes ---
    agent.registerOutboundTransport(new HttpOutboundTransport())

    if (transport) {
      agent.registerInboundTransport(
        new HttpInboundTransport({ port: transport.port })
      )
    }

    return agent
  }
}