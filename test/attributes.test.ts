import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttributes } from '../src/attributes';

test('a bare fence has no attributes and nothing to report', () => {
  assert.deepEqual(parseAttributes('spice'), { attributes: {}, diagnostics: [] });
});

test('reads every supported key, in any order', () => {
  const { attributes, diagnostics } = parseAttributes(
    'spice {caption="Figure 1: RC filter" alt="A resistor and a capacitor" align="center" class="wide" dialect="ltspice"}'
  );
  assert.deepEqual(attributes, {
    caption: 'Figure 1: RC filter',
    alt: 'A resistor and a capacitor',
    align: 'center',
    class: 'wide',
    dialect: 'ltspice'
  });
  assert.deepEqual(diagnostics, []);
});

test('accepts single or double quotes and unescapes quotes and backslashes', () => {
  assert.equal(parseAttributes(`spice {alt='a "quoted" word'}`).attributes.alt, 'a "quoted" word');
  assert.equal(parseAttributes(`spice {alt="it's"}`).attributes.alt, "it's");
  assert.equal(parseAttributes(`spice {alt='it\\'s'}`).attributes.alt, "it's");
  assert.equal(parseAttributes('spice {alt="a \\"quote\\""}').attributes.alt, 'a "quote"');
  assert.equal(parseAttributes('spice {alt="back\\\\slash"}').attributes.alt, 'back\\slash');
});

test('an unknown key is dropped and the rest is honoured', () => {
  const { attributes, diagnostics } = parseAttributes('spice {algin="center" alt="kept"}');
  assert.deepEqual(attributes, { alt: 'kept' });
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!, /algin/);
});

test('an unknown alignment is dropped and the rest is honoured', () => {
  const { attributes, diagnostics } = parseAttributes('spice {align="middle" alt="kept"}');
  assert.deepEqual(attributes, { alt: 'kept' });
  assert.match(diagnostics[0]!, /middle/);
});

test('a dialect is kept as written, for the renderer to check', () => {
  for (const written of ['ngspice', 'LTspice', 'spectre-spice', 'nope', '']) {
    assert.deepEqual(parseAttributes(`spice {dialect="${written}"}`), { attributes: { dialect: written }, diagnostics: [] }, written);
  }
});

test('a duplicate key keeps the first value', () => {
  const { attributes, diagnostics } = parseAttributes('spice {alt="first" alt="second"}');
  assert.equal(attributes.alt, 'first');
  assert.match(diagnostics[0]!, /Duplicate/);
});

test('a malformed block is dropped whole, never partially applied', () => {
  for (const info of [
    'spice {alt="unterminated',
    'spice {alt="ok" caption=unquoted}',
    'spice {alt="ok" garbage}',
    'spice {alt="ok"',
    'spice alt="ok"',
    'spice {'
  ]) {
    const { attributes, diagnostics } = parseAttributes(info);
    assert.deepEqual(attributes, {}, info);
    assert.equal(diagnostics.length, 1, info);
  }
});

test('never throws, whatever the info string', () => {
  const inputs = [
    'spice', 'spice {}', 'spice {   }', 'spice {"}', "spice {'''}", 'spice {a=}',
    'spice {=""}', 'spice {alt=""}', 'spice {' + 'a="b" '.repeat(500) + '}',
    'spice {alt="' + '\\'.repeat(100) + '"}', 'spice {alt="\u0000￿"}'
  ];
  for (const info of inputs) {
    assert.doesNotThrow(() => parseAttributes(info), info);
  }
});

test('an empty value is a value, not a missing attribute', () => {
  assert.deepEqual(parseAttributes('spice {alt=""}').attributes, { alt: '' });
});
