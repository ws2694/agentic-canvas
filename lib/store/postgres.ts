import { Pool } from "pg";
import { newId, type CanvasDoc, type DocPatch, type DocSummary, type Store } from "./types";

// Production store (Vercel/Neon). Activated when DATABASE_URL is set.
let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon and most hosted Postgres require SSL.
      ssl: process.env.PGSSL === "disable" ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function init(): Promise<void> {
  if (!ready) {
    ready = getPool()
      .query(
        `create table if not exists documents (
           id text primary key,
           title text not null default 'Untitled canvas',
           scene jsonb not null default '[]'::jsonb,
           chat jsonb not null default '[]'::jsonb,
           created_at timestamptz not null default now(),
           updated_at timestamptz not null default now()
         )`,
      )
      .then(() => undefined);
  }
  return ready;
}

function rowToDoc(r: any): CanvasDoc {
  return {
    id: r.id,
    title: r.title,
    scene: r.scene ?? [],
    chat: r.chat ?? [],
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function createPostgresStore(): Store {
  return {
    async create(title = "Untitled canvas") {
      await init();
      const id = newId();
      const { rows } = await getPool().query(
        `insert into documents (id, title) values ($1, $2) returning *`,
        [id, title],
      );
      return rowToDoc(rows[0]);
    },

    async get(id) {
      await init();
      const { rows } = await getPool().query(`select * from documents where id = $1`, [id]);
      return rows[0] ? rowToDoc(rows[0]) : null;
    },

    async list() {
      await init();
      const { rows } = await getPool().query(
        `select id, title, created_at, updated_at from documents order by updated_at desc`,
      );
      return rows.map(
        (r): DocSummary => ({
          id: r.id,
          title: r.title,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        }),
      );
    },

    async save(id, patch: DocPatch) {
      await init();
      await getPool().query(
        `update documents set
           title = coalesce($2, title),
           scene = coalesce($3, scene),
           chat = coalesce($4, chat),
           updated_at = now()
         where id = $1`,
        [
          id,
          patch.title ?? null,
          patch.scene !== undefined ? JSON.stringify(patch.scene) : null,
          patch.chat !== undefined ? JSON.stringify(patch.chat) : null,
        ],
      );
    },

    async remove(id) {
      await init();
      await getPool().query(`delete from documents where id = $1`, [id]);
    },
  };
}
