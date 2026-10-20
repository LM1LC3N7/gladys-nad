// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), limits and timings.
// Every key here is stored by Gladys or by its users: never rename one.
// -----------------------------------------------------------------------------

/** `gladys.externalIds(DEVICE_TYPE, <address id>)`, see `addressId` in src/config.js. */
export const DEVICE_TYPE = 'nad';

export const FEATURES = Object.freeze({
  /** Read only: 1 on, 0 in standby (or unreachable). */
  POWER: 'power',
  /** Push button: `Main.Power=On`. */
  POWER_ON: 'power_on',
  /** Push button: `Main.Power=Off` (standby). */
  STANDBY: 'standby',
  /** 0..100 %, mapped onto min_volume_db..max_volume_db: 100 % is the cap. */
  VOLUME: 'volume',
  /** Push button: each press sets the opposite of the mute read from the device. */
  MUTE: 'mute',
  SOURCE: 'source',
});

export const ACTIONS = Object.freeze({
  CHECK: 'check_devices',
});

/** The NAD control port over the network (telnet, plain ASCII lines). */
export const DEFAULT_PORT = 23;

/**
 * The volume range of the configuration, in dB (the unit of `Main.Volume`).
 * `max` is the cap: 100 % in Gladys, never exceeded. Defaults as Home
 * Assistant's NAD integration for the cap (-20 dB).
 */
export const MAX_VOLUME_DB = Object.freeze({ min: -80, max: 0, default: -20 });
export const MIN_VOLUME_DB = Object.freeze({ min: -99, max: -21, default: -80 });
/** The smallest span kept between the two (a narrower range is widened downwards). */
export const MIN_SPAN_DB = 10;

export const TIMINGS = Object.freeze({
  /** Opening the TCP connection. */
  connectTimeout: 4_000,
  /** One query while connecting or polling. */
  requestTimeout: 1_500,
  /** One `SourceN.Name?` while connecting (many models do not know it). */
  nameTimeout: 800,
  /**
   * Gladys waits 5 s for the ack of a command: the whole command (wait in the
   * queues and every exchange included) gets `commandBudget`, the state read
   * just before a mute press `preRead` of it.
   */
  commandBudget: 3_500,
  preRead: 1_500,
  /**
   * Reconnection: first after `reconnectBase`, then doubled each time up to
   * `reconnectMax`. The count is only reset by a connection that stayed up
   * `stableAfter`.
   */
  reconnectBase: 10_000,
  reconnectMax: 5 * 60_000,
  stableAfter: 60_000,
  /** The states are read again this often (the device also pushes its changes). */
  pollInterval: 60_000,
  /** This many polls in a row without an answer to `Main.Power?` close the connection. */
  deadPolls: 2,
  /** After a Power on whose volume could not be read in time: checked again. */
  wakeCheckDelay: 2_500,
  wakeChecks: 6,
  /** The states of one device are published at most this often (a knob turned fast). */
  publishDelay: 1_000,
  /** Writes to /data are grouped. */
  persistDelay: 1_000,
  /** The background round: status, created devices read again. */
  tick: 30_000,
  /** More lines than this within `floodWindow`: the connection is closed. */
  floodLines: 300,
  floodWindow: 10_000,
});

export const LIMITS = Object.freeze({
  devices: 20,
  addresses: 20,
  /** Length of one line from the device; longer ones are dropped. */
  line: 256,
  /** `Source1.Name?` .. `Source12.Name?` asked at most. */
  sourceSlots: 12,
  /** Options of the Source dropdown. */
  sources: 24,
  /** Exchanges waiting for their turn on one connection. */
  pending: 16,
  /** Length of a name (model, source). */
  name: 64,
});
