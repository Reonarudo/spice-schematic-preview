import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { DEFAULT_DIALECT, DIALECT_NAMES } from '#renderer/dist/dialect.js';
import type SpicePlugin from './main';

export interface Settings {
  /** The dialect `spice` fences are read in, unless a fence names its own with a `dialect` attribute. */
  dialect: string;
  /** Seconds allowed to lay out one schematic. */
  layoutTimeout: number;
  /** In dark themes, draw schematics in their dark-theme colours (src/theme.ts), as Mermaid follows the theme; off keeps the white card. */
  followDarkTheme: boolean;
  /** Log ignored fence attributes and the netlist reader's notes to the developer console. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = { dialect: DEFAULT_DIALECT, layoutTimeout: 3, followDarkTheme: true, debug: false };

export const TIMEOUT_RANGE = { min: 0.5, max: 60 } as const;

/** How each dialect is offered, as the extension's `spice.dialect` setting describes them. */
const DIALECT_LABELS: Record<string, string> = {
  ngspice: 'ngspice (the default)',
  ltspice: 'LTspice',
  pspice: 'PSpice',
  hspice: 'HSPICE',
  xyce: 'Xyce',
  spectre: 'Spectre'
};

/** Settings as stored, with anything missing, out of range or not a dialect replaced by its default. */
export function readSettings(stored: unknown): Settings {
  const value = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof Settings, unknown>>;
  const timeout = value.layoutTimeout;
  const dialect = typeof value.dialect === 'string' ? value.dialect.trim().toLowerCase() : undefined;
  return {
    dialect: dialect !== undefined && (DIALECT_NAMES as readonly string[]).includes(dialect) ? dialect : DEFAULT_SETTINGS.dialect,
    layoutTimeout: typeof timeout === 'number' && timeout >= TIMEOUT_RANGE.min && timeout <= TIMEOUT_RANGE.max
      ? timeout
      : DEFAULT_SETTINGS.layoutTimeout,
    followDarkTheme: typeof value.followDarkTheme === 'boolean' ? value.followDarkTheme : DEFAULT_SETTINGS.followDarkTheme,
    debug: typeof value.debug === 'boolean' ? value.debug : DEFAULT_SETTINGS.debug
  };
}

/** Names and descriptions of the settings. */
const LABELS = {
  dialect: {
    name: 'Dialect',
    desc: 'The dialect spice code blocks are read in, unless a block names its own with a dialect attribute.'
  },
  layoutTimeout: {
    name: 'Layout timeout',
    desc: `Seconds allowed to lay out one schematic before it is abandoned and reported as a timeout (${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}). ` +
      'A change restarts the layout worker and retries schematics that timed out.'
  },
  followDarkTheme: {
    name: 'Follow dark themes',
    desc: 'In a dark theme, draw schematics on the page in dark-theme colours, as Mermaid diagrams follow the theme: lines and text lightened just enough to read, filled shapes darkened, hues kept. Turn off to keep every schematic on a white card with its exact colours.'
  },
  debug: {
    name: 'Debug logging',
    desc: 'Report ignored fence attributes and the netlist reader\'s notes (an undefined transistor model, a skipped library) in the developer console.'
  }
} as const;

/** The dialects as dropdown options: name to label. */
const DIALECT_OPTIONS: Record<string, string> = Object.fromEntries(DIALECT_NAMES.map((name) => [name, DIALECT_LABELS[name] ?? name]));

/** Whether a layout timeout is in range; the reason it is not, otherwise. */
export function checkTimeout(seconds: number): string | undefined {
  return Number.isFinite(seconds) && seconds >= TIMEOUT_RANGE.min && seconds <= TIMEOUT_RANGE.max
    ? undefined
    : `Enter a number of seconds from ${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}.`;
}

export class SpiceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SpicePlugin) {
    super(app, plugin);
  }

  /** The settings as definitions: Obsidian draws them, and lists them in settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { ...LABELS.dialect, control: { type: 'dropdown', key: 'dialect', options: DIALECT_OPTIONS, defaultValue: DEFAULT_SETTINGS.dialect } },
      { ...LABELS.layoutTimeout, control: { type: 'number', key: 'layoutTimeout', min: TIMEOUT_RANGE.min, max: TIMEOUT_RANGE.max, step: 'any', defaultValue: DEFAULT_SETTINGS.layoutTimeout, validate: checkTimeout } },
      { ...LABELS.followDarkTheme, control: { type: 'toggle', key: 'followDarkTheme', defaultValue: DEFAULT_SETTINGS.followDarkTheme } },
      { ...LABELS.debug, control: { type: 'toggle', key: 'debug', defaultValue: DEFAULT_SETTINGS.debug } }
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof Settings];
  }

  /** Through the plugin, which validates, restarts the renderer or redraws when needed, and keeps the saved flips. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) return;
    const next = readSettings({ ...this.plugin.settings, [key]: value });
    await this.plugin.updateSettings({ [key]: next[key as keyof Settings] });
  }
}
