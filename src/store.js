// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600): the known devices by address id, their model, and
// the sources they have shown (the "Source" dropdown only grows). No secret:
// the NAD control port has none.
//
// The device table has no prototype; a key is kept only when it is the id of
// its own, valid address.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addressId, parseAddress } from './config.js';
import { LIMITS } from './constants.js';
import { cleanText, isSafeValue } from './nad/protocol.js';

export const emptyData = () => ({ devices: Object.create(null) });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function sanitizeOptions(options) {
  const seen = new Set();
  const result = [];
  for (const option of Array.isArray(options) ? options.slice(0, LIMITS.sources * 4) : []) {
    if (
      isObject(option) &&
      isSafeValue(option.value) &&
      !seen.has(option.value) &&
      result.length < LIMITS.sources
    ) {
      seen.add(option.value);
      result.push({ value: option.value, label: cleanText(option.label) ?? option.value });
    }
  }
  return result;
}

function sanitize(data) {
  const base = emptyData();
  if (!isObject(data) || !isObject(data.devices)) {
    return base;
  }
  for (const [id, device] of Object.entries(data.devices).slice(0, LIMITS.devices)) {
    if (!isObject(device) || typeof device.host !== 'string') {
      continue;
    }
    const address = parseAddress(`${device.host}:${device.port}`);
    if (!address || addressId(address) !== id || device.id !== id) {
      continue;
    }
    base.devices[id] = {
      id,
      host: address.host,
      port: address.port,
      model: cleanText(device.model),
      sourceOptions: sanitizeOptions(device.sourceOptions),
    };
  }
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = 'nad.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.corrupted = false;
  }

  /**
   * The saved data. An unreadable file is moved aside to `nad.json.bad` and
   * `corrupted` is set, so the app says so instead of silently starting over.
   */
  async load() {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text));
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load() {
    return sanitize(JSON.parse(JSON.stringify(this.data)));
  }

  async save(data) {
    // Through JSON, as the file store: what a restart would read back.
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }
}

export { sanitize as sanitizeData };
