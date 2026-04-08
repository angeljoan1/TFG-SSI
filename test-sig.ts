import { carregarOGenerarClau, construirPayload, signarStatusList, verificarSignatura } from './src/statusList.ts'
const k = carregarOGenerarClau()
const p = construirPayload('https://test.local')
const s = signarStatusList(p, k.privateKeyPem)
console.log('SIGNATURA OK:', verificarSignatura(s, k.publicKeyPem))
