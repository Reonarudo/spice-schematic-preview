// The live run: a real Obsidian, launched with a throwaway profile and a throwaway vault holding
// the built plugin, examples/view-toggle.md and the model file it includes, driven over the
// Chrome DevTools Protocol. Covers what the unit tests cannot: the processor in Reading view and
// Live Preview, attributes recovered from the note, the worker inside Obsidian, included files
// read from the vault and redrawn when they change, and the toggle's persistence across
// re-render, reopen and plugin reload.
//
// Usage: npm run build && npm run test:live
// Set OBSIDIAN_EXECUTABLE to use an Obsidian other than /Applications/Obsidian.app.
// Screenshots (light and dark, both views) are written to the directory it prints.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = 'spice';
const FIXTURE = {
  file: 'examples/view-toggle.md',
  /** Files beside the note that its blocks include. */
  includes: ['examples/models/opamp.inc', 'examples/notes/relative-includes.md'],
  /** Spice blocks in the note, in document order. */
  fences: 12,
  /** Positions of the two blocks with identical bodies. */
  twins: [5, 6],
  /** Position of the block with a netlist error. */
  broken: 3,
  /** Position of the block whose include is missing: an error at its include. */
  missing: 11,
  /** Position of the block that includes models/opamp.inc. */
  included: 9,
  /** Position of the block with its own dialect. */
  dialect: 10
};
const EXECUTABLE = process.env.OBSIDIAN_EXECUTABLE ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), `${BASE}-live-`));
const vault = join(root, 'vault');
const shots = join(root, 'screenshots');
const pluginDir = join(vault, '.obsidian', 'plugins', manifest.id);
await mkdir(pluginDir, { recursive: true });
await mkdir(shots);
for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(file, join(pluginDir, file));
await cp(FIXTURE.file, join(vault, 'view-toggle.md'));
for (const file of FIXTURE.includes) await cp(file, join(vault, file.slice('examples/'.length)), { recursive: true });
await writeFile(join(vault, 'other.md'), '# Another note\n');
// A real file just above the vault, which notes/relative-includes.md names and must not read.
await writeFile(join(root, 'outside.inc'), '.subckt opamp a b c\n.ends\n');
await writeFile(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify([manifest.id]));
await writeFile(join(vault, '.obsidian', 'app.json'), JSON.stringify({ defaultViewMode: 'preview', livePreview: true }));

const app = spawn(EXECUTABLE, [`--user-data-dir=${join(root, 'profile')}`, '--remote-debugging-port=0'], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Obsidian did not open a DevTools port')), 30000);
  app.stderr.on('data', (chunk) => {
    const found = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk));
    if (found) { clearTimeout(timer); resolve(found[1]); }
  });
  app.on('exit', (code) => reject(new Error(`Obsidian exited with ${code}`)));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let page;
const checks = [];
async function check(name, body) {
  await body();
  checks.push(name);
  console.log(`ok ${checks.length} - ${name}`);
}

/** The window whose URL contains `fragment`, once it exists. */
async function windowWith(fragment) {
  for (let i = 0; i < 120; i++) {
    const found = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().includes(fragment));
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`no window at ${fragment}`);
}

/** Wrapper states in document order: view, key, and what the rendering slot holds. */
const state = (scope) => page.evaluate(({ base, scope }) => {
  const container = scope === 'live'
    ? app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-source-view')
    : app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view');
  return [...container.querySelectorAll(`.${base}-fence`)].map((fence) => {
    const slot = fence.querySelector(`.${base}-rendering`);
    return {
      view: fence.getAttribute('data-view') ?? 'rendering',
      key: fence.getAttribute('data-fence-key'),
      holds: slot.querySelector(':scope > svg, :scope > figure, :scope > div[role="img"]') ? 'diagram'
        : slot.querySelector(`.${base}-error`) ? 'error'
        : slot.querySelector(`.${base}-loading`) ? 'loading' : 'empty',
      caption: slot.querySelector('figcaption')?.textContent ?? null,
      align: [...(slot.querySelector('figure')?.classList ?? [])].find((name) => name.startsWith(`${base}-align-`)) ?? null,
      alt: slot.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null,
      error: slot.querySelector(`.${base}-error pre`)?.textContent ?? null,
      texts: [...slot.querySelectorAll('svg text')].map((text) => text.textContent),
      source: fence.querySelector(':scope > pre > code')?.textContent ?? null,
      sourceShown: getComputedStyle(fence.querySelector(':scope > pre')).display !== 'none',
      renderingShown: getComputedStyle(slot).display !== 'none'
    };
  });
}, { base: BASE, scope });

