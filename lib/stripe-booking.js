/**
 * Shared booking creation from Stripe Checkout metadata (idempotent).
 */

function parseFocus(focusStr) {
    if (!focusStr) return [];
    return String(focusStr)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
}

function createBookingFromStripeSession({
    readDb,
    writeDb,
    metadata,
    stripeCheckoutSessionId,
    amountTotalCents,
    paymentStatus,
}) {
    const username = String(metadata.username || '').trim().toLowerCase();
    const date = String(metadata.date || '').trim();
    const time = String(metadata.time || '').trim();
    const mode = String(metadata.mode || 'individual').trim();
    const focus = parseFocus(metadata.focus);

    if (!username || !date || !time) {
        return { ok: false, reason: 'missing_metadata' };
    }

    const db = readDb();
    const exists = (db.bookings || []).some((b) => b.stripe_checkout_session_id === stripeCheckoutSessionId);
    if (exists) {
        return { ok: true, duplicate: true };
    }

    const newBooking = {
        id: Date.now().toString(),
        username,
        date,
        time,
        focus,
        mode,
        created_at: new Date().toISOString(),
        stripe_checkout_session_id: stripeCheckoutSessionId,
        payment_status: paymentStatus || 'paid',
        amount_total_cents: amountTotalCents ?? null,
    };
    db.bookings.push(newBooking);
    writeDb(db);
    return { ok: true, booking: newBooking };
}

module.exports = { createBookingFromStripeSession, parseFocus };
