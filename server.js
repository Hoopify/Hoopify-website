require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Stripe = require('stripe');
const { createBookingFromStripeSession } = require('./lib/stripe-booking');

const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

const PORT = Number(process.env.PORT) || 8085;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const PRICE_INDIVIDUAL_CENTS = 5000;

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = new Stripe(STRIPE_SECRET_KEY);
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(password, saltHex) {
    return crypto
        .pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
        .toString('hex');
}

const app = express();
const DB_FILE = path.join(__dirname, 'database.json');

const defaultDb = {
    users: {},
    availability: {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
        Sunday: [],
    },
    bookings: [],
};

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
}

const readDb = () => {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (!db.availability || Array.isArray(db.availability)) {
            db.availability = JSON.parse(JSON.stringify(defaultDb.availability));
        }
        migrateAvailability(db);
        return db;
    } catch {
        return JSON.parse(JSON.stringify(defaultDb));
    }
};
const writeDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

function padTimePart(n) {
    return String(n).padStart(2, '0');
}

function addOneHour(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return '23:59';
    let total = h * 60 + m + 60;
    total %= 24 * 60;
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${padTimePart(nh)}:${padTimePart(nm)}`;
}

function migrateDaySlots(arr, day) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map((item, idx) => {
            if (typeof item === 'string') {
                return {
                    id: `legacy-${day}-${idx}-${String(item).replace(/:/g, '')}`,
                    start: item,
                    end: addOneHour(item),
                };
            }
            if (item && typeof item === 'object' && item.start && item.end) {
                return {
                    id: item.id || `legacy-${day}-${idx}`,
                    start: item.start,
                    end: item.end,
                };
            }
            return null;
        })
        .filter(Boolean)
        .sort((a, b) => a.start.localeCompare(b.start));
}

function migrateAvailability(db) {
    if (!db.availability || typeof db.availability !== 'object' || Array.isArray(db.availability)) {
        db.availability = JSON.parse(JSON.stringify(defaultDb.availability));
        writeDb(db);
        return;
    }
    let changed = false;
    for (const day of WEEKDAY_NAMES) {
        const next = migrateDaySlots(db.availability[day], day);
        if (JSON.stringify(next) !== JSON.stringify(db.availability[day])) {
            db.availability[day] = next;
            changed = true;
        }
    }
    if (changed) writeDb(db);
}

// ---- Stripe webhook (raw body — register before express.json) ----
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(503).send('Webhook not configured');
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Stripe webhook signature:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata || {};
        createBookingFromStripeSession({
            readDb,
            writeDb,
            metadata: meta,
            stripeCheckoutSessionId: session.id,
            amountTotalCents: session.amount_total,
            paymentStatus: session.payment_status,
        });
    }

    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(__dirname));

// ---- AUTH & USER ----
app.post('/api/auth/signup', (req, res) => {
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!firstName || !lastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
    }
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = readDb();
    const existing = db.users[email];
    if (existing && existing.passwordHash) {
        return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(String(password), salt);

    db.users[email] = {
        firstName,
        lastName,
        email,
        salt,
        passwordHash,
        createdAt: new Date().toISOString(),
        tracker: existing && existing.tracker ? existing.tracker : {},
        history: existing && Array.isArray(existing.history) ? existing.history : [],
    };
    writeDb(db);

    res.json({
        success: true,
        username: email,
        displayName: `${firstName} ${lastName}`,
    });
});

app.post('/api/auth/login', (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    const db = readDb();
    const user = db.users[email];
    if (!user || !user.passwordHash || !user.salt) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const check = hashPassword(String(password), user.salt);
    if (check !== user.passwordHash) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || email;
    res.json({ success: true, username: email, displayName });
});

// ---- STRIPE CHECKOUT ----
app.get('/api/stripe/config', (req, res) => {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    res.json({
        configured: Boolean(STRIPE_SECRET_KEY && stripe),
        publishableKey,
    });
});

app.post('/api/checkout/session', async (req, res) => {
    if (!stripe) {
        return res.status(503).json({
            error: 'Payments are not configured. Set STRIPE_SECRET_KEY in the server environment.',
        });
    }

    const username = normalizeEmail(req.body.username);
    const date = String(req.body.date || '').trim();
    const time = String(req.body.time || '').trim();
    const timeStart = String(req.body.time_start || req.body.timeStart || '').trim();
    const timeEnd = String(req.body.time_end || req.body.timeEnd || '').trim();
    const mode = 'individual';
    const focus = Array.isArray(req.body.focus) ? req.body.focus : [];

    if (!isValidEmail(username)) {
        return res.status(400).json({ error: 'Valid user email is required' });
    }
    if (!date || !time) {
        return res.status(400).json({ error: 'Date and time are required' });
    }

    const amount = PRICE_INDIVIDUAL_CENTS;
    const label = 'Hoopify individual session ($50)';
    const focusMeta = focus.join('|').slice(0, 450);
    const desc = timeStart && timeEnd ? `${date} · ${timeStart}–${timeEnd}` : `${date} @ ${time}`;

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: label,
                            description: desc.slice(0, 500),
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            success_url: `${PUBLIC_BASE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${PUBLIC_BASE_URL}/?checkout=cancel`,
            metadata: {
                username,
                date,
                time,
                time_start: timeStart || '',
                time_end: timeEnd || '',
                mode,
                focus: focusMeta,
            },
            customer_email: username,
        });

        return res.json({ url: session.url, id: session.id });
    } catch (e) {
        console.error('Stripe checkout.session.create:', e);
        return res.status(500).json({ error: e.message || 'Could not start checkout' });
    }
});

app.get('/api/checkout/verify', async (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId || !stripe) {
        return res.status(400).json({ ok: false, error: 'Invalid session' });
    }
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== 'paid') {
            return res.json({ ok: false, payment_status: session.payment_status });
        }
        const result = createBookingFromStripeSession({
            readDb,
            writeDb,
            metadata: session.metadata || {},
            stripeCheckoutSessionId: session.id,
            amountTotalCents: session.amount_total,
            paymentStatus: session.payment_status,
        });
        return res.json({ ok: result.ok, booking: result.booking, duplicate: result.duplicate });
    } catch (e) {
        console.error('checkout verify:', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ---- AVAILABILITY (slots: { id, start, end } per weekday) ----
app.get('/api/availability', (req, res) => {
    const db = readDb();
    res.json(db.availability);
});

function validWeekday(day) {
    return WEEKDAY_NAMES.includes(day);
}

app.post('/api/availability', (req, res) => {
    const day = String(req.body.day || '').trim();
    const start = String(req.body.start || '').trim();
    const end = String(req.body.end || '').trim();
    if (!validWeekday(day)) {
        return res.status(400).json({ error: 'Invalid day' });
    }
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end times are required (HH:MM)' });
    }
    if (start >= end) {
        return res.status(400).json({ error: 'End time must be after start time' });
    }
    const db = readDb();
    if (!db.availability[day]) db.availability[day] = [];
    const slot = { id: crypto.randomBytes(12).toString('hex'), start, end };
    db.availability[day].push(slot);
    db.availability[day].sort((a, b) => a.start.localeCompare(b.start));
    writeDb(db);
    res.json({ success: true, slot });
});

app.put('/api/availability', (req, res) => {
    const day = String(req.body.day || '').trim();
    const id = String(req.body.id || '').trim();
    const start = String(req.body.start || '').trim();
    const end = String(req.body.end || '').trim();
    if (!validWeekday(day) || !id) {
        return res.status(400).json({ error: 'Invalid day or id' });
    }
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end are required' });
    }
    if (start >= end) {
        return res.status(400).json({ error: 'End time must be after start time' });
    }
    const db = readDb();
    const list = db.availability[day] || [];
    const idx = list.findIndex((s) => s && s.id === id);
    if (idx === -1) {
        return res.status(404).json({ error: 'Slot not found' });
    }
    list[idx] = { ...list[idx], start, end };
    list.sort((a, b) => a.start.localeCompare(b.start));
    writeDb(db);
    res.json({ success: true, slot: list[idx] });
});

app.delete('/api/availability', (req, res) => {
    const day = String(req.body.day || '').trim();
    const id = String(req.body.id || '').trim();
    const legacyTime = String(req.body.time || '').trim();
    const db = readDb();
    if (!validWeekday(day)) {
        return res.status(400).json({ error: 'Invalid day' });
    }
    if (!db.availability[day]) db.availability[day] = [];
    if (id) {
        db.availability[day] = db.availability[day].filter((s) => s && s.id !== id);
    } else if (legacyTime) {
        db.availability[day] = db.availability[day].filter((s) => {
            if (typeof s === 'string') return s !== legacyTime;
            return !(s.start === legacyTime || `${s.start}–${s.end}` === legacyTime);
        });
    } else {
        return res.status(400).json({ error: 'id is required' });
    }
    writeDb(db);
    res.json({ success: true });
});

// ---- BOOKINGS ----
app.get('/api/bookings', (req, res) => res.json(readDb().bookings));

/** Direct booking creation is disabled — use Stripe Checkout. */
app.post('/api/bookings', (req, res) => {
    res.status(403).json({ error: 'Bookings require payment. Complete checkout from the booking flow.' });
});

// ---- TRACKER ----
app.get('/api/tracker', (req, res) => {
    const username = req.query.username;
    const db = readDb();
    const user = db.users[username] || { tracker: {}, history: [] };
    res.json({
        tracker: user.tracker || {},
        history: Array.isArray(user.history) ? user.history : [],
    });
});
app.post('/api/tracker/log', (req, res) => {
    const { username, drillTitle, categories } = req.body;
    const db = readDb();

    if (!db.users[username]) db.users[username] = { tracker: {}, history: [] };
    const user = db.users[username];

    categories.forEach((cat) => {
        user.tracker[cat] = (user.tracker[cat] || 0) + 1;
    });

    const gainObjects = categories.map((c) => ({ skill: c, gain: 1 }));
    user.history.unshift({
        date: new Date().toLocaleDateString(),
        title: drillTitle || 'Completed Workout Drill',
        gains: gainObjects,
    });

    writeDb(db);
    res.json({ success: true, tracker: user.tracker, history: user.history });
});

app.listen(PORT, () => {
    console.log(`Hoopify on ${PUBLIC_BASE_URL} (port ${PORT})`);
    if (!STRIPE_SECRET_KEY) console.warn('[stripe] STRIPE_SECRET_KEY not set — checkout disabled.');
});
