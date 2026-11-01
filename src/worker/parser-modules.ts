// Stands in for the renderer's dist/parser/modules.js in the worker bundle (scripts/worker-bundle.mjs
// substitutes it). The original `require`s `<directory>/<dialect>.cjs` by a computed path, which a
// bundler cannot follow; here the seven vendored parser modules are imported by name and handed to
// the same registry. Everything else is the original's: one load per module, outcomes kept,
// a Spectre fence loading both of its languages, and the same messages.
import { DIALECTS } from '#renderer/dist/catalogue/dialects.js';
import { loadParser, type ParserFactory } from '#renderer/dist/parser/registry.js';
import { modulesFor } from '#renderer/dist/parser/regions.js';
import hspice from '#renderer/vendor/parsers/hspice.cjs';
import ltspice from '#renderer/vendor/parsers/ltspice.cjs';
import ngspice from '#renderer/vendor/parsers/ngspice.cjs';
import pspice from '#renderer/vendor/parsers/pspice.cjs';
import spectreSpice from '#renderer/vendor/parsers/spectre-spice.cjs';
import spectre from '#renderer/vendor/parsers/spectre.cjs';
import xyce from '#renderer/vendor/parsers/xyce.cjs';

type DialectId = Parameters<typeof modulesFor>[0];

const FACTORIES: Record<string, ParserFactory> = {
  hspice, ltspice, ngspice, pspice, 'spectre-spice': spectreSpice, spectre, xyce
};

/** The original takes the folder to require from; the modules are in the bundle, so it is unused. */
export function parserLoader(_directory: string): (dialect: DialectId) => Promise<void> {
  const outcomes = new Map<DialectId, Promise<void>>();
  const one = (module: DialectId): Promise<void> => {
    let outcome = outcomes.get(module);
    if (!outcome) {
      outcome = load(module).catch((error: unknown) => {
        throw new Error(`The ${module} parser could not be loaded: ${reason(error)}`);
      });
      outcomes.set(module, outcome);
    }
    return outcome;
  };
  return async (dialect) => {
    for (const module of modulesFor(dialect)) await one(module);
  };

  async function load(dialect: DialectId): Promise<void> {
    if (!Object.hasOwn(DIALECTS, dialect) || !Object.hasOwn(FACTORIES, dialect)) throw new Error('not a dialect');
    await loadParser(dialect, FACTORIES[dialect]!);
  }
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0]!.slice(0, 200);
}
