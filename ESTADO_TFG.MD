# PROYECTO: TFG - Arquitectura SSI Industrial

## 1. Stack Tecnológico (Hardware y Software)
* **Entorno:** WSL (Ubuntu) sobre Windows 10/11.
* **Motor:** Node.js v18.16.0 (compatible de facto con los bindings de Rust actuales; las dependencias declaran >=20 pero funcionan sin problemas).
* **Ejecución:** TypeScript corriendo con `tsx` (vía `npx tsx`).
* **Framework SSI:** `@credo-ts` (versión ^0.5.x).
* **Motor Criptográfico:** `@hyperledger/anoncreds-nodejs` (^0.3.4) - Importación oficial nativa, sin hacks.
* **IDE:** Cursor conectado a WSL.

## 2. Topología de Red
* **Blockchain (Notario):** BCovrin Testnet (Identidades Indy).
* **Túnel de Desarrollo:** `ngrok` (para exponer el servidor local a internet y conectar con la wallet).
* **Wallet del Operario (Holder):** BC Wallet (app oficial del Gobierno de British Columbia, basada en Bifold/Credo).
* **Mediador DIDComm:** `mediator.digitaltrust.gov.bc.ca` (mediador público de BC, usado automáticamente por BC Wallet para retransmitir mensajes DIDComm al móvil).

## 3. Fase de Infraestructura (COMPLETADA — 2ª iteración)
La primera identidad (`MTLkULgGFc8FHz6cT5r8Un`) perdió permisos de ENDORSER en BCovrin (la testnet purgó roles). Se realizó un reset limpio: borrado de wallets Askar (`~/.afj`, `~/.indy_client`) y re-ejecución de `setup.ts` desde cero.

* **DID del Servidor (nuevo):** `did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM`
* **Esquema Registrado:** `Orden-Mantenimiento` (versión 1.0.7, atributos: `id_orden`, `equipo`, `tarea`, `fecha`)
* **Schema ID:** `did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/SCHEMA/Orden-Mantenimiento/1.0.7`
* **CredDef ID Oficial:** `did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3149116/default`
* **Seed de recuperación:** Guardado en `.seed-backup` (excluido de Git via `.gitignore`).

## 4. Fase de Operación — Emisión (COMPLETADA)
El servidor emisor (`src/issuer.ts`) se ejecutó con éxito. Flujo completo validado con BC Wallet real:

* **AgentFactory ampliado:** Ahora soporta transporte HTTP (inbound + outbound), módulos DIDComm (ConnectionsModule, CredentialsModule con V2 + AnonCreds, ProofsModule con V2 + AnonCreds). Tipos `IndustrialAgent` exportados para inferencia limpia de TypeScript sin casteos.
* **Protocolo de conexión:** Out-Of-Band (OOB) 1.1 → DID Exchange 1.1. El servidor genera una invitación multi-uso con QR en terminal. BC Wallet escanea, establece canal DIDComm cifrado peer-to-peer a través del mediador de BC.
* **Protocolo de emisión:** Issue Credential 2.0 (`issue-credential/2.0`). El servidor detecta la conexión completada via evento `ConnectionStateChanged`, y automáticamente envía una oferta de credencial AnonCreds. BC Wallet genera un blinded master secret (ZKP), lo envía como request, el servidor firma y emite la credencial, BC Wallet la verifica contra BCovrin y la almacena. Ciclo completo: `offer-sent → request-received → credential-issued → done`.
* **Credencial emitida:** Orden de Mantenimiento con atributos: `id_orden` (timestamp único), `equipo` (Turbina-T4-Sector7), `tarea` (Mantenimiento preventivo trimestral), `fecha` (fecha de emisión).
* **Nota técnica:** El `issuer.ts` DEBE usar la misma identidad de wallet que `setup.ts` (nombre: `Servidor-Autonomo-V13`, clave: `clave-maestra-V13`) porque la wallet local contiene las claves privadas de la CredDef necesarias para firmar credenciales.

## 5. Fase Siguiente: Verificación (EN CURSO)
* **Objetivo:** Desarrollar `src/verifier.ts`.
* **Misión:** Crear un punto de control de acceso que genere una Proof Request OOB ("demuéstrame que tienes una Orden de Mantenimiento válida"). BC Wallet responderá con una Zero-Knowledge Proof, y el verificador la validará contra BCovrin en tiempo real.
* **Protocolo esperado:** Present Proof 2.0 (`present-proof/2.0`).
* **Extensión futura:** Revelación selectiva (demostrar atributos específicos sin revelar todos) y verificación de revocación en tiempo real.

## 6. Archivos del Proyecto
* `src/config/AgentFactory.ts` — Factoría de agentes Credo con soporte de transporte HTTP y módulos DIDComm.
* `src/setup.ts` — Orquestador de infraestructura: genera DID, registra Schema y CredDef en BCovrin.
* `src/issuer.ts` — Servidor emisor: levanta agente DIDComm, genera QR OOB, emite credenciales automáticamente.
* `src/index.ts` — Placeholder para el servidor principal (futuro).
* `.seed-backup` — Seed de recuperación del DID (NO versionar).
* `.gitignore` — Exclusiones de Git.

## 7. Notas Operativas
* **Ejecución de setup:** `npm start` (ejecuta `tsx src/setup.ts`).
* **Ejecución del emisor:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuer.ts` (requiere ngrok corriendo en otra terminal con `ngrok http 3001`).
* **Riesgo BCovrin:** La testnet puede purgar identidades sin previo aviso. Mitigación: el día de la presentación, ejecutar `setup.ts` 15 minutos antes para verificar/regenerar infraestructura. Plan B documentado: migración a VON Network local (Docker).
* **Node.js:** Actualmente v18.16.0. Funciona pero los paquetes declaran >=20. Considerar actualización vía `nvm` si surgen problemas con futuras dependencias.