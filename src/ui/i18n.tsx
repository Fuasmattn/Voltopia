import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Locale = 'en' | 'de';

const en = {
  'boot.loading': 'Voltopia is loading…',
  'webgl.fallback':
    '3D view unavailable (WebGL not supported here) — simulation keeps running.',

  'hud.funds': 'funds',
  'hud.residents': 'residents',
  'hud.jobs': 'jobs',
  'hud.happiness': 'happiness',
  'hud.day': 'Day {n}',
  'hud.weather.title': 'Cloud cover / wind speed',
  'hud.demand.title': 'Demand: residential / commercial / retail',

  'speed.pause': 'Pause',
  'speed.normal': 'Normal speed',
  'speed.fast': 'Fast (3x)',

  'tool.select': 'Select / pan',
  'tool.road': 'Road',
  'tool.zone-residential': 'Residential',
  'tool.zone-commercial': 'Commercial',
  'tool.zone-retail': 'Retail',
  'tool.plant-solar': 'Solar farm',
  'tool.plant-wind': 'Wind turbine',
  'tool.plant-battery': 'Battery',
  'tool.plant-biogas': 'Biogas plant',
  'tool.plant-hub': 'Charging hub',
  'tool.bulldoze': 'Bulldozer',
  'tool.undo': 'Undo',
  'tool.undo.title': 'Undo last build action',
  'tool.perTile': '{cost}/tile',

  'energy.title': 'Energy',
  'energy.solar': '☀️ Solar',
  'energy.wind': '🌀 Wind',
  'energy.biogas': '♻️ Biogas',
  'energy.rooftop': '🏠 Rooftop PV',
  'energy.consumption': '🏙 Consumption',
  'energy.charging': '🔌 EV charging',
  'energy.surplus': 'Surplus',
  'energy.deficit': 'Deficit',
  'energy.curtailed': 'Curtailed',
  'energy.import': '⤵️ Grid import',
  'energy.export': '⤴️ Grid export',
  'energy.storage': 'Storage (SoC)',
  'energy.graph.label': 'Generation and consumption over the last day',
  'energy.legend.generation': 'generation',
  'energy.legend.consumption': 'consumption',

  'tax.label': 'Tax rate',
  'smartCharging.label': '⚡ Smart charging',
  'smartCharging.title':
    'EV charging automatically follows the generation surplus',
  'newCity.label': 'New city',
  'newCity.confirm': 'Start a new city? The current one will be erased.',

  'overlay.label': 'Overlay',
  'overlay.off': 'Off',
  'overlay.supply': 'Supply',
  'overlay.demand': 'Demand',
  'overlay.off.title': 'No overlay',
  'overlay.supply.title':
    'Supply status: green = supplied, orange = undersupplied, red = not connected',
  'overlay.demand.title': 'Growth demand per zone: red = none, green = high',

  'rejection.notEnoughMoney': 'Not enough money',
  'rejection.tileOccupied': 'This tile is already occupied',
  'rejection.nothingToUndo': 'Nothing to undo',
  'rejection.noPlantSelected': 'No plant selected',

  'footer.hint': 'drag right mouse: pan · wheel: zoom · Q/E: rotate',
  'footer.help': 'Help',
  'footer.imprint': 'Imprint',

  'help.title': 'How to play',
  'help.goal.title': 'Goal',
  'help.goal.body':
    'Grow a happy city powered entirely by renewable energy. Generation fluctuates with sun and wind — keep it in balance with consumption, or buildings go dark, happiness drops and growth stops.',
  'help.build.title': 'Building',
  'help.build.body':
    'Drag roads, then paint residential, commercial and retail zones next to them. Buildings appear on their own when there is demand (see the R/C/S bars) and densify over time — but only while they are fully supplied with energy.',
  'help.energy.title': 'Energy',
  'help.energy.body':
    'Every plant supplies a radius around it. Solar peaks at noon and suffers under clouds; wind follows the weather day and night. Batteries store the midday surplus for the evening; the biogas plant is dispatchable backup — reliable but expensive to run. Dense buildings add rooftop PV automatically.',
  'help.ev.title': 'E-mobility',
  'help.ev.body':
    'Your citizens drive EVs. Home charging peaks in the evening — right when solar is gone. Charging hubs shift the load into the sunny midday, and the smart-charging upgrade follows the surplus automatically.',
  'help.controls.title': 'Controls',
  'help.controls.body':
    'Left mouse: use the selected tool (drag for roads and zones). Right or middle mouse drag: pan. Mouse wheel: zoom. Q/E: rotate the view. S: quick-save. The game autosaves every 30 seconds.',
  'help.icons.title': 'Warning icons',
  'help.icons.body':
    'A red bolt above a building means it is not connected to any plant; an orange bolt means the grid cannot cover its demand right now.',

  'imprint.title': 'Imprint',
  'imprint.according': 'Information in accordance with § 5 DDG',
  'imprint.contact': 'Contact',
  'imprint.responsible': 'Responsible for content',
  'imprint.disclaimer.title': 'Disclaimer',
  'imprint.disclaimer.body':
    'This is a free, open-source browser game (MIT license). Despite careful review, no liability is assumed for external links; their content is the sole responsibility of their operators.',

  'modal.close': 'Close',
} as const;

