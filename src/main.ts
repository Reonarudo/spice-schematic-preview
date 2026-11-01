import {
  FileSystemAdapter, MarkdownRenderChild, Plugin, TFile, debounce,
  type MarkdownPostProcessorContext
} from 'obsidian';
import { join } from 'node:path';
import { nodeFileReader } from '#renderer/dist/fileReader.js';
import WORKER_SOURCE from 'virtual:render-worker';
import { parseAttributes, type FenceAttributes } from './attributes';
import { createResults, type Results } from './cache';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { drawBlock } from './block';
import { BASE_CLASS, buildFence, fenceKey, isSourceView, setView } from './fence';
import { createHost, type Host, type WorkerLike } from './host';
import { IncludeFiles, readerFor } from './include-files';
import { locate, scanFences } from './info';
import { DEFAULT_SETTINGS, SpiceSettingTab, readSettings, type Settings } from './settings';
import { ToggleStore } from './toggle';

/** The language word Obsidian matches for this plugin's code blocks. */
const WORD = BASE_CLASS;

/** Body class that turns on the dark-theme colours in styles.css. */
const FOLLOW_DARK_CLASS = `${BASE_CLASS}-follow-dark`;

/** Changes to included files are gathered this long before the blocks using them are drawn again. */
const REDRAW_DELAY_MS = 100;

/** Where a code block sits in its note: its attributes, and its place among the note's spice fences. */
interface Placement {
  attributes: FenceAttributes;
  diagnostics: string[];
  /** Fence keys of every spice fence in the note, in order, and this block's index among them. */
  keys?: string[];
  index?: number;
}

/** One rendered code block; Obsidian unloads it when the block leaves the view or the note changes. */
class FenceChild extends MarkdownRenderChild {
  live = true;

  constructor(el: HTMLElement, private readonly forget: () => void) {
    super(el);
  }

  onunload(): void {
    this.live = false;
    this.forget();
  }
}

/** A drawn block, so a flip in one view of a note reaches its other views, and a changed include redraws it. */
interface Drawn {
  notePath: string;
  wrapper: HTMLElement;
  /** The include cache key the block was last prepared under. */
  includeKey?: string;
  /** Re-read the block's place in the note and show the remembered view. */
  sync(): Promise<void>;
  /** Prepare and draw the block again, keeping what it shows until the new drawing is ready. */
  redraw(): void;
}

