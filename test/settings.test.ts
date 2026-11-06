// Settings as stored in the data file, and the definitions Obsidian draws the tab from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SpiceSettingTab, readSettings } from '../src/settings';
import type SpicePlugin from '../src/main';

test('the BOM style is read from the data file; a missing or unknown value is plain', () => {
  assert.equal(DEFAULT_SETTINGS.bomStyle, 'plain');
  for (const style of ['plain', 'compact', 'card'] as const) assert.equal(readSettings({ bomStyle: style }).bomStyle, style);
  for (const stored of [undefined, null, {}, { bomStyle: 'Card' }, { bomStyle: 'fancy' }, { bomStyle: 2 }]) {
    assert.equal(readSettings(stored).bomStyle, 'plain', JSON.stringify(stored));
  }
  // The other settings are untouched by it.
  assert.deepEqual(readSettings({ bomStyle: 'card' }), { ...DEFAULT_SETTINGS, bomStyle: 'card' });
});

test('the BOM table style is a dropdown after Follow dark themes', () => {
  const tab = new SpiceSettingTab({} as never, { settings: DEFAULT_SETTINGS } as unknown as SpicePlugin);
  // Every definition here is a setting with a control, not a heading or a group.
  const definitions = tab.getSettingDefinitions() as { name: string; desc: string; control: unknown }[];
  assert.deepEqual(definitions.map((item) => item.name), ['Dialect', 'Layout timeout', 'Follow dark themes', 'BOM table style', 'Debug logging']);
  const style = definitions[3]!;
  assert.deepEqual(style.control, {
    type: 'dropdown', key: 'bomStyle', options: { plain: 'Plain (the default)', compact: 'Compact', card: 'Card' }, defaultValue: 'plain'
  });
  assert.equal(style.desc, 'How the BOM view\'s table is drawn. Plain uses the theme\'s own table styling; Compact is a dense full-width table; ' +
    'Card puts the table on the schematic\'s card with a summary line.');
});

test('a setting change goes through the plugin, read as stored settings are', async () => {
  const changes: unknown[] = [];
  const plugin = { settings: DEFAULT_SETTINGS, updateSettings: async (change: unknown) => { changes.push(change); } };
  const tab = new SpiceSettingTab({} as never, plugin as unknown as SpicePlugin);
  await tab.setControlValue('bomStyle', 'compact');
  await tab.setControlValue('bomStyle', 'nonsense');
  assert.deepEqual(changes, [{ bomStyle: 'compact' }, { bomStyle: 'plain' }]);
  assert.equal(tab.getControlValue('bomStyle'), 'plain');
});
