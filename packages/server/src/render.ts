import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { writeAtomic, type Project } from '@zark/core';
import type { Browser } from 'playwright-core';
import { embedHash, readHash, renderHash, targetFile, type RenderTarget } from './render-hash.js';

const exec = promisify(execFile);

/**
 * Same pixels on every OS: no hinting, no LCD/subpixel text, software
 * raster, fixed color profile. Text rasterization is what differs between
 * Windows and Linux otherwise.
 */
const RASTER_ARGS = [
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-font-subpixel-positioning',
  '--force-color-profile=srgb',
  '--disable-gpu',
  '--disable-skia-runtime-opts',
  '--disable-partial-raster',
];
const require = createRequire(import.meta.url);

export interface RenderOutput {
  file: string;
  /** Path relative to the architecture dir's parent for rendered/, or under .zark/cache. */
  path: string;
  hash: string;
  skipped: boolean;
}

/**
 * Screenshots the UI's panel-less render route in headless Chromium.
 * The browser is downloaded on first use, not at install time.
 */
export class Renderer {
  private browser?: Promise<Browser>;

  constructor(private baseUrl: () => string, private token: string) {}

  private async launch(): Promise<Browser> {
    const { chromium } = await import('playwright-core');
    try {
      return await chromium.launch({ args: RASTER_ARGS });
    } catch (err) {
      if (!/Executable doesn't exist|executable.*not found|install/i.test(String(err))) throw err;
      process.stderr.write('Baixando o Chromium do Playwright (só na primeira vez)...\n');
      const cli = join(require.resolve('playwright-core/package.json'), '..', 'cli.js');
      await exec(process.execPath, [cli, 'install', 'chromium'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      return chromium.launch({ args: RASTER_ARGS });
    }
  }

  private getBrowser() {
    this.browser ??= this.launch();
    return this.browser;
  }

  /** Renders `target` to PNG bytes with the input hash embedded. */
  async png(project: Project, target: RenderTarget): Promise<{ png: Buffer; hash: string }> {
    const browser = await this.getBrowser();
    const { theme, scale } = project.config.render;
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: scale, colorScheme: theme, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const route = target.flow ? `/render/flow/${target.flow}` : `/render/drawing/${target.drawing}`;
      const params = new URLSearchParams({ token: this.token, theme, scale: String(scale) });
      if (target.step) params.set('step', target.step);
      await page.goto(`${this.baseUrl()}${route}?${params}`);
      await page.waitForSelector('[data-ready="true"]', { state: 'attached', timeout: 30_000 });
      const error = await page.getAttribute('[data-ready]', 'data-error');
      if (error) throw new Error(error);
      const png = await page.locator('#render-root').screenshot({ animations: 'disabled', omitBackground: false });
      const hash = renderHash(project, target);
      return { png: embedHash(png, hash), hash };
    } finally {
      await context.close();
    }
  }

  /** Writes the PNG unless an existing file already has the same input hash. */
  async renderTo(project: Project, target: RenderTarget, outDir: string): Promise<RenderOutput> {
    const file = targetFile(target);
    const path = join(outDir, file);
    const hash = renderHash(project, target);
    const existing = await readFile(path).catch(() => undefined);
    if (existing && readHash(existing) === hash) return { file, path, hash, skipped: true };
    const { png } = await this.png(project, target);
    await writeAtomic(path, png);
    return { file, path, hash, skipped: false };
  }

  async close() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
    this.browser = undefined;
  }
}

export const renderedDir = (dir: string) => join(dir, 'rendered');
export const cacheDir = (dir: string) => join(dir, '..', '.zark', 'cache');
