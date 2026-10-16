// Prueba: los colores se traducen al inglés aunque no estén en el diccionario (palabra por palabra). Uso: node pruebas/i18n-colores.test.mjs
globalThis.localStorage = { getItem: () => "en", setItem() {} };
const { t } = await import("../src/i18n.js");
const { colorLabel } = await import("../src/importar-tumisoft.js");
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
const cases = { Negro: "Black", "Azul Claro": "Light Blue", "Verde Oliva": "Olive Green", "Rosa Palo": "Dusty Pink", "Azul Marino": "Navy Blue", "Marrón": "Brown", Terracota: "Terracotta", "Off White": "Off White" };
for (const [es, en] of Object.entries(cases)) check(`«${es}» → «${en}»`, t(es) === en);
check("Un texto que no es color no se traduce mal («Blusa Seda»)", t("Blusa Seda") === "Blusa Seda");
check("Color desconocido queda igual («Turmalina»)", t("Turmalina") === "Turmalina");
check("Importador: «MARRON» → «Marrón», «AZUL CLARO» → «Azul Claro»", colorLabel("MARRON") === "Marrón" && colorLabel("AZUL CLARO") === "Azul Claro");
console.log(ok ? "TODO OK" : "HAY FALLAS"); process.exit(ok ? 0 : 1);
