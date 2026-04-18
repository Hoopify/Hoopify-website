-- Run this in Supabase: SQL Editor → New query → Paste → Run
-- Creates tables for Hoopify data migrated from database.json

CREATE TABLE IF NOT EXISTS public.hoopify_users (
  email TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  salt TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ,
  tracker JSONB NOT NULL DEFAULT '{}'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.hoopify_availability_slots (
  slot_id TEXT PRIMARY KEY,
  day_of_week TEXT NOT NULL CHECK (
    day_of_week IN (
      'Monday', 'Tuesday', 'Wednesday', 'Thursday',
      'Friday', 'Saturday', 'Sunday'
    )
  ),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hoopify_availability_day
  ON public.hoopify_availability_slots (day_of_week);

CREATE TABLE IF NOT EXISTS public.hoopify_bookings (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  time_start TEXT,
  time_end TEXT,
  focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode TEXT NOT NULL DEFAULT 'individual',
  created_at TIMESTAMPTZ,
  stripe_checkout_session_id TEXT,
  payment_status TEXT,
  amount_total_cents INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hoopify_bookings_stripe_session
  ON public.hoopify_bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
