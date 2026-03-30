// ARCHIVO: src/diagnostico.ts
import * as paqueteAnoncreds from '@hyperledger/anoncreds-nodejs';

console.log("================================================================")
console.log("--> DIAGNÓSTICO PROFUNDO DEL MOTOR RUST")
console.log("================================================================\n")

console.log("1. ¿Qué ha cargado Node.js exactamente?");
console.log(Object.keys(paqueteAnoncreds));

console.log("\n2. Buscando la exportación 'anoncreds'...");
if (paqueteAnoncreds.anoncreds) {
    console.log("   [OK] El objeto 'anoncreds' existe.");
    console.log("   Funciones que tiene dentro:", Object.keys(paqueteAnoncreds.anoncreds));
    
    if (typeof paqueteAnoncreds.anoncreds.schemaFromJson === 'function') {
        console.log("\n   ✅ RESULTADO: schemaFromJson ESTÁ VIVO Y ACCESIBLE.");
    } else {
        console.log("\n   ❌ RESULTADO: El objeto existe, pero schemaFromJson NO ESTÁ.");
    }
} else {
    console.log("   ❌ RESULTADO FATAL: 'anoncreds' es UNDEFINED. La importación está rota.");
}

console.log("\n3. Buscando exportaciones alternativas por si ha cambiado la versión...");
const alternativas = Object.values(paqueteAnoncreds).filter(val => typeof val === 'object' && val !== null);
alternativas.forEach((alt: any, index) => {
    if (alt.schemaFromJson) {
        console.log(`   [!] Encontrado schemaFromJson en la alternativa ${index + 1}`);
    }
});