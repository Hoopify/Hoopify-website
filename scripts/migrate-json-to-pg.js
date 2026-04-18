/**
 * One-shot: copy database.json → Supabase Postgres.
 *
 * 1. Set DATABASE_URL in .env (Supabase URI; password may need URL-encoding).
 * 2. npm install && node scripts/migrate-json-to-pg.js
 *    (applies scripts/supabase-schema.sql automatically, then copies database.json)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_JSON = path.join(__dirname, '..', 'database.json');
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('Missing DATABASE_URL in environment (.env).');
        process.exit(1);
    }

    const raw = fs.readFileSync(DB_JSON, 'utf8');
    const data = JSON.parse(raw);

    // Strip query string so sslmode=require does not force verify-full (avoids cert chain errors with pooler).
    const connBase = connectionString.replace(/\?.*$/, '');

    const client = new Client({
        connectionString: connBase,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    console.log('Connected to Postgres.');

    const schemaSql = fs.readFileSync(path.join(__dirname, 'supabase-schema.sql'), 'utf8');
    await client.query(schemaSql);
    await client.query('ALTER TABLE public.hoopify_bookings ADD COLUMN IF NOT EXISTS venue TEXT;');
    console.log('Schema applied (hoopify_* tables).');

    try {
        await client.query('BEGIN');

        const users = data.users && typeof data.users === 'object' ? data.users : {};
        for (const email of Object.keys(users)) {
            const u = users[email];
            await client.query(
                `INSERT INTO public.hoopify_users (
          email, first_name, last_name, salt, password_hash, created_at, tracker, history
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
        ON CONFLICT (email) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          salt = EXCLUDED.salt,
          password_hash = EXCLUDED.password_hash,
          created_at = COALESCE(EXCLUDED.created_at, hoopify_users.created_at),
          tracker = EXCLUDED.tracker,
          history = EXCLUDED.history`,
                [
                    email,
                    u.firstName || null,
                    u.lastName || null,
                    u.salt || null,
                    u.passwordHash || null,
                    u.createdAt ? new Date(u.createdAt) : null,
                    JSON.stringify(u.tracker || {}),
                    JSON.stringify(u.history || []),
                ]
            );
        }
        console.log(`Users: ${Object.keys(users).length} upserted.`);

        const availability = data.availability && typeof data.availability === 'object' ? data.availability : {};
        let slotCount = 0;
        for (const day of WEEKDAYS) {
            const slots = Array.isArray(availability[day]) ? availability[day] : [];
            for (const slot of slots) {
                if (!slot || !slot.id || !slot.start || !slot.end) continue;
                await client.query(
                    `INSERT INTO public.hoopify_availability_slots (slot_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (slot_id) DO UPDATE SET
             day_of_week = EXCLUDED.day_of_week,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time`,
                    [slot.id, day, slot.start, slot.end]
                );
                slotCount += 1;
            }
        }
        console.log(`Availability slots: ${slotCount} upserted.`);

        const bookings = Array.isArray(data.bookings) ? data.bookings : [];
        for (const b of bookings) {
            if (!b || !b.id) continue;
            await client.query(
                `INSERT INTO public.hoopify_bookings (
          id, username, date, time, time_start, time_end, venue, focus, mode,
          created_at, stripe_checkout_session_id, payment_status, amount_total_cents
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          date = EXCLUDED.date,
          time = EXCLUDED.time,
          time_start = EXCLUDED.time_start,
          time_end = EXCLUDED.time_end,
          venue = EXCLUDED.venue,
          focus = EXCLUDED.focus,
          mode = EXCLUDED.mode,
          created_at = EXCLUDED.created_at,
          stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
          payment_status = EXCLUDED.payment_status,
          amount_total_cents = EXCLUDED.amount_total_cents`,
                [
                    b.id,
                    b.username,
                    b.date,
                    b.time,
                    b.time_start || null,
                    b.time_end || null,
                    b.venue || null,
                    JSON.stringify(Array.isArray(b.focus) ? b.focus : []),
                    b.mode || 'individual',
                    b.created_at ? new Date(b.created_at) : null,
                    b.stripe_checkout_session_id || null,
                    b.payment_status || null,
                    b.amount_total_cents != null ? Number(b.amount_total_cents) : null,
                ]
            );
        }
        console.log(`Bookings: ${bookings.length} upserted.`);

        await client.query('COMMIT');
        console.log('Done. Data is in Supabase.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
