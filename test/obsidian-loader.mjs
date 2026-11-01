// A module resolve hook (registered in test/setup.ts): `obsidian` resolves to test/obsidian-stub.mjs.
export async function resolve(specifier, context, next) {
  if (specifier === 'obsidian') return { url: new URL('./obsidian-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
