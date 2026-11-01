// Builds main.js: the plugin, with the render worker's bundle embedded as a string.
// `--watch` rebuilds the plugin on change (the worker is bundled once per start).
//
// main.js uses no Node built-ins: included files are read through Obsidian's vault
// (src/vault-reader.ts), and everything that touches the renderer's engine is in the worker.
// None is marked external, so an import of one fails the build instead of reaching main.js.
import { context } from 'esbuild';
import { licenseBanner } from './licenses.mjs';
import { bundleWorker, rendererFiles } from './worker-bundle.mjs';

const watch = process.argv.includes('--watch');
const workerSource = await bundleWorker();

const embedWorker = {
  name: 'embed-worker',
  setup(build) {
    build.onResolve({ filter: /^virtual:render-worker$/ }, () => ({ path: 'render-worker', namespace: 'embed' }));
    build.onLoad({ filter: /.*/, namespace: 'embed' }, () => ({
      contents: `export default ${JSON.stringify(workerSource)};`,
      loader: 'js'
    }));
  }
};

const ctx = await context({
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  plugins: [embedWorker, rendererFiles],
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  logLevel: 'info',
  banner: { js: '/* SPICE Schematic Preview: built from https://github.com/Reonarudo/spice-schematic-preview */' + '\n' + await licenseBanner() }
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
