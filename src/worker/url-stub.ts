// `node:url` for the worker bundle. The renderer's prepare.js computes, at load, the folder its
// parsers would be required from; the substituted parser loader (parser-modules.ts) ignores it,
// so the path only has to be a string.
export function fileURLToPath(url: string | URL): string {
  return new URL(String(url)).pathname;
}
export default { fileURLToPath };
