# PROYECTO: TFG - Arquitectura SSI Industrial

## 1. Stack Tecnológico (Hardware y Software)
* **Entorno:** WSL (Ubuntu) sobre Windows 10/11.
* **Motor:** Node.js v20.x (portátil principal: v18.16.0 funciona de facto; portátil B: v20.20.0).
* **Ejecución:** TypeScript corriendo con `tsx` (vía `npx tsx` o `./node_modules/.bin/tsx` si el PATH de WSL está contaminado con el PATH de Windows).
* **Framework SSI:** `@credo-ts` (versión ^0.5.x).
* **Motor Criptográfico:** `@hyperledger/anoncreds-nodejs` (^0.3.4) - Importación oficial nativa, sin hacks.
* **IDE:** Cursor conectado a WSL.

## 2. Topología de Red
* **Blockchain (Notario):** BCovrin Testnet (Identidades Indy).
* **Túnel de Desarrollo:** `ngrok` (dos cuentas independientes, una por máquina — Issuer en puerto 3001, Verifier en puerto 3002).
* **Wallet del Operario (Holder):** BC Wallet (app oficial del Gobierno de British Columbia, basada en Bifold/Credo).
* **Mediador DIDComm:** `mediator.digitaltrust.gov.bc.ca` (mediador público de BC, usado automáticamente por BC Wallet para retransmitir mensajes DIDComm al móvil).

## 3. Infraestructura Registrada en BCovrin

### Issuer 1 — Oficina Técnica (Orden de Trabajo)
- **Wallet:** Servidor-Autonomo-V13 / clave-maestra-V13
- **DID:** did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM
- **Schema:** Orden-Mantenimiento v1.0.7 — atributos: id_orden, equipo, tarea, fecha
- **CredDef ID:** did:indy:bcovrin:test:UMJRJ7GzWpUeYBbQSMsdGM/anoncreds/v0/CLAIM_DEF/3149116/default
- **Seed:** en .seed-backup (PERDIDA — wallet local intacta)
- **Puerto emisor:** 3001

### Issuer 2 — Directiva ATEX
- **Wallet:** Servidor-ATEX-V1 / clave-maestra-ATEX-V1
- **DID:** did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B
- **Schema:** Certificado-ATEX v1.0.0 — atributos: id_cert, trabajador, zona, nivel_atex, fecha_expiracion
- **CredDef ID:** did:indy:bcovrin:test:Lt3iLG3iFaWavozFbfNi7B/anoncreds/v0/CLAIM_DEF/3152041/default
- **Seed:** en .seed-backup-atex
- **Puerto emisor:** 3003

### Issuer 3 — Escuela de Soldadores
- **Wallet:** Servidor-Soldador-V1 / clave-maestra-Soldador-V1
- **DID:** did:indy:bcovrin:test:BE1hcUv3FSh31ihbfKTo6i
- **Schema:** Homologacion-Soldador v1.0.0 — atributos: id_cert, trabajador, proceso, norma, fecha_expiracion
- **CredDef ID:** did:indy:bcovrin:test:BE1hcUv3FSh31ihbfKTo6i/anoncreds/v0/CLAIM_DEF/3152060/default
- **Seed:** en .seed-backup-soldador
- **Puerto emisor:** 3004

### Verifier — Control de Acceso
- **Wallet:** Verificador-Acceso-V1 / clave-verificador-V1
- **Puerto:** 3002
- **ProofRequest:** combinada — exige las 3 credenciales simultáneamente
- **Revelados:** equipo, tarea (OT) · zona, nivel_atex (ATEX) · proceso, norma (Soldador)
- **No revelados:** id_orden, fecha (OT) · id_cert, trabajador, fecha_expiracion (ATEX y Soldador)

## 4. Fase de Operación — Emisión (COMPLETADA)
El servidor emisor (`src/issuer.ts`) se ejecutó con éxito. Flujo completo validado con BC Wallet real:

* **AgentFactory ampliado:** Ahora soporta transporte HTTP (inbound + outbound), módulos DIDComm (ConnectionsModule, CredentialsModule con V2 + AnonCreds, ProofsModule con V2 + AnonCreds). Tipos `IndustrialAgent` exportados para inferencia limpia de TypeScript sin casteos.
* **Protocolo de conexión:** Out-Of-Band (OOB) 1.1 → DID Exchange 1.1. El servidor genera una invitación multi-uso con QR en terminal. BC Wallet escanea, establece canal DIDComm cifrado peer-to-peer a través del mediador de BC.
* **Protocolo de emisión:** Issue Credential 2.0 (`issue-credential/2.0`). El servidor detecta la conexión completada via evento `ConnectionStateChanged`, y automáticamente envía una oferta de credencial AnonCreds. BC Wallet genera un blinded master secret (ZKP), lo envía como request, el servidor firma y emite la credencial, BC Wallet la verifica contra BCovrin y la almacena. Ciclo completo: `offer-sent → request-received → credential-issued → done`.
* **Credencial emitida:** Orden de Mantenimiento con atributos: `id_orden` (timestamp único), `equipo` (Turbina-T4-Sector7), `tarea` (Mantenimiento preventivo trimestral), `fecha` (fecha de emisión).
* **Nota técnica:** El `issuer.ts` DEBE usar la misma identidad de wallet que `setup.ts` (nombre: `Servidor-Autonomo-V13`, clave: `clave-maestra-V13`) porque la wallet local contiene las claves privadas de la CredDef necesarias para firmar credenciales.

