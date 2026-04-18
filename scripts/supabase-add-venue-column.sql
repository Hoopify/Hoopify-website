-- Run once if you already created hoopify_bookings before `venue` existed.
ALTER TABLE public.hoopify_bookings ADD COLUMN IF NOT EXISTS venue TEXT;
