/**
 * Deterministic synthetic dataset generator.
 *
 * EVERY record is synthetic. Names, orders and amounts are invented. The
 * `baselineHandlingSec` value is a DECLARED SIMULATION ASSUMPTION, not a
 * measurement of real work: it exists so the benchmark can compare machine
 * triage against an explicit, auditable baseline.
 */
import type { Locale, SyntheticTicket, TicketType, Urgency } from "./types.ts";

export const DATASET_ID = "synthetic-tickets-v1";
export const DATASET_SIZE = 120;
export const SYNTHETIC_DECLARATION =
  "Tutti i ticket sono generati da questo repository. Nessun dato reale di clienti. Il baseline manuale è un'assunzione dichiarata, non una misura.";

/** Seeded PRNG: the dataset and every benchmark are reproducible. */
function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CLIENTS = [
  "Acme Retail",
  "Bellini S.r.l.",
  "Casa Verde",
  "Delta Logistica",
  "Energia 24",
] as const;

export const PRODUCTS = [
  "Lampada da tavolo",
  "Tavolo da cucina",
  "Sedia da ufficio",
  "Scaffale metallico",
  "Armadio a due ante",
] as const;

const TEMPLATES: Record<
  TicketType,
  { it: Array<(c: string, p: string, o: string, a: string, d: string) => string>; en: Array<(c: string, p: string, o: string, a: string, d: string) => string> }
> = {
  ordine: {
    it: [
      (c, p, o, a) => `Buongiorno, vorrei confermare l'ordine ${o} per ${p}, importo ${a}. Potrei avere la data di consegna?`,
      (c, p, o) => `Ho effettuato l'ordine ${o} ieri ma non ho ricevuto conferma. Il prodotto è ${p}.`,
      (c, p, o, a, d) => `Rif. ${o}: confermate disponibilità di ${p} entro il ${d}? Totale ${a}.`,
    ],
    en: [
      (c, p, o, a) => `Hello, please confirm order ${o} for ${p}, amount ${a}. Could you share the delivery date?`,
      (c, p, o) => `I placed order ${o} yesterday but got no confirmation. The product is ${p}.`,
      (c, p, o, a, d) => `Ref ${o}: can you confirm ${p} is available by ${d}? Total ${a}.`,
    ],
  },
  fatturazione: {
    it: [
      (c, p, o, a) => `La fattura relativa all'ordine ${o} riporta ${a} ma dovrebbe essere diversa. Potete controllare?`,
      (c, p, o, a) => `Ho ricevuto una fattura di ${a} per ${o}. L'importo non torna con l'ordine.`,
      (c, p, o, a, d) => `Richiesta rettifica fattura ${o}, importo ${a}, scadenza ${d}. Serve documento aggiornato.`,
    ],
    en: [
      (c, p, o, a) => `The invoice for order ${o} shows ${a} but it should be different. Can you check?`,
      (c, p, o, a) => `I received an invoice of ${a} for ${o}. The amount does not match the order.`,
      (c, p, o, a, d) => `Invoice correction requested for ${o}, amount ${a}, due ${d}. Please send an updated document.`,
    ],
  },
  assistenza: {
    it: [
      (c, p, o) => `Il prodotto ${p} dell'ordine ${o} non funziona: si accende ma non risponde ai comandi.`,
      (c, p, o) => `Ho un problema con ${p} (ordine ${o}). Non riesco a completare il montaggio.`,
      (c, p, o) => `Assistenza tecnica: ${p} ordine ${o} mostra un errore al primo avvio.`,
    ],
    en: [
      (c, p, o) => `The ${p} from order ${o} is not working: it powers on but does not respond.`,
      (c, p, o) => `I have an issue with ${p} (order ${o}). I cannot finish the assembly.`,
      (c, p, o) => `Technical support: ${p} order ${o} shows an error on first start.`,
    ],
  },
  reclamo: {
    it: [
      (c, p, o, a, d) => `Reclamo per l'ordine ${o}: consegna in ritardo rispetto al ${d}, importo ${a}. Chiedo una spiegazione.`,
      (c, p, o) => `Sono deluso dal servizio sull'ordine ${o}. Il prodotto ${p} è arrivato danneggiato.`,
      (c, p, o, a) => `Presento un reclamo formale per ${o}, ${a}. La comunicazione è stata confusa e tardiva.`,
    ],
    en: [
      (c, p, o, a, d) => `Complaint about order ${o}: delivery late against ${d}, amount ${a}. I want an explanation.`,
      (c, p, o) => `I am disappointed with the service on order ${o}. The ${p} arrived damaged.`,
      (c, p, o, a) => `Formal complaint for ${o}, ${a}. Communication was confusing and late.`,
    ],
  },
  richiesta_informazioni: {
    it: [
      (c, p) => `Vorrei informazioni sulla disponibilità di ${p} e sui tempi di consegna.`,
      (c, p) => `Potete dirmi se ${p} è disponibile anche in altro colore?`,
      (c, p) => `Chiedo gentilmente il manuale di ${p} prima di acquistare.`,
    ],
    en: [
      (c, p) => `I would like information about the availability of ${p} and delivery times.`,
      (c, p) => `Can you tell me if ${p} is available in another colour?`,
      (c, p) => `Could you send the manual for ${p} before I buy it?`,
    ],
  },
  cambio_dati: {
    it: [
      (c, o) => `Vorrei aggiornare l'indirizzo di fatturazione per l'ordine ${o}.`,
      (c, o) => `Cambio dati anagrafici: la ragione sociale associata a ${o} non è più corretta.`,
      (c, o) => `Richiesta modifica email di contatto per l'ordine ${o}.`,
    ],
    en: [
      (c, o) => `I would like to update the billing address for order ${o}.`,
      (c, o) => `Change of company details: the name linked to ${o} is no longer correct.`,
      (c, o) => `Please change the contact email for order ${o}.`,
    ],
  },
};

