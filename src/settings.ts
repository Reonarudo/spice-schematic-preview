import { PluginSettingTab, Setting, type App } from 'obsidian';
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

export class SpiceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SpicePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName('Dialect')
      .setDesc('The dialect spice code blocks are read in, unless a block names its own with a dialect attribute.')
      .addDropdown((dropdown) => {
        for (const name of DIALECT_NAMES) dropdown.addOption(name, DIALECT_LABELS[name] ?? name);
        dropdown
          .setValue(settings.dialect)
          .onChange(async (value) => this.plugin.updateSettings({ dialect: value }));
      });

    new Setting(containerEl)
      .setName('Layout timeout')
      .setDesc(`Seconds allowed to lay out one schematic before it is abandoned and reported as a timeout (${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}). ` +
        'A change restarts the layout worker and retries schematics that timed out.')
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.layoutTimeout))
        .setValue(String(settings.layoutTimeout))
        .onChange(async (raw) => {
          const seconds = Number(raw);
          if (!Number.isFinite(seconds) || seconds < TIMEOUT_RANGE.min || seconds > TIMEOUT_RANGE.max) return;
          await this.plugin.updateSettings({ layoutTimeout: seconds });
        }));

    new Setting(containerEl)
      .setName('Follow dark themes')
      .setDesc('In a dark theme, draw schematics on the page in dark-theme colours, as Mermaid diagrams follow the theme: lines and text lightened just enough to read, filled shapes darkened, hues kept. Turn off to keep every schematic on a white card with its exact colours.')
      .addToggle((toggle) => toggle
        .setValue(settings.followDarkTheme)
        .onChange(async (value) => this.plugin.updateSettings({ followDarkTheme: value })));

    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Report ignored fence attributes and the netlist reader\'s notes (an undefined model drawn as NPN, a skipped library) in the developer console.')
      .addToggle((toggle) => toggle
        .setValue(settings.debug)
        .onChange(async (value) => this.plugin.updateSettings({ debug: value })));
  }
}