export default class SpicePlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private toggles!: ToggleStore;
  /** The renderer, started by the first schematic drawn (`renderer()`), not at load. */
  private host: Host | undefined;
  private results: Results | undefined;
  private unloaded = false;
  private includes!: IncludeFiles;
  private workerUrl: string | undefined;
  private readonly drawn = new Set<Drawn>();
  private readonly stale = new Set<string>();
  private readonly saveSoon = debounce(() => void this.persist(), 200, true);
  private readonly redrawStale = debounce(() => {
    const keys = new Set(this.stale);
    this.stale.clear();
    for (const drawn of this.drawn) if (drawn.includeKey !== undefined && keys.has(drawn.includeKey)) drawn.redraw();
  }, REDRAW_DELAY_MS, true);

  async onload(): Promise<void> {
    const data = (await this.loadData()) as { settings?: unknown; toggles?: unknown } | null;
    this.settings = readSettings(data?.settings);
    this.toggles = new ToggleStore(data?.toggles, () => this.saveSoon());

    const adapter = this.app.vault.adapter;
    const vault = {
      basePath: () => adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined,
      fullPath: (path: string) => join((adapter as FileSystemAdapter).getBasePath(), path)
    };
    this.includes = new IncludeFiles(
      (source, dialect, reader) => this.unloaded
        ? Promise.resolve({ status: 'unavailable', reason: 'the renderer was stopped' })
        : this.renderer().host.prepare(source, dialect, reader),
      (note, record) => readerFor(nodeFileReader, vault, note, record)
    );

    this.registerMarkdownCodeBlockProcessor(WORD, (source, el, ctx) => this.process(source, el, ctx));
    this.addSettingTab(new SpiceSettingTab(this.app, this));

    this.addCommand({
      id: 'restart-renderer',
      name: 'Restart renderer',
      callback: () => this.restart()
    });
    this.addCommand({
      id: 'refresh-includes',
      name: 'Refresh included files',
      // Doubles as "retry": a cached timeout is forgotten along with the files.
      callback: () => {
        this.results?.clear();
        this.includes.clear();
        this.redrawAll();
      }
    });
    this.addCommand({
      id: 'reset-source-views',
      name: 'Show every schematic in this note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.toggles.clear(file.path);
          for (const drawn of this.drawn) if (drawn.notePath === file.path) setView(drawn.wrapper, false);
        }
        return true;
      }
    });

    // A change to a file a fence included, or to a folder holding one, redraws that fence.
    const changed = (path: string): void => {
      for (const key of this.includes.invalidate(path)) this.stale.add(key);
      if (this.stale.size > 0) this.redrawStale();
    };
    this.registerEvent(this.app.vault.on('modify', (file) => changed(file.path)));
    this.registerEvent(this.app.vault.on('create', (file) => changed(file.path)));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      changed(file.path);
      this.includes.forget(file.path);
      this.toggles.clear(file.path);
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      changed(oldPath);
      changed(file.path);
      this.includes.forget(oldPath);
      this.toggles.rename(oldPath, file.path);
    }));

    this.applyTheme(document);
    this.registerEvent(this.app.workspace.on('window-open', (win) => this.applyTheme(win.doc)));
  }

  onunload(): void {
    this.unloaded = true;
    this.host?.dispose();
    this.host = undefined;
    this.results = undefined;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    document.body.classList.remove(FOLLOW_DARK_CLASS);
    void this.persist();
  }

  async updateSettings(change: Partial<Settings>): Promise<void> {
    const before = this.settings;
    this.settings = { ...before, ...change };
    await this.persist();
    if (change.layoutTimeout !== undefined && change.layoutTimeout !== before.layoutTimeout) this.restart();
    else if (change.dialect !== undefined && change.dialect !== before.dialect) this.redrawAll();
    if (change.followDarkTheme !== undefined) this.applyTheme(document);
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, toggles: this.toggles.toJSON() });
  }

  /**
   * The renderer, started on first use: a vault with no spice blocks never starts the worker or
   * loads ELK and the parsers. The include-file machinery stays ready from load; only the worker
   * waits.
   */
  private renderer(): { host: Host; results: Results } {
    if (this.host && this.results) return { host: this.host, results: this.results };
    this.workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const url = this.workerUrl;
    const host = createHost(
      () => new Worker(url, { name: 'spice-schematic-preview' }) as unknown as WorkerLike,
      { timeout: Math.round(this.settings.layoutTimeout * 1000) }
    );
    const results = createResults((prepared) => host.render(prepared), (line) => this.log(line));
    this.host = host;
    this.results = results;
    return { host, results };
  }

  /** Stop the worker; every drawn block is drawn again, starting a fresh one with the current settings, so cached timeouts are retried. */
  private restart(): void {
    this.host?.dispose();
    this.host = undefined;
    this.results = undefined;
    this.redrawAll();
  }

  private redrawAll(): void {
    for (const drawn of this.drawn) drawn.redraw();
  }

  private applyTheme(doc: Document): void {
    doc.body.classList.toggle(FOLLOW_DARK_CLASS, this.settings.followDarkTheme);
  }

  private log(message: string): void {
    if (this.settings.debug) console.debug(`[${this.manifest.id}] ${message}`);
  }

  private async process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const parts = buildFence(el, source, fenceKey(source));
    let placement: Placement | undefined;
    let generation = 0;

    /** Prepare and draw; only the latest draw of this block may fill its slot. */
    const draw = async (): Promise<void> => {
      if (!placement) return;
      const mine = ++generation;
      const { attributes } = placement;
      const dialect = attributes.dialect ?? this.settings.dialect;
      drawn.includeKey = IncludeFiles.key(ctx.sourcePath, dialect, source);
      const outcome = (): Promise<RenderResult> => this.includes.prepare(ctx.sourcePath, source, dialect)
        .then((prepared): RenderResult | Promise<RenderResult> => {
          if (prepared.status !== 'prepared') return prepared;
          if (this.unloaded) return { status: 'unavailable', reason: 'the renderer was stopped' };
          return this.renderer().results.render(prepared.prepared);
        });
      await drawBlock(parts.rendering, outcome, {
        attributes,
        source,
        current: () => child.live && mine === generation,
        report: (message) => this.log(message)
      });
    };

    const drawn: Drawn = {
      notePath: ctx.sourcePath,
      wrapper: parts.wrapper,
      sync: async () => {
        const now = await this.place(source, el, ctx);
        if (now.keys && now.index !== undefined) setView(parts.wrapper, this.toggles.isFlipped(ctx.sourcePath, now.keys, now.index));
      },
      redraw: () => void draw()
    };
    const child = new FenceChild(el, () => this.drawn.delete(drawn));
    ctx.addChild(child);
    this.drawn.add(drawn);

    child.registerDomEvent(parts.button, 'mousedown', (event) => {
      // In Live Preview a click inside the block would move the cursor into it and swap the
      // widget for its Markdown; the toggle is a reader's control, so it keeps the widget.
      event.preventDefault();
      event.stopPropagation();
    });
    child.registerDomEvent(parts.button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const flipped = !isSourceView(parts.wrapper);
      setView(parts.wrapper, flipped);
      // Placed again on click: the note may have changed since this block was drawn.
      void this.place(source, el, ctx).then((now) => {
        if (!now.keys || now.index === undefined) return;
        this.toggles.set(ctx.sourcePath, now.keys, now.index, flipped);
        // The note's other views (Reading view kept beside Live Preview, a split, a pop-out) follow.
        for (const other of this.drawn) if (other !== drawn && other.notePath === ctx.sourcePath) void other.sync();
      });
    });

    placement = await this.place(source, el, ctx);
    if (!child.live) return;
    for (const diagnostic of placement.diagnostics) this.log(`${ctx.sourcePath}: ${diagnostic}`);
    if (placement.keys && placement.index !== undefined) {
      parts.wrapper.setAttribute('data-fence-key', placement.keys[placement.index]!);
      if (this.toggles.isFlipped(ctx.sourcePath, placement.keys, placement.index)) setView(parts.wrapper, true);
    }
    await draw();
  }

  /**
   * The block's attributes and position, from the note text Obsidian has for this section, or
   * from the file when there is none (a block can be rendered outside a note view). Without
   * either, the block renders bare and its flips are not remembered.
   */
  private async place(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<Placement> {
    const section = ctx.getSectionInfo(el);
    let text: string | undefined = section?.text;
    if (text === undefined) {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (file instanceof TFile) text = await this.app.vault.cachedRead(file);
    }
    if (text === undefined) return { attributes: {}, diagnostics: [] };
    const fences = scanFences(text, WORD);
    const index = section
      ? locate(fences, section.lineStart, section.lineEnd, source)
      : locate(fences, 0, Number.MAX_SAFE_INTEGER, source);
    if (index < 0) return { attributes: {}, diagnostics: [] };
    const { attributes, diagnostics } = parseAttributes(fences[index]!.info);
    return { attributes, diagnostics, keys: fences.map((fence) => fenceKey(fence.body)), index };
  }
}