const URGENCY_PREFIX: Record<Locale, Record<Urgency, string[]>> = {
  it: {
    alta: ["URGENTE: ", "Priorità alta. ", "Entro oggi: ", "Bloccato: "],
    media: [],
    bassa: ["Quando possibile: ", "Nessuna fretta: "],
  },
  en: {
    alta: ["URGENT: ", "High priority. ", "Due today: ", "Blocked: "],
    media: [],
    bassa: ["Whenever possible: ", "No rush: "],
  },
};

const SUBJECTS: Record<TicketType, { it: string; en: string }> = {
  ordine: { it: "Conferma ordine", en: "Order confirmation" },
  fatturazione: { it: "Fattura non corretta", en: "Invoice issue" },
  assistenza: { it: "Prodotto non funzionante", en: "Product not working" },
  reclamo: { it: "Reclamo", en: "Complaint" },
  richiesta_informazioni: { it: "Informazioni prodotto", en: "Product information" },
  cambio_dati: { it: "Aggiornamento dati", en: "Update details" },
};

const TYPES: TicketType[] = [
  "ordine",
  "fatturazione",
  "assistenza",
  "reclamo",
  "richiesta_informazioni",
  "cambio_dati",
];

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function formatDate(random: () => number) {
  const day = String(1 + Math.floor(random() * 28)).padStart(2, "0");
  const month = String(1 + Math.floor(random() * 12)).padStart(2, "0");
  return `${day}/${month}/2026`;
}

/** Generate the full deterministic dataset. */
export function generateDataset(size = DATASET_SIZE, seed = 20261116): SyntheticTicket[] {
  const random = mulberry32(seed);
  const tickets: SyntheticTicket[] = [];

  for (let index = 0; index < size; index += 1) {
    const locale: Locale = index % 3 === 0 ? "en" : "it";
    const type = TYPES[index % TYPES.length]!;
    const client = pick(random, CLIENTS);
    const product = pick(random, PRODUCTS);
    const orderId = `ORD-${String(4000 + index).padStart(4, "0")}`;
    const amount = `${(20 + Math.floor(random() * 480)).toString()},${String(10 + Math.floor(random() * 89))} €`;
    const deadline = formatDate(random);

    const urgencyRoll = random();
    const urgency: Urgency = urgencyRoll < 0.18 ? "alta" : urgencyRoll > 0.86 ? "bassa" : "media";

    // ~10% weak-signal cases: no order id, no amount, short body. The engine
    // must route these to human review instead of guessing.
    const ambiguous = index % 11 === 7;
    const template = pick(random, TEMPLATES[type][locale]);
    let body = ambiguous
      ? locale === "it"
        ? "Buongiorno, ho una questione da chiarire. Potete richiamarmi?"
        : "Hello, I have something to clarify. Could you call me back?"
      : template(client, product, orderId, amount, deadline);
    if (!ambiguous) {
      body = `${URGENCY_PREFIX[locale][urgency]}${body}`;
      // Every non-ambiguous ticket carries all declared fields, so ground truth
      // and extraction are comparable. The classification signal stays in the
      // first sentence; this line is the "attached data" a real email would have.
      const infoLine =
        locale === "it"
          ? `Dati di riferimento: ordine ${orderId}, importo ${amount}, prodotto ${product}, cliente ${client}, scadenza ${deadline}.`
          : `Reference data: order ${orderId}, amount ${amount}, product ${product}, client ${client}, due ${deadline}.`;
      body = `${body}\n\n${infoLine}`;
    }

    tickets.push({
      id: `tkt-${String(index + 1).padStart(4, "0")}`,
      createdAt: new Date(Date.UTC(2026, 10, 1 + (index % 28), 8 + (index % 9), index % 60)).toISOString(),
      locale,
      subject: ambiguous ? (locale === "it" ? "Richiesta generica" : "General request") : SUBJECTS[type][locale],
      body,
      from: `${client.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test`,
      synthetic: true,
      groundTruth: {
        type,
        urgency: ambiguous ? "media" : urgency,
        client,
        fields: ambiguous
          ? {}
          : {
              orderId,
              amount: ambiguous ? undefined : amount.replace(/\s*€$/, ""),
              product,
              client,
              deadline: type === "ordine" || type === "fatturazione" || type === "reclamo" ? deadline : undefined,
            },
        // Declared assumption, not a measured value.
        baselineHandlingSec: 150 + Math.floor(random() * 330),
      },
    });
  }

  return tickets;
}
