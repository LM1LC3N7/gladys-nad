// -----------------------------------------------------------------------------
// The texts users read in Gladys (configuration button, connection status),
// in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });
const list = (items) => items.join(', ');
const onOff = (value, [en1, en0, enU], [fr1, fr0, frU]) =>
  value === true ? [en1, fr1] : value === false ? [en0, fr0] : [enU, frU];

export const T = {
  noDevice: both(
    'No device known yet: type their IP addresses in the configuration.',
    'Aucun appareil connu : saisissez leurs adresses IP dans la configuration.',
  ),
  check: (lines, range) => ({
    en: [
      ...lines.map((l) => l.en),
      `Volume range: ${range.minDb} dB (0 %) to ${range.maxDb} dB (100 %, the cap)`,
    ].join(' · '),
    fr: [
      ...lines.map((l) => l.fr),
      `Plage de volume : ${range.minDb} dB (0 %) à ${range.maxDb} dB (100 %, le plafond)`,
    ].join(' · '),
  }),
  checkLine: (label, state, error) => {
    if (!state) {
      const reason = error ? ` (${error})` : '';
      return both(`${label}: not connected${reason}`, `${label} : non connecté${reason}`);
    }
    const [enPower, frPower] = onOff(
      state.power,
      ['on', 'standby', 'power unknown'],
      ['allumé', 'en veille', 'marche inconnue'],
    );
    const [enMute, frMute] = onOff(
      state.mute,
      ['muted', 'not muted', 'mute unknown'],
      ['sourdine', 'sans sourdine', 'sourdine inconnue'],
    );
    const volume = Number.isFinite(state.volume) ? `${state.volume} dB` : undefined;
    const source = state.source ? `source ${state.source}` : undefined;
    const en = [enPower, volume ? `volume ${volume}` : 'volume unknown', enMute, source];
    const fr = [frPower, volume ? `volume ${volume}` : 'volume inconnu', frMute, source];
    return both(
      `${label}: connected, ${en.filter(Boolean).join(', ')}`,
      `${label} : connecté, ${fr.filter(Boolean).join(', ')}`,
    );
  },
  unreachable: (names) =>
    both(
      `Not connected (off, network standby disabled, or unreachable), tried again at spaced intervals: ${list(names)}.`,
      `Non connectés (éteints, veille réseau désactivée, ou injoignables), réessayés à intervalles espacés : ${list(names)}.`,
    ),
  noAnswerAt: (addresses) =>
    both(
      `No NAD device answers yet at: ${list(addresses)}.`,
      `Aucun appareil NAD ne répond encore à : ${list(addresses)}.`,
    ),
  invalidEntries: (entries) =>
    both(
      `Ignored in the configuration (invalid): ${list(entries)}.`,
      `Ignorés dans la configuration (invalides) : ${list(entries)}.`,
    ),
  dataReset: both(
    'The saved device list was unreadable and was reset; the devices are found again from their addresses.',
    'La liste enregistrée des appareils était illisible et a été réinitialisée ; les appareils sont retrouvés par leurs adresses.',
  ),
};