## 5. Fase de Operación — Verificación (COMPLETADA)
El verificador (`src/verifier.ts`) se ejecutó con éxito en hardware real (dos portátiles físicos separados). Flujo completo validado end-to-end:

* **Arquitectura de despliegue validada:** Issuer en Portátil A (puerto 3001, ngrok cuenta A) + Verifier en Portátil B (puerto 3002, ngrok cuenta B). Las dos máquinas no se comunican entre sí — toda la comunicación pasa por BC Wallet y BCovrin.
* **Protocolo de verificación:** Present Proof 2.0 (`present-proof/2.0`) con formato AnonCreds.
* **Revelación selectiva implementada:** La Proof Request solicita únicamente los atributos `equipo` y `tarea`. Los atributos `id_orden` y `fecha` nunca salieron del wallet del operario, demostrando la ventaja de privacidad de AnonCreds frente a tokens tradicionales.
* **Restricción de confianza:** La Proof Request incluye `cred_def_id` como restricción, garantizando que solo se aceptan credenciales emitidas por el Issuer oficial registrado en BCovrin.
* **Resultado validado en consola:**
  ```
  ✅  ACCESO CONCEDIDO — PRUEBA ZKP VÁLIDA
  · grupo_tarea: Mantenimiento preventivo trimestral
  · grupo_equipo: Turbina-T4-Sector7
  [PRIVACIDAD] Los atributos NO revelados (id_orden, fecha)
               nunca salieron del wallet del operario. ✓
  ```
* **BC Wallet confirmó:** "Information sent successfully" tras presentar la ZKP.
* **Nota técnica WSL portátil B:** Si el PATH de WSL incluye el PATH de Windows, `npx` resuelve al binario de Windows. Solución permanente: añadir `appendWindowsPath = false` en `/etc/wsl.conf` y ejecutar `wsl --shutdown` desde PowerShell. Adicionalmente, instalar con `npm install --ignore-scripts` + `npm rebuild` para compilar los bindings nativos de Rust correctamente en Linux.

## 6. Estado de Implementación

| Fase | Estado |
|------|--------|
| Infraestructura — DID, Schema, CredDef × 3 issuers | ✅ Completado |
| Emisión OT — Issuer con QR OOB, credencial AnonCreds | ✅ Completado |
| Emisión ATEX — Issuer independiente, credencial AnonCreds | ✅ Completado |
| Emisión Soldador — Issuer independiente, credencial AnonCreds | ✅ Completado |
| Verificación — ProofRequest combinada ZKP (3 credenciales) | ✅ Completado |
| Formulario web de creación de OT | 🔄 Pendiente |
| Memoria del TFG | 🔄 En curso |

## 7. Archivos del Proyecto
* `src/config/AgentFactory.ts` — Factoría de agentes Credo con soporte de transporte HTTP y módulos DIDComm. Tipado estricto `IndustrialAgent` sin casteos.
* `src/setup.ts` — Orquestador de infraestructura: genera DID Endorser, registra Schema y CredDef en BCovrin.
* `src/issuer.ts` — Servidor emisor: levanta agente DIDComm, genera QR OOB, emite credenciales AnonCreds automáticamente al detectar conexión.
* `src/verifier.ts` — Punto de control de acceso: genera QR OOB independiente, solicita ZKP con revelación selectiva (`equipo`, `tarea`), valida criptográficamente contra BCovrin.
* `src/index.ts` — Placeholder para el servidor principal (futuro).
* `.seed-backup` — Seed de recuperación del DID (NO versionar).
* `.gitignore` — Exclusiones de Git.

## 8. Notas Operativas
* **Ejecución de setup:** `npm start` (ejecuta `tsx src/setup.ts`).
* **Ejecución del emisor:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuer.ts` (requiere ngrok corriendo en otra terminal con `ngrok http 3001`).
* **Ejecución del verificador:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/verifier.ts` (requiere ngrok corriendo en otra terminal con `ngrok http 3002`, cuenta ngrok distinta a la del emisor).
* **Orden de prueba:** (1) Lanzar issuer y escanear su QR con BC Wallet → aceptar credencial. (2) Lanzar verifier y escanear su QR → aceptar presentar prueba.
* **Riesgo BCovrin:** La testnet puede purgar identidades sin previo aviso. Mitigación: el día de la presentación, ejecutar `setup.ts` 15 minutos antes para verificar/regenerar infraestructura. Plan B documentado: migración a VON Network local (Docker).
* **Instalación en máquina nueva (WSL):** Usar `npm install --ignore-scripts` + `npm rebuild` para evitar conflictos con scripts de dependencias que fuerzan `pnpm`. Asegurarse de que el PATH de WSL no incluye el PATH de Windows (`appendWindowsPath = false` en `/etc/wsl.conf`).
- **Ejecución issuerAtex:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerAtex.ts`
- **Ejecución issuerSoldador:** `NGROK_ENDPOINT=https://xxx.ngrok-free.app npx tsx src/issuerSoldador.ts`
- **Estrategia demo defensa:** ATEX y Soldador se emiten en casa previamente. En vivo solo se encienden OT (puerto 3001) y Verifier (puerto 3002) en dos portátiles distintos con dos cuentas ngrok independientes.