export type TranslationKey = keyof typeof en;

const de: Record<TranslationKey, string> = {
  'boot.loading': 'Voltopia lädt…',
  'webgl.fallback':
    '3D-Ansicht nicht verfügbar (WebGL wird hier nicht unterstützt) — die Simulation läuft weiter.',

  'hud.funds': 'Guthaben',
  'hud.residents': 'Einwohner',
  'hud.jobs': 'Jobs',
  'hud.happiness': 'Zufriedenheit',
  'hud.day': 'Tag {n}',
  'hud.weather.title': 'Bewölkung / Windgeschwindigkeit',
  'hud.demand.title': 'Nachfrage: Wohnen / Gewerbe / Handel',

  'speed.pause': 'Pause',
  'speed.normal': 'Normale Geschwindigkeit',
  'speed.fast': 'Schnell (3x)',

  'tool.select': 'Auswählen / bewegen',
  'tool.road': 'Straße',
  'tool.zone-residential': 'Wohngebiet',
  'tool.zone-commercial': 'Gewerbe',
  'tool.zone-retail': 'Einzelhandel',
  'tool.plant-solar': 'Solarpark',
  'tool.plant-wind': 'Windrad',
  'tool.plant-battery': 'Batteriespeicher',
  'tool.plant-biogas': 'Biogasanlage',
  'tool.plant-hub': 'Ladepark',
  'tool.bulldoze': 'Abriss',
  'tool.undo': 'Rückgängig',
  'tool.undo.title': 'Letzte Bauaktion rückgängig machen',
  'tool.perTile': '{cost}/Feld',

  'energy.title': 'Energie',
  'energy.solar': '☀️ Solar',
  'energy.wind': '🌀 Wind',
  'energy.biogas': '♻️ Biogas',
  'energy.rooftop': '🏠 Dach-PV',
  'energy.consumption': '🏙 Verbrauch',
  'energy.charging': '🔌 E-Auto-Laden',
  'energy.surplus': 'Überschuss',
  'energy.deficit': 'Defizit',
  'energy.curtailed': 'Abgeregelt',
  'energy.import': '⤵️ Netzbezug',
  'energy.export': '⤴️ Einspeisung',
  'energy.storage': 'Speicher (Ladestand)',
  'energy.graph.label': 'Erzeugung und Verbrauch des letzten Tages',
  'energy.legend.generation': 'Erzeugung',
  'energy.legend.consumption': 'Verbrauch',

  'tax.label': 'Steuersatz',
  'smartCharging.label': '⚡ Smart Charging',
  'smartCharging.title':
    'E-Auto-Laden folgt automatisch dem Erzeugungsüberschuss',
  'newCity.label': 'Neue Stadt',
  'newCity.confirm':
    'Eine neue Stadt beginnen? Die aktuelle Stadt wird gelöscht.',

  'overlay.label': 'Overlay',
  'overlay.off': 'Aus',
  'overlay.supply': 'Versorgung',
  'overlay.demand': 'Nachfrage',
  'overlay.off.title': 'Kein Overlay',
  'overlay.supply.title':
    'Versorgungsstatus: grün = versorgt, orange = unterversorgt, rot = nicht angeschlossen',
  'overlay.demand.title':
    'Wachstumsnachfrage pro Zone: rot = keine, grün = hoch',

  'rejection.notEnoughMoney': 'Nicht genug Geld',
  'rejection.tileOccupied': 'Dieses Feld ist bereits belegt',
  'rejection.nothingToUndo': 'Nichts rückgängig zu machen',
  'rejection.noPlantSelected': 'Keine Anlage ausgewählt',

  'footer.hint':
    'rechte Maustaste ziehen: bewegen · Mausrad: zoomen · Q/E: drehen',
  'footer.help': 'Hilfe',
  'footer.imprint': 'Impressum',

  'help.title': 'Spielanleitung',
  'help.goal.title': 'Ziel',
  'help.goal.body':
    'Baue eine zufriedene Stadt, die vollständig mit erneuerbarer Energie läuft. Die Erzeugung schwankt mit Sonne und Wind — halte sie mit dem Verbrauch im Gleichgewicht, sonst werden Gebäude dunkel, die Zufriedenheit sinkt und das Wachstum stoppt.',
  'help.build.title': 'Bauen',
  'help.build.body':
    'Ziehe Straßen und male daneben Wohn-, Gewerbe- und Einzelhandelszonen. Gebäude entstehen von selbst, wenn Nachfrage besteht (siehe die R/C/S-Balken), und verdichten sich mit der Zeit — aber nur, solange sie vollständig mit Energie versorgt sind.',
  'help.energy.title': 'Energie',
  'help.energy.body':
    'Jede Anlage versorgt einen Radius um sich herum. Solar liefert mittags am meisten und leidet unter Wolken; Wind folgt dem Wetter, Tag und Nacht. Batterien speichern den Mittagsüberschuss für den Abend; die Biogasanlage ist regelbare Reserve — zuverlässig, aber teuer im Betrieb. Dichte Gebäude bekommen automatisch Dach-PV.',
  'help.ev.title': 'E-Mobilität',
  'help.ev.body':
    'Deine Bürger fahren E-Autos. Das Laden zu Hause hat abends seinen Höhepunkt — genau dann, wenn die Sonne weg ist. Ladeparks verschieben die Last in den sonnigen Mittag, und das Smart-Charging-Upgrade folgt dem Überschuss automatisch.',
  'help.controls.title': 'Steuerung',
  'help.controls.body':
    'Linke Maustaste: gewähltes Werkzeug benutzen (für Straßen und Zonen ziehen). Rechte oder mittlere Maustaste ziehen: Ansicht bewegen. Mausrad: zoomen. Q/E: Ansicht drehen. S: Schnellspeichern. Das Spiel speichert alle 30 Sekunden automatisch.',
  'help.icons.title': 'Warnsymbole',
  'help.icons.body':
    'Ein roter Blitz über einem Gebäude bedeutet: nicht an eine Anlage angeschlossen. Ein oranger Blitz: das Netz kann den Bedarf gerade nicht decken.',

  'imprint.title': 'Impressum',
  'imprint.according': 'Angaben gemäß § 5 DDG',
  'imprint.contact': 'Kontakt',
  'imprint.responsible': 'Verantwortlich für den Inhalt',
  'imprint.disclaimer.title': 'Haftungsausschluss',
  'imprint.disclaimer.body':
    'Dies ist ein kostenloses Open-Source-Browserspiel (MIT-Lizenz). Trotz sorgfältiger Prüfung wird keine Haftung für externe Links übernommen; für deren Inhalte sind ausschließlich die jeweiligen Betreiber verantwortlich.',

  'modal.close': 'Schließen',
};

const translations: Record<Locale, Record<TranslationKey, string>> = { en, de };

const LOCALE_STORAGE_KEY = 'voltopia.locale';

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // storage unavailable (private mode etc.) — fall through
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // best effort only
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let text: string = translations[locale][key] ?? en[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

/** Translate a rejection code from the simulation worker. */
export function rejectionKey(code: string): TranslationKey | null {
  const key = `rejection.${code}`;
  return key in en ? (key as TranslationKey) : null;
}
