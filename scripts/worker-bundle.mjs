// Bundles src/worker/entry.ts for a browser Worker and returns its source, which build.mjs embeds
// in main.js. The renderer package's drawing, prepare step, symbol library and parser modules are
// reached through `#renderer/...`, since its public `exports` name only the Node entry point.
//
// What does not bundle as written is replaced, never edited:
// - dist/parser/modules.js `require`s each parser by a computed path; src/worker/parser-modules.ts
//   imports the seven by name instead.
// - dist/skin/symbols.svg, read with readFileSync by the library's worker, is embedded as text.
// - the Node built-ins left (`fs` in the parsers' dead file paths, `crypto` for prepare's sha256,
//   `path` for include keys, `url` for a path computed at load) are small stubs in src/worker/.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
export const rendererDir = dirname(require.resolve('@reonarudo/spice-renderer/package.json'));

/** `#renderer/...` into the installed package, with the parser loader substituted. */
export const rendererFiles = {
  name: 'renderer-files',
  setup(context) {
    const substitute = join(rendererDir, 'dist', 'parser', 'modules.js');
    context.onResolve({ filter: /^#renderer\// }, (args) => {
      const path = join(rendererDir, args.path.slice('#renderer/'.length));
      return { path: path === substitute ? join(root, 'src/worker/parser-modules.ts') : path };
    });
    // prepare.js imports the loader relatively; it gets the substitute too.
    context.onResolve({ filter: /\/modules\.js$/ }, (args) => {
      const path = resolve(args.resolveDir, args.path);
      return path === substitute ? { path: join(root, 'src/worker/parser-modules.ts') } : undefined;
    });
  }
};

export async function bundleWorker({ minify = true } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/worker/entry.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    minify,
    legalComments: 'none',
    loader: { '.svg': 'text' },
    alias: {
      'node:fs': './src/worker/fs-stub.ts',
      'node:crypto': './src/worker/crypto-stub.ts',
      'node:path': './src/worker/path-stub.ts',
      'node:url': './src/worker/url-stub.ts'
    },
    // prepare.js turns `new URL('../vendor/parsers/', import.meta.url)` into a path at load.
    define: { 'import.meta.url': '"file:///spice-renderer/dist/prepare.js"' },
    inject: ['src/worker/node-globals.ts'],
    plugins: [rendererFiles],
    logLevel: 'warning'
  });
  return result.outputFiles[0].text;
}
