import { Pool } from "pg";
import { pushHistory } from "./history";
import {
  newId,
  type CanvasDoc,
  type DocPatch,
  type DocSummary,
  type DocVersion,
  type DocVersionMeta,
  type Store,
} from "./types";

// Production store (Vercel/Neon). Activated when DATABASE_URL is set.
let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
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
           files jsonb not null default '{}'::jsonb,
           chat jsonb not null default '[]'::jsonb,
           history jsonb not null default '[]'::jsonb,
           created_at timestamptz not null default now(),
           updated_at timestamptz not null default now()
         )`,
      )
      // Add columns for tables created before they existed.
      .then(() => getPool().query(`alter table documents add column if not exists files jsonb not null default '{}'::jsonb`))
      .then(() => getPool().query(`alter table documents add column if not exists history jsonb not null default '[]'::jsonb`))
      .then(() => undefined);
  }
  return ready;
}

function rowToDoc(r: any): CanvasDoc {
  return {
    id: r.id,
    title: r.title,
    scene: r.scene ?? [],
    files: r.files ?? {},
    chat: r.chat ?? [],
    history: r.history ?? [],
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
      // Read current scene/title/history to snapshot before a scene write.
      let history: DocVersion[] | undefined;
      if (patch.scene !== undefined) {
        const { rows } = await getPool().query(
          `select scene, title, history from documents where id = $1`,
          [id],
        );
        if (rows[0]) {
          history = pushHistory(
            rows[0].history ?? [],
            { scene: rows[0].scene ?? [], title: rows[0].title },
            Date.now(),
          );
        }
      }
      await getPool().query(
        `update documents set
           title = coalesce($2, title),
           scene = coalesce($3, scene),
           files = coalesce($4, files),
           chat = coalesce($5, chat),
           history = coalesce($6, history),
           updated_at = now()
         where id = $1`,
        [
          id,
          patch.title ?? null,
          patch.scene !== undefined ? JSON.stringify(patch.scene) : null,
          patch.files !== undefined ? JSON.stringify(patch.files) : null,
          patch.chat !== undefined ? JSON.stringify(patch.chat) : null,
          history !== undefined ? JSON.stringify(history) : null,
        ],
      );
    },

    async remove(id) {
      await init();
      await getPool().query(`delete from documents where id = $1`, [id]);
    },

    async listVersions(id) {
      await init();
      const { rows } = await getPool().query(`select history from documents where id = $1`, [id]);
      const history: DocVersion[] = rows[0]?.history ?? [];
      return history.map(({ id, savedAt, count }): DocVersionMeta => ({ id, savedAt, count }));
    },

    async restoreVersion(id, versionId) {
      await init();
      const { rows } = await getPool().query(`select * from documents where id = $1`, [id]);
      if (!rows[0]) return null;
      const doc = rowToDoc(rows[0]);
      const version = doc.history.find((v) => v.id === versionId);
      if (!version) return null;
      const history = pushHistory(doc.history, { scene: doc.scene, title: doc.title }, Date.now());
      await getPool().query(
        `update documents set scene = $2, title = $3, history = $4, updated_at = now() where id = $1`,
        [id, JSON.stringify(version.scene), version.title, JSON.stringify(history)],
      );
      return { ...doc, scene: version.scene, title: version.title, history };
    },
  };
}
