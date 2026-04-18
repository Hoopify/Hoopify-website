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
const PRICE_GROUP_CENTS = 3000;

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
            db.availability = defaultDb.availability;
        }
        return db;
    } catch {
        return defaultDb;
    }
};
const writeDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

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
    const mode = req.body.mode === 'group' ? 'group' : 'individual';
    const focus = Array.isArray(req.body.focus) ? req.body.focus : [];

    if (!isValidEmail(username)) {
        return res.status(400).json({ error: 'Valid user email is required' });
    }
    if (!date || !time) {
        return res.status(400).json({ error: 'Date and time are required' });
    }

    const amount = mode === 'group' ? PRICE_GROUP_CENTS : PRICE_INDIVIDUAL_CENTS;
    const label = mode === 'group' ? 'Hoopify group workout' : 'Hoopify individual session';
    const focusMeta = focus.join('|').slice(0, 450);

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
                            description: `${date} @ ${time}`,
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

// ---- AVAILABILITY ----
app.get('/api/availability', (req, res) => res.json(readDb().availability));
app.post('/api/availability', (req, res) => {
    const { day, time } = req.body;
    const db = readDb();
    if (!db.availability[day]) db.availability[day] = [];
    if (!db.availability[day].includes(time)) {
        db.availability[day].push(time);
        db.availability[day].sort();
    }
    writeDb(db);
    res.json({ success: true });
});
app.delete('/api/availability', (req, res) => {
    const { day, time } = req.body;
    const db = readDb();
    if (db.availability[day]) {
        db.availability[day] = db.availability[day].filter((t) => t !== time);
        writeDb(db);
    }
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
