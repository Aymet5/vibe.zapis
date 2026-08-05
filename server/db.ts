import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

export const db = new Database(env.databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vk_id TEXT UNIQUE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    photo TEXT,
    phone TEXT,
    bonus_percent INTEGER NOT NULL DEFAULT 0,
    vk_messages_allowed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    category TEXT NOT NULL,
    service TEXT NOT NULL,
    master_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start_minutes INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    base_price INTEGER,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    final_price INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    bonus_awarded INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings (date, master_id, status);
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, date);

  CREATE TABLE IF NOT EXISTS bonus_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bonus_user ON bonus_transactions (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface UserRow {
  id: number;
  vk_id: string | null;
  first_name: string;
  last_name: string;
  photo: string | null;
  phone: string | null;
  bonus_percent: number;
  vk_messages_allowed: number;
  created_at: string;
}

export interface BookingRow {
  id: number;
  user_id: number | null;
  client_name: string;
  client_phone: string;
  category: string;
  service: string;
  master_id: string;
  date: string;
  start_minutes: number;
  duration_minutes: number;
  base_price: number | null;
  discount_percent: number;
  final_price: number | null;
  status: string;
  bonus_awarded: number;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BonusTransactionRow {
  id: number;
  user_id: number;
  booking_id: number | null;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
}

/** Раз в сутки чистим протухшие сессии и брошенные OAuth-состояния. */
export function cleanupExpired(): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  db.prepare(`DELETE FROM oauth_states WHERE created_at < datetime('now', '-1 hour')`).run();
}
