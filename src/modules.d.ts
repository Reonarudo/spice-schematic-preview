// Modules that exist only at build time (scripts/worker-bundle.mjs and scripts/build.mjs).
// `#renderer/...` paths resolve through tsconfig `paths` to the installed package's own typings.

/** The render worker's bundled source, embedded as a string. */
declare module 'virtual:render-worker' {
  const source: string;
  export default source;
}

/** The renderer's symbol library, embedded as text. */
declare module '#renderer/dist/skin/symbols.svg' {
  const text: string;
  export default text;
}

/** One vendored Emscripten parser module: its factory. */
declare module '#renderer/vendor/parsers/*.cjs' {
  import type { ParserFactory } from '#renderer/dist/parser/registry.js';
  const factory: ParserFactory;
  export default factory;
}
