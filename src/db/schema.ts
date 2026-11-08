import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { FaroRecord, HistoryEntry, Settings } from '../lib/types';

/** The registry allows every relationship to have a real SQLite foreign key. */
export const records = sqliteTable(
  'faro_records',
  {
    id: text('id').primaryKey(),
    type: text('type').$type<FaroRecord['type']>().notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    occurredAt: text('occurred_at'),
    areaId: text('area_id'),
    parentId: text('parent_id'),
    weekStart: text('week_start'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<FaroRecord>().notNull(),
    idempotencyKey: text('idempotency_key'),
    dedupeKey: text('dedupe_key'),
  },
  (table) => [
    index('faro_records_type_date_idx').on(table.type, table.occurredAt),
    index('faro_records_type_status_idx').on(table.type, table.status),
    index('faro_records_created_idx').on(table.createdAt),
    index('faro_records_area_idx').on(table.areaId),
    index('faro_records_parent_idx').on(table.parentId),
    index('faro_records_updated_idx').on(table.updatedAt),
    uniqueIndex('faro_records_idempotency_idx').on(table.idempotencyKey),
    uniqueIndex('faro_records_dedupe_idx').on(table.dedupeKey),
    uniqueIndex('faro_reviews_week_idx')
      .on(table.weekStart)
      .where(sql`${table.type} = 'reviews'`),
    check(
      'faro_records_type_check',
      sql`${table.type} IN ('areas','interests','goals','habits','projects','milestones','activities','reviews','seasons','learnings','progress')`,
    ),
    check('faro_records_data_check', sql`json_valid(${table.data})`),
  ],
);

export const links = sqliteTable(
  'faro_links',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    relation: text('relation').notNull(),
  },
  (table) => [
    uniqueIndex('faro_links_unique_idx').on(table.sourceId, table.targetId, table.relation),
    index('faro_links_target_idx').on(table.targetId),
  ],
);

export const history = sqliteTable(
  'faro_history',
  {
    id: text('id').primaryKey(),
    recordId: text('record_id').notNull(),
    type: text('type').$type<FaroRecord['type']>().notNull(),
    occurredAt: text('occurred_at').notNull(),
    operation: text('operation').$type<HistoryEntry['operation']>().notNull(),
    before: text('before_data', { mode: 'json' }).$type<FaroRecord | null>(),
    after: text('after_data', { mode: 'json' }).$type<FaroRecord | null>(),
  },
  (table) => [
    index('faro_history_record_date_idx').on(table.recordId, table.occurredAt),
    index('faro_history_date_idx').on(table.occurredAt),
    check('faro_history_operation_check', sql`${table.operation} IN ('create','update','delete')`),
  ],
);

export const settings = sqliteTable(
  'faro_settings',
  {
    id: text('id').primaryKey(),
    data: text('data', { mode: 'json' }).$type<Settings>().notNull(),
  },
  (table) => [check('faro_settings_data_check', sql`json_valid(${table.data})`)],
);

export const accessAttempts = sqliteTable('faro_access_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  blockedUntil: integer('blocked_until').notNull().default(0),
  windowStart: integer('window_start').notNull(),
});
