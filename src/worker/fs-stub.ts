// The SPICE parsers are Emscripten builds for Node with their wasm embedded. Their only `fs` use
// is a file-reading path that never runs when the binary is embedded, and a stdin reader nothing
// calls; this stands in for both.
export function readFileSync(): never {
  throw new Error('there is no file system in the render worker');
}
export function readSync(): never {
  throw new Error('there is no file system in the render worker');
}
export default { readFileSync, readSync };
