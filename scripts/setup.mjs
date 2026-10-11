import 'dotenv/config';
import {mkdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureBrowser} from '@remotion/renderer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);

try {
  if (major < 22) {
    throw new Error(`Node.js 22 or newer is required. Your version is ${process.versions.node}.`);
  }

  await Promise.all([
    mkdir(path.join(root, 'data', 'uploads'), {recursive: true}),
    mkdir(path.join(root, 'data', 'exports'), {recursive: true}),
  ]);
  console.log('Local uploads and exports folders are ready.');

  const executable = process.env.CHROME_EXECUTABLE?.trim();
  if (executable) {
    const browser = await stat(executable).catch(() => null);
    if (!browser?.isFile()) {
      throw new Error(`CHROME_EXECUTABLE does not point to a file: ${executable}. Correct it in .env or remove it to use the downloaded browser.`);
    }
    console.log(`Using your configured browser: ${executable}`);
  } else {
    console.log('Checking the local rendering browser. The first run downloads Chrome Headless Shell.');
    await ensureBrowser();
    console.log('The rendering browser is ready.');
  }

  console.log('Setup complete. Run npm run build, then npm start.');
} catch (error) {
  console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('For a browser download failure, check your internet connection and rerun npm run setup.');
  process.exitCode = 1;
}
