// Syncs the dictionary (DictEntry, PartOfSpeech, Sense, Idiom, Example) from
// the Django app's database into this one. Django is the source of truth:
// after a sync, the five tables here match Django's exactly. Rows new in
// Django are added, changed rows are updated, and rows deleted in Django are
// deleted here (with their children). Rows keep Django's ids, so the links
// between them stay the same. The first sync, on empty tables, is the import.
//
// Edit the dictionary in Django, not here: changes made here are overwritten
// by the next sync. Used by scripts/sync-dictionary.ts and POST /dictionary/sync.
import pg from "pg";
import type { PrismaClient } from "../generated/prisma/client.js";

// Heroku Postgres needs SSL (with a self-signed certificate); a local database doesn't have it.
export const sslFor = (url: string) =>
  ["localhost", "127.0.0.1", "[::1]", ""].includes(new URL(url).hostname) ? false : { rejectUnauthorized: false };

// One table to sync: the Django table, the Prisma model, and how a Django row
// maps to this model's fields (all of them except id).
type Row = Record<string, unknown>;
interface Table {
  name: string;
  djangoTable: string;
  model: string; // the Prisma client property, e.g. "dictEntry"
  fields: (row: Row) => Row;
}

// Parents before children: creates and updates run in this order, deletes in reverse.
const TABLES: Table[] = [
  {
    name: "DictEntry",
    djangoTable: "api_dictentry",
    model: "dictEntry",
    fields: (r) => ({ headWord: r.head_word, hyphenated: r.hyphenated, source: r.source }),
  },
  {
    name: "PartOfSpeech",
    djangoTable: "api_partofspeech",
    model: "partOfSpeech",
    fields: (r) => ({
      dictEntryId: Number(r.dict_entry_id),
      name: r.name,
      pronCode: r.pron_code,
      amevarPron: r.amevar_pron,
      vietPronCode: r.viet_pron_code,
      vietPronCodeStandard: r.viet_pron_code_standard,
      vietPronRegionalVariant: r.viet_pron_regional_variant,
      frequency: r.frequency,
      grammar: r.grammar,
      videoUrl: r.video_url,
      audioBlob: r.audio_blob,
    }),
  },
  {
    name: "Sense",
    djangoTable: "api_sense",
    model: "sense",
    fields: (r) => ({
      posId: Number(r.pos_id),
      senseNumber: r.sense_number,
      definition: r.definition,
      defTranslation: r.def_translation,
      crossReference: r.cross_reference,
      grammar: r.grammar,
      relatedWords: r.related_words,
    }),
  },
  {
    name: "Idiom",
    djangoTable: "api_idiom",
    model: "idiom",
    fields: (r) => ({ posId: Number(r.pos_id), phrase: r.phrase, translation: r.translation }),
  },
  {
    name: "Example",
    djangoTable: "api_example",
    model: "example",
    fields: (r) => ({
      senseId: Number(r.sense_id),
      exampleNumber: r.example_number,
      difficultyLevel: r.difficulty_level,
      sentence: r.sentence,
      translation: r.translation,
      grammarPoint: r.grammar_point,
    }),
  },
];

// The Prisma model methods used here; the five models share them.
interface Delegate {
  findMany(): Promise<Row[]>;
  createMany(args: { data: Row[] }): Promise<unknown>;
  update(args: { where: { id: number }; data: Row }): Promise<unknown>;
  deleteMany(args: { where: { id: { in: number[] } } }): Promise<unknown>;
}
const delegate = (client: unknown, model: string) => (client as Record<string, Delegate>)[model]!;

// What one table needs: rows to create, rows to update, ids to delete.
interface Plan {
  table: Table;
  create: Row[];
  update: { id: number; data: Row }[];
  remove: number[];
}

// What a sync found (and, unless it was a dry run, applied) per table.
export interface TableChanges {
  table: string;
  new: number;
  changed: number;
  deleted: number;
}
export interface SyncResult {
  tables: TableChanges[];
  applied: boolean; // false for a dry run, or when everything was already in sync
}

// Thrown when a sync starts while another is running (e.g. a double click).
export class SyncBusyError extends Error {
  constructor() {
    super("A dictionary sync is already running.");
  }
}
let running = false;

// Compares Django's dictionary (at `djangoUrl`) with the one in `prisma`, and
// unless `dryRun`, applies the differences in one transaction (all or nothing).
export async function syncDictionary(prisma: PrismaClient, djangoUrl: string, dryRun: boolean): Promise<SyncResult> {
  if (running) throw new SyncBusyError();
  running = true;
  const django = new pg.Client({ connectionString: djangoUrl, ssl: sslFor(djangoUrl) });
  try {
    await django.connect();

    // Compare every table first, so nothing is written if reading fails.
    const plans: Plan[] = [];
    for (const table of TABLES) {
      const { rows: source } = await django.query<Row>(`select * from ${table.djangoTable} order by id`);
      const existing = new Map((await delegate(prisma, table.model).findMany()).map((r) => [r.id as number, r]));
      const plan: Plan = { table, create: [], update: [], remove: [] };
      const seen = new Set<number>();
      for (const row of source) {
        const id = Number(row.id); // Django's ids are bigint, which pg returns as text
        const data = table.fields(row);
        seen.add(id);
        const current = existing.get(id);
        if (!current) plan.create.push({ id, ...data });
        else if (Object.entries(data).some(([key, value]) => current[key] !== value)) plan.update.push({ id, data });
      }
      plan.remove = [...existing.keys()].filter((id) => !seen.has(id));
      plans.push(plan);
    }

    const tables = plans.map(({ table, create, update, remove }) => ({
      table: table.name,
      new: create.length,
      changed: update.length,
      deleted: remove.length,
    }));
    if (dryRun || tables.every((t) => !t.new && !t.changed && !t.deleted)) return { tables, applied: false };

    await prisma.$transaction(
      async (tx) => {
        // Deletes first (children before parents), so a deleted row's unique
        // head word / source is free for a row created or renamed below.
        for (const { table, remove } of [...plans].reverse()) {
          if (remove.length) await delegate(tx, table.model).deleteMany({ where: { id: { in: remove } } });
        }
        for (const { table, create, update } of plans) {
          const model = delegate(tx, table.model);
          if (create.length) await model.createMany({ data: create });
          for (const { id, data } of update) await model.update({ where: { id }, data });
          // Rows were inserted with Django's ids, so move the id counter past
          // them; otherwise a row created here would reuse an id.
          await tx.$executeRawUnsafe(
            `select setval(pg_get_serial_sequence('"${table.name}"', 'id'), coalesce((select max(id) from "${table.name}"), 0) + 1, false)`,
          );
        }
      },
      { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 },
    );
    return { tables, applied: true };
  } finally {
    running = false;
    await django.end().catch(() => {});
  }
}

// Prisma's error messages can list every row it was given; the end says what went wrong.
export function syncErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 2000 ? `…${message.slice(-2000)}` : message;
}