/** Reading view renders sections lazily; scroll through so every block is drawn, and wait until none is loading. */
async function settle(scope, count = FIXTURE.fences) {
  for (let i = 0; i < 80; i++) {
    await page.evaluate((scope) => {
      const view = app.workspace.activeLeaf.view;
      const scroller = scope === 'live'
        ? view.containerEl.querySelector('.cm-scroller')
        : view.containerEl.querySelector('.markdown-preview-view');
      scroller.scrollTop = scroller.scrollHeight;
    }, scope);
    await sleep(100);
    const fences = await state(scope);
    if (fences.length === count && fences.every((fence) => fence.holds !== 'loading' && fence.holds !== 'empty')) {
      return fences;
    }
  }
  const last = await state(scope);
  throw new Error(`${scope}: expected ${count} settled blocks, have ${JSON.stringify(last.map((fence) => fence.holds))}`);
}

const click = (scope, position) => page.evaluate(({ base, scope, position }) => {
  const selector = scope === 'live' ? '.markdown-source-view' : '.markdown-reading-view';
  const container = app.workspace.activeLeaf.view.containerEl.querySelector(selector);
  const button = container.querySelectorAll(`.${base}-fence > .${base}-toggle`)[position];
  button.scrollIntoView({ block: 'center' });
  const rect = button.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, hit: hit === button || button.contains(hit) ? null : `${hit?.tagName}.${hit?.className}` };
}, { base: BASE, scope, position }).then(async ({ x, y, hit }) => {
  if (hit) throw new Error(`block ${position}'s toggle is covered by ${hit}`);
  await page.mouse.click(x, y);
  await sleep(50);
});

const setMode = (mode) => page.evaluate(async (mode) => {
  const leaf = app.workspace.activeLeaf;
  const viewState = leaf.getViewState();
  viewState.state.mode = mode === 'live' ? 'source' : 'preview';
  viewState.state.source = false;
  await leaf.setViewState(viewState);
}, mode);

const storedToggles = async () => {
  await sleep(400);
  const data = JSON.parse(await readFile(join(pluginDir, 'data.json'), 'utf8').catch(() => '{}'));
  return data.toggles?.['view-toggle.md'] ?? null;
};

const views = (fences) => fences.map((fence, index) => fence.view === 'source' ? index : -1).filter((index) => index >= 0);

