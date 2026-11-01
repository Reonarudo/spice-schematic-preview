export const rendererDir: string;
export const rendererFiles: import('esbuild').Plugin;
export function bundleWorker(options?: { minify?: boolean }): Promise<string>;
