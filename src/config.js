// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEFAULT_PORT, LIMITS, MAX_VOLUME_DB, MIN_SPAN_DB, MIN_VOLUME_DB } from './constants.js';
import { cleanText, isSafeValue } from './nad/protocol.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  addresses: '',
  max_volume_db: MAX_VOLUME_DB.default,
  min_volume_db: MIN_VOLUME_DB.default,
  source_names: '',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * The address of a device typed by the user: an IPv4 address or a host name,
 * with an optional port (a pasted `telnet://` URL is reduced to its host and
 * port). A serial port (COM3, /dev/ttyUSB0) is not an address: refused.
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^(?:telnet|tcp):\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  if (text === '' || text.length > 260) {
    return undefined;
  }
  const match = text.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    return { host, port };
  }
  if (/^[\d.]+$/.test(host) || /^com\d{1,3}$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

export const addressKey = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}:${port}`);

/**
 * The platform id of the device at an address (NAD devices give no serial
 * number over this protocol): the host, plus `_<port>` when not 23. `_` never
 * appears in a host name, so two addresses never share an id.
 */
export const addressId = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}_${port}`);

function parseInteger(raw, { min, max, default: fallback }) {
  const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
  if (raw === null || raw === undefined || typeof raw === 'boolean' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The cap, in dB: an integer -80..0; anything unreadable gives the default (-20). */
export const parseMaxDb = (raw) => parseInteger(raw, MAX_VOLUME_DB);

/** The bottom of the range, in dB: an integer -99..-21, at least 10 dB under the cap. */
export function parseMinDb(raw, maxDb) {
  return Math.min(parseInteger(raw, MIN_VOLUME_DB), maxDb - MIN_SPAN_DB);
}

/**
 * Names given to the inputs, for the models that do not tell them:
 * `1=CD, 2=Tuner, 3=Phono` -> [{ value: '1', label: 'CD' }, ...].
 */
export function parseSourceNames(raw) {
  const options = [];
  const invalid = [];
  for (const entry of String(raw ?? '')
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter((e) => e !== '')) {
    const match = /^([^=]{1,32})=(.{1,64})$/.exec(entry);
    const value = match?.[1].trim();
    const label = cleanText(match?.[2]);
    if (!isSafeValue(value) || !label) {
      invalid.push(entry.slice(0, 100));
    } else if (!options.some((o) => o.value === value) && options.length < LIMITS.sources) {
      options.push({ value, label });
    }
  }
  return { options, invalid };
}

export function normalizeConfig(raw = {}) {
  const c = {
    ...DEFAULT_CONFIG,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v != null)),
  };
  const addresses = [];
  const invalid = [];
  for (const entry of String(c.addresses ?? '')
    .split(/[\s,;]+/)
    .filter((e) => e !== '')) {
    const address = parseAddress(entry);
    if (!address) {
      invalid.push(entry.slice(0, 100));
    } else if (
      !addresses.some((a) => addressKey(a) === addressKey(address)) &&
      addresses.length < LIMITS.addresses
    ) {
      addresses.push(address);
    }
  }
  const maxDb = parseMaxDb(c.max_volume_db);
  const names = parseSourceNames(c.source_names);
  return {
    addresses,
    invalid: [...invalid, ...names.invalid],
    maxDb,
    minDb: parseMinDb(c.min_volume_db, maxDb),
    sourceNames: names.options,
  };
}

/** Gladys percent (0..100) -> dB, never above the cap. */
export function percentToDb(percent, { minDb, maxDb }) {
  const db = Math.round(minDb + ((maxDb - minDb) * percent) / 100);
  return Math.max(minDb, Math.min(maxDb, db));
}

/** dB read from the device -> Gladys percent; above the cap shows 100, below the range 0. */
export function dbToPercent(db, { minDb, maxDb }) {
  const percent = Math.round(((db - minDb) * 100) / (maxDb - minDb));
  return Math.max(0, Math.min(100, percent));
}