try {
  browser = await chromium.connectOverCDP(endpoint);
  const starter = await windowWith('starter');
  await starter.evaluate((path) => require('electron').ipcRenderer.sendSync('vault-open', path, false), vault);
  page = await windowWith('index.html');
  // Tall enough for the whole note: Reading view keeps only the sections near the viewport.
  await page.setViewportSize({ width: 1200, height: 4000 });
  await page.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 30000 });
  await page.evaluate(() => app.changeTheme('obsidian'));
  await page.evaluate(async (id) => {
    await app.plugins.setEnable(true);
    await app.plugins.enablePluginAndSave(id);
  }, manifest.id);
  await page.waitForFunction((id) => !!app.plugins.plugins[id], manifest.id, { timeout: 10000 });
  // A fresh vault greets with a modal (trust prompt or welcome); it would sit over every block.
  for (let i = 0; i < 10; i++) {
    const title = await page.evaluate(() => document.querySelector('.modal-container')?.textContent?.slice(0, 80) ?? null);
    if (title === null) break;
    console.log(`# dismissing modal: ${title}`);
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  await check('the renderer does not start until a schematic is drawn', async () => {
    assert.equal(await page.evaluate((id) => !!app.plugins.plugins[id].host, manifest.id), false);
  });

  await page.evaluate(async () => {
    const file = app.vault.getAbstractFileByPath('view-toggle.md');
    await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'preview' } });
  });

  let fences = await settle('reading');
  await check('Reading view draws every spice block, wrapped, and no other fence', async () => {
    assert.equal(fences.length, FIXTURE.fences);
    const unclaimed = await page.evaluate((base) => document.querySelectorAll(`.markdown-reading-view pre > code.language-json`).length
      - document.querySelectorAll(`.${base}-fence code.language-json`).length, BASE);
    assert.equal(unclaimed, 1);
    fences.forEach((fence, index) => {
      if (index === FIXTURE.broken || index === FIXTURE.missing) assert.equal(fence.holds, 'error', `block ${index}`);
      else assert.equal(fence.holds, 'diagram', `block ${index}`);
      assert.equal(fence.view, 'rendering');
      assert.equal(fence.renderingShown, true);
      assert.equal(fence.sourceShown, false);
    });
  });

  await check('attributes are read from the note, including in a list item and a callout', async () => {
    assert.equal(fences[1].caption, 'Figure 1: a voltage divider');
    assert.equal(fences[1].align, `${BASE}-align-center`);
    assert.equal(fences[2].alt, 'a resistor to ground');
    assert.equal(fences[2].align, `${BASE}-align-right`);
    assert.equal(fences[7].caption, 'Inside a list item');
    assert.equal(fences[8].caption, 'Inside a callout');
    assert.equal(fences[8].align, `${BASE}-align-center`);
    assert.equal(fences[FIXTURE.broken].error, 'Q1 needs 3 nodes; found 1.\n\n2 │ Q1 a\n         ^');
    // The dialect attribute: in ngspice `$G_VDD` would end the card and fail the block.
    assert.equal(fences[FIXTURE.dialect].holds, 'diagram');
    assert.ok(fences[FIXTURE.dialect].texts.includes('$g_vdd'), JSON.stringify(fences[FIXTURE.dialect].texts));
  });

  await check('an included file is read from the vault; the source view shows the fence as written', async () => {
    const block = fences[FIXTURE.included];
    assert.equal(block.holds, 'diagram');
    for (const pin of ['opamp', 'inp', 'inn']) assert.ok(block.texts.includes(pin), `${pin} in ${JSON.stringify(block.texts)}`);
    assert.match(block.source, /^\.include models\/opamp\.inc\nV1 in 0 SIN/);
    assert.doesNotMatch(block.source, /\.subckt/);
    assert.equal(fences[FIXTURE.missing].error, 'nowhere.lib could not be read: file not found\n\n1 │ .include nowhere.lib\n             ^');
  });

  await check('editing the included file redraws the block that includes it, in place', async () => {
    const marked = await page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      fence.setAttribute('data-live-mark', 'kept');
      return true;
    }, { base: BASE, position: FIXTURE.included });
    assert.equal(marked, true);
    await page.evaluate(async () => {
      const file = app.vault.getAbstractFileByPath('models/opamp.inc');
      const text = await app.vault.read(file);
      await app.vault.modify(file, text.replace('.subckt opamp inp inn out', '.subckt opamp plus minus out'));
    });
    let texts = [];
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      texts = (await state('reading'))[FIXTURE.included].texts;
      if (texts.includes('plus')) break;
    }
    assert.ok(texts.includes('plus') && texts.includes('minus') && !texts.includes('inp'), JSON.stringify(texts));
    // Drawn again in place: the same block element, not a re-rendered section.
    const kept = await page.evaluate(({ base, position }) => document
      .querySelectorAll(`.markdown-reading-view .${base}-fence`)[position].getAttribute('data-live-mark'), { base: BASE, position: FIXTURE.included });
    assert.equal(kept, 'kept');
    assert.equal((await state('reading')).filter((fence) => fence.holds === 'diagram').length, FIXTURE.fences - 2);
  });

  await check('Refresh included files rereads them and draws every block again', async () => {
    await page.evaluate(async () => {
      const file = app.vault.getAbstractFileByPath('models/opamp.inc');
      await app.vault.modify(file, (await app.vault.read(file)).replace('plus minus', 'inp inn'));
    });
    let texts = [];
    for (let i = 0; i < 50 && !texts.includes('inp'); i++) {
      await sleep(100);
      texts = (await state('reading'))[FIXTURE.included].texts;
    }
    assert.ok(texts.includes('inp') && texts.includes('inn'), JSON.stringify(texts));
    // Mark every drawn schematic; the command must replace each with a fresh drawing.
    await page.evaluate((base) => document.querySelectorAll(`.markdown-reading-view .${base}-rendering svg.${base}`)
      .forEach((svg) => svg.setAttribute('data-live-mark', 'old')), BASE);
    await page.evaluate((id) => app.commands.executeCommandById(`${id}:refresh-includes`), manifest.id);
    let old = -1;
    for (let i = 0; i < 50 && old !== 0; i++) {
      await sleep(100);
      old = await page.evaluate((base) => document.querySelectorAll(`.markdown-reading-view .${base}-rendering svg[data-live-mark]`).length, BASE);
    }
    assert.equal(old, 0);
    assert.equal((await settle('reading')).filter((fence) => fence.holds === 'diagram').length, FIXTURE.fences - 2);
  });

  await check('a missing include recovers once the file is created, and a file above the vault is refused', async () => {
    const missing = () => state('reading').then((now) => now[FIXTURE.missing]);
    await page.evaluate(async () => { await app.vault.create('nowhere.lib', '.model Q PNP\n'); });
    let block = await missing();
    for (let i = 0; i < 50 && block.holds !== 'diagram'; i++) {
      await sleep(100);
      block = await missing();
    }
    assert.equal(block.holds, 'diagram', 'drawn once nowhere.lib exists');
    await page.evaluate(async () => { await app.vault.delete(app.vault.getAbstractFileByPath('nowhere.lib')); });
    for (let i = 0; i < 50 && block.holds !== 'error'; i++) {
      await sleep(100);
      block = await missing();
    }
    assert.match(block.error, /^nowhere\.lib could not be read: file not found/);

    // A note in a subfolder: `../` stays inside the vault and reads; `../../` climbs above it.
    await page.evaluate(async () => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('notes/relative-includes.md'), { state: { mode: 'preview' } });
    });
    const relative = await settle('reading', 2);
    assert.equal(relative[0].holds, 'diagram');
    assert.ok(relative[0].texts.includes('opamp') && relative[0].texts.includes('inp'), JSON.stringify(relative[0].texts));
    assert.equal(relative[1].holds, 'error');
    assert.match(relative[1].error, /^\.\.\/\.\.\/outside\.inc could not be read: the file is outside this vault\n/);
    await page.evaluate(async () => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
    await settle('reading');
  });

  await check('identical bodies share a fence key', async () => {
    const [a, b] = FIXTURE.twins;
    assert.equal(fences[a].key, fences[b].key);
    assert.equal(new Set(fences.map((fence) => fence.key)).size, FIXTURE.fences - 1);
  });

  await check('schematics take dark-theme colours by default, readable on the page, and the setting keeps the white card', async () => {
    // Section 9's schematic: black wires and symbols, part names and the op-amp's pin names;
    // section 10's: the `$g_vdd` net labels.
    const look = () => page.evaluate(({ base, included, dialect }) => {
      const svgs = document.querySelectorAll(`.markdown-reading-view .${base}-fence`);
      const svg = svgs[included].querySelector(`svg.${base}`);
      const labels = svgs[dialect].querySelector(`svg.${base}`);
      const pin = [...svg.querySelectorAll('text')].find((one) => one.textContent === 'inp');
      const part = [...svg.querySelectorAll('text')].find((one) => one.textContent === 'R1');
      const net = [...labels.querySelectorAll('text')].find((one) => one.textContent === '$g_vdd');
      const wire = svg.querySelector('path.wire') ?? svg.querySelector('path');
      const page = getComputedStyle(document.querySelector('.markdown-reading-view .markdown-preview-view')).backgroundColor;
      const css = getComputedStyle(svg);
      return { background: css.backgroundColor, filter: css.filter, scheme: css.colorScheme, page,
        pin: getComputedStyle(pin).fill, part: getComputedStyle(part).fill, net: getComputedStyle(net).fill,
        wire: getComputedStyle(wire).stroke,
        textNormal: getComputedStyle(document.body).getPropertyValue('--text-normal').trim() };
    }, { base: BASE, included: FIXTURE.included, dialect: FIXTURE.dialect });
    const channels = (css) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (css) => {
      const [r, g, b] = channels(css).map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
    const followed = await look();
    assert.equal(followed.background, 'rgba(0, 0, 0, 0)');
    assert.equal(followed.filter, 'none');
    assert.equal(followed.scheme, 'dark');
    for (const name of ['pin', 'part', 'net']) {
      assert.ok(contrast(followed[name], followed.page) >= 4.5, `${name} text ${followed[name]} on ${followed.page}`);
    }
    assert.ok(contrast(followed.wire, followed.page) >= 3, `wire ${followed.wire} on ${followed.page}`);
    // Black line art takes Obsidian's own text colour.
    assert.equal(channels(followed.wire).join(), channels(followed.part).join());
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ followDarkTheme: false }), manifest.id);
    const card = await look();
    assert.equal(card.background, 'rgb(255, 255, 255)');
    assert.equal(card.filter, 'none');
    assert.deepEqual([card.pin, card.part, card.net, card.wire], ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'], 'the renderer\'s own black, exactly');
    await page.screenshot({ path: join(shots, 'reading-dark-card.png') });
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ followDarkTheme: true }), manifest.id);
    assert.equal((await look()).scheme, 'dark');
  });

  await check('without light-dark() support the original colours still draw', async () => {
    // What a Chromium without light-dark() does: every declaration using it is dropped. Spice
    // colours live in presentation attributes (the root's stroke, each label's fill), which remain.
    const fallback = await page.evaluate(({ base, position }) => {
      const svg = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position].querySelector(`svg.${base}`).cloneNode(true);
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        const style = element.getAttribute('style');
        if (style) element.setAttribute('style', style.split(';').filter((part) => !part.includes('light-dark(')).join(';'));
      }
      document.body.append(svg);
      const wire = svg.querySelector('path.wire') ?? svg.querySelector('path');
      const text = [...svg.querySelectorAll('text')].find((one) => one.textContent === 'inp');
      const out = { wire: getComputedStyle(wire).stroke, text: getComputedStyle(text).fill };
      svg.remove();
      return out;
    }, { base: BASE, position: FIXTURE.included });
    assert.deepEqual(fallback, { wire: 'rgb(0, 0, 0)', text: 'rgb(0, 0, 0)' });
  });

  await page.screenshot({ path: join(shots, 'reading-dark.png') });

  const [first, second] = FIXTURE.twins;
  await check('a click flips only that block, and a second click flips it back', async () => {
    await click('reading', second);
    fences = await state('reading');
    assert.deepEqual(views(fences), [second]);
    assert.equal(fences[second].sourceShown, true);
    assert.equal(fences[second].renderingShown, false);
    await click('reading', FIXTURE.broken);
    await click('reading', FIXTURE.broken);
    assert.deepEqual(views(await state('reading')), [second]);
    assert.deepEqual(await storedToggles(), [{ key: fences[second].key, ordinal: 1, index: second }]);
  });

  await page.screenshot({ path: join(shots, 'reading-flipped.png') });

  await check('a flip survives a re-render of the view', async () => {
    await page.evaluate(() => app.workspace.activeLeaf.view.previewMode.rerender(true));
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('a flip survives closing and reopening the note', async () => {
    await page.evaluate(async () => {
      const leaf = app.workspace.activeLeaf;
      await leaf.openFile(app.vault.getAbstractFileByPath('other.md'));
      await leaf.openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('a flip survives reloading the plugin', async () => {
    await page.evaluate(async (id) => {
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
    }, manifest.id);
    await page.evaluate(() => app.workspace.activeLeaf.view.previewMode.rerender(true));
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('Live Preview always shows the schematic and leaves the corner to Obsidian\'s edit button', async () => {
    await setMode('live');
    const live = await settle('live');
    assert.equal(live[8].caption, 'Inside a callout');
    // The flip saved in Reading view does not apply here, as Mermaid has no source view either.
    live.forEach((fence, index) => {
      assert.equal(fence.renderingShown, true, `block ${index}`);
      assert.equal(fence.sourceShown, false, `block ${index}`);
    });
    const corner = await page.evaluate((base) => {
      const block = document.querySelectorAll('.markdown-source-view .cm-preview-code-block')[0];
      block.scrollIntoView({ block: 'center' });
      const toggle = block.querySelector(`.${base}-toggle`);
      const edit = block.querySelector('.edit-block-button').getBoundingClientRect();
      return { toggle: getComputedStyle(toggle).display, x: edit.left + edit.width / 2, y: edit.top + edit.height / 2 };
    }, BASE);
    assert.equal(corner.toggle, 'none');
    await page.mouse.move(corner.x, corner.y);
    await sleep(200);
    const under = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.edit-block-button'), corner);
    assert.equal(under, true);
  });

  await page.screenshot({ path: join(shots, 'live-dark.png') });

  await check('Obsidian\'s edit button opens the fence for editing, as for Mermaid', async () => {
    await page.evaluate(() => app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 0 }));
    await sleep(200);
    const button = await page.evaluate(() => {
      const block = document.querySelectorAll('.markdown-source-view .cm-preview-code-block')[0];
      block.scrollIntoView({ block: 'center' });
      const r = block.querySelector('.edit-block-button').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(button.x, button.y);
    await sleep(150);
    await page.mouse.click(button.x, button.y);
    await sleep(300);
    const editing = await page.evaluate(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      return { line: editor.getLine(editor.getCursor().line - 1), selection: editor.getSelection() };
    });
    assert.match(editing.line, /^```spice/);
    assert.match(editing.selection, /V1 in 0 DC 5\nR1 in out 10k/);
    await page.evaluate(() => app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 0 }));
  });

  await check('in Reading view the button appears on hover, dressed as Obsidian\'s, and names what it shows', async () => {
    await setMode('reading');
    const fences = await settle('reading');
    assert.deepEqual(views(fences), [second]);
    const look = (position) => page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      const button = fence.querySelector(`.${base}-toggle`);
      const f = fence.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { opacity: style.opacity, background: style.backgroundColor, label: button.getAttribute('aria-label'),
        inset: [Math.round(f.right - b.right), Math.round(b.top - f.top)], size: [Math.round(b.width), Math.round(b.height)] };
    }, { base: BASE, position });
    await page.mouse.move(1, 1);
    await sleep(200);
    const away = await look(first);
    assert.equal(away.opacity, '0');
    assert.equal(away.label, 'Show source');
    assert.deepEqual(away.inset, [4, 4]);
    assert.deepEqual(away.size, [28, 24]);
    assert.equal(away.background, 'rgba(0, 0, 0, 0)');
    const box = await page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      fence.scrollIntoView({ block: 'center' });
      const r = fence.getBoundingClientRect();
      return { x: r.left + 40, y: r.top + r.height / 2 };
    }, { base: BASE, position: first });
    await page.mouse.move(box.x, box.y);
    await sleep(200);
    assert.equal((await look(first)).opacity, '1');
    await page.screenshot({ path: join(shots, 'reading-hover-button.png'), clip: { x: box.x - 40, y: box.y - 120, width: 760, height: 240 } });
    assert.equal((await look(second)).label, 'Show schematic');
  });

  await page.screenshot({ path: join(shots, 'reading-hover.png') });

  await check('a flip reaches the same note open in a second Reading view, and flipping back clears the saved data', async () => {
    await page.evaluate(async () => {
      const file = app.vault.getAbstractFileByPath('view-toggle.md');
      const original = app.workspace.activeLeaf;
      const split = app.workspace.getLeaf('split');
      await split.openFile(file, { state: { mode: 'preview' } });
      app.workspace.setActiveLeaf(original, { focus: true });
    });
    await sleep(1500);
    const otherViews = () => page.evaluate((base) => {
      const leaves = app.workspace.getLeavesOfType('markdown').filter((leaf) => leaf !== app.workspace.activeLeaf);
      return [...leaves[0].view.containerEl.querySelectorAll(`.markdown-reading-view .${base}-fence`)]
        .flatMap((fence, index) => fence.getAttribute('data-view') === 'source' ? [index] : []);
    }, BASE);
    assert.deepEqual(await otherViews(), [second]);
    await click('reading', second);
    assert.deepEqual(views(await state('reading')), []);
    await sleep(300);
    assert.deepEqual(await otherViews(), []);
    assert.equal(await storedToggles(), null);
    await page.evaluate(() => {
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf !== app.workspace.activeLeaf) leaf.detach();
    });
  });

  await check('the command shows every schematic in the note again', async () => {
    await click('reading', FIXTURE.broken);
    assert.deepEqual(views(await state('reading')), [FIXTURE.broken]);
    await page.evaluate((id) => app.commands.executeCommandById(`${id}:reset-source-views`), manifest.id);
    assert.deepEqual(views(await state('reading')), []);
    assert.equal(await storedToggles(), null);
  });

  await check('the light theme draws the same', async () => {
    await page.evaluate(() => app.changeTheme('moonstone'));
    const light = await settle('reading');
    const lightLook = await page.evaluate((base) => {
      const svg = document.querySelector(`.markdown-reading-view svg.${base}`);
      const css = getComputedStyle(svg);
      return { scheme: css.colorScheme, filter: css.filter, text: getComputedStyle(svg.querySelector('text')).fill,
        line: getComputedStyle(svg.querySelector('path')).stroke, background: css.backgroundColor };
    }, BASE);
    assert.deepEqual(lightLook, { scheme: 'light', filter: 'none', text: 'rgb(0, 0, 0)', line: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' });
    assert.equal(light.filter((fence) => fence.holds === 'diagram').length, FIXTURE.fences - 2);
    assert.deepEqual(views(light), []);
    await page.screenshot({ path: join(shots, 'reading-light.png') });
  });

  await check('a hover preview of a link to the note draws its schematics with their attributes', async () => {
    await writeFile(join(vault, 'links.md'), '# Links\n\nSee [[view-toggle]] for schematics.\n');
    await sleep(500);
    await page.evaluate(async () => {
      const preview = app.internalPlugins.plugins['page-preview'];
      if (!preview.enabled) await preview.enable();
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('links.md'), { state: { mode: 'preview' } });
    });
    await sleep(800);
    const link = await page.evaluate(() => {
      const a = app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view a.internal-link');
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(link.x - 80, link.y);
    await page.mouse.move(link.x, link.y, { steps: 5 });
    let blocks = [];
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      blocks = await page.evaluate((base) => [...document.querySelectorAll(`.hover-popover .${base}-fence`)].map((fence) => ({
        drawn: !!fence.querySelector(`.${base}-rendering svg.${base}, .${base}-error`), caption: fence.querySelector('figcaption')?.textContent ?? null })), BASE);
      if (blocks.length && blocks.every((block) => block.drawn)) break;
    }
    // The popover renders only the sections in its small viewport: the first two schematics.
    assert.ok(blocks.length >= 2, `${blocks.length} blocks in the preview`);
    assert.ok(blocks.every((block) => block.drawn));
    assert.ok(blocks.some((block) => block.caption === 'Figure 1: a voltage divider'));
    await page.mouse.move(5, 5);
    await page.evaluate(async () => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
    await settle('reading');
  });

  await check('Export to PDF prints every schematic, drawn, with its caption, in light colours and without the button', async () => {
    const pdf = join(root, 'export.pdf');
    // The native save dialog cannot be driven: answer it with a path. Obsidian prints from a window
    // of its own (window.open, as for pop-outs); while it exists, record what it holds. The last
    // record is what was printed.
    await page.evaluate((pdf) => {
      Object.defineProperty(require('@electron/remote').dialog, 'showSaveDialog', {
        configurable: true, writable: true, value: async () => ({ canceled: false, filePath: pdf })
      });
      window.__printed = null;
      window.__printWindow = null;
      const open = window.open;
      window.__restoreOpen = () => { window.open = open; };
      window.open = (...args) => (window.__printWindow = open.apply(window, args));
      window.__printWatch = setInterval(() => {
        const print = window.__printWindow?.document;
        if (!print || !print.querySelector('[class$="-fence"]')) return;
        window.__printed = [...print.querySelectorAll('[class$="-fence"]')].map((fence) => {
          const svg = fence.querySelector('svg:not(.svg-icon)');
          const button = fence.querySelector('button');
          const view = fence.ownerDocument.defaultView;
          return { drawn: !!svg || !!fence.querySelector('[class$="-error"]'), caption: fence.querySelector('figcaption')?.textContent ?? null,
            scheme: svg ? view.getComputedStyle(svg).colorScheme : null, button: button ? view.getComputedStyle(button).opacity : null };
        });
      }, 50);
    }, pdf);
    await page.evaluate(() => app.commands.executeCommandById('workspace:export-pdf'));
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('.modal-container button')].find((button) => /export/i.test(button.textContent)).click());
    let written = false;
    for (let i = 0; i < 240 && !written; i++) {
      await sleep(250);
      written = (await readFile(pdf).catch(() => null))?.length > 1000;
    }
    const printed = await page.evaluate(() => { clearInterval(window.__printWatch); return window.__printed; });
    await page.evaluate(() => window.__restoreOpen());
    assert.ok(written, 'the PDF was written');
    assert.equal(printed?.length, FIXTURE.fences);
    assert.ok(printed.every((block) => block.drawn), JSON.stringify(printed));
    assert.ok(printed.some((block) => block.caption === 'Figure 1: a voltage divider'));
    assert.ok(printed.every((block) => block.scheme === null || block.scheme === 'light'), 'printed in light colours');
    assert.ok(printed.every((block) => block.button === null || block.button === '0'), 'no button on paper');
  });

  await check('settings come from definitions, so Obsidian lists them, and a change keeps the saved flips', async () => {
    await click('reading', FIXTURE.broken);
    const shown = await page.evaluate(async (id) => {
      app.setting.open();
      app.setting.openTabById(id);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const container = app.setting.activeTab.containerEl;
      const names = [...container.querySelectorAll('.setting-item-name')].map((el) => el.textContent);
      const numberField = !!container.querySelector('input[type="number"][min="0.5"][max="60"]');
      const dialects = [...(container.querySelector('select')?.options ?? [])].map((option) => option.value);
      const tab = app.setting.pluginTabs.find((one) => one.id === id);
      await tab.setControlValue('debug', true);
      app.setting.close();
      return { names, numberField, dialects, debug: app.plugins.plugins[id].settings.debug, defined: tab.getSettingDefinitions().map((item) => item.control?.key) };
    }, manifest.id);
    assert.deepEqual(shown.names, ['Dialect', 'Layout timeout', 'Follow dark themes', 'Debug logging']);
    assert.equal(shown.numberField, true, 'drawn from the definitions: the layout timeout is a number field');
    assert.deepEqual(shown.dialects, ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre'], 'the dialect is a dropdown');
    assert.deepEqual(shown.defined, ['dialect', 'layoutTimeout', 'followDarkTheme', 'debug']);
    assert.equal(shown.debug, true);
    const saved = await storedToggles();
    assert.equal(saved?.length, 1, 'the flip made before the change is still saved');
    await click('reading', FIXTURE.broken);
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ debug: false }), manifest.id);
  });

  await check('a new layout timeout restarts the worker and every block draws again', async () => {
    const restarted = await page.evaluate(async (id) => {
      const plugin = app.plugins.plugins[id];
      const wait = () => new Promise((resolve) => setTimeout(resolve, 500));
      const before = plugin.host;
      await plugin.updateSettings({ layoutTimeout: 5 });
      // The old worker is stopped, and the blocks drawn again start a fresh one.
      await wait();
      const after = plugin.host;
      await plugin.updateSettings({ layoutTimeout: 3 });
      await wait();
      return !!before && !!after && !!plugin.host && before !== after && after !== plugin.host;
    }, manifest.id);
    assert.equal(restarted, true);
    await sleep(500);
    const again = await settle('reading');
    assert.equal(again.filter((fence) => fence.holds === 'diagram').length, FIXTURE.fences - 2);
  });

  await check('the renderer runs in a browser Worker and stops with the plugin', async () => {
    const stopped = await page.evaluate(async (id) => {
      const plugin = app.plugins.plugins[id];
      const host = plugin.host;
      await app.plugins.disablePlugin(id);
      return { hadHost: !!host, after: await host.prepare('R1 a 0 1k', 'ngspice', { read: async () => ({ error: 'none' }) }) };
    }, manifest.id);
    assert.equal(stopped.hadHost, true);
    assert.deepEqual(stopped.after, { status: 'unavailable', reason: 'the renderer was stopped' });
  });

  console.log(`\n${checks.length} live checks passed. Screenshots: ${shots}`);
} catch (error) {
  await page?.screenshot({ path: 'test-live-failure.png' }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  await rm(join(root, 'profile'), { recursive: true, force: true }).catch(() => {});
}
