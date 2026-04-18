(function () {
    if (typeof document === 'undefined' && typeof require !== 'undefined') {
        const path = require('path');
        require(path.join(__dirname, 'server.js'));
        return;
    }

// DATA STRUCTURES
const CATEGORIES = [
    {
        name: "Outside Scoring",
        skills: ["Three-Point Shot", "Mid-Range Shot", "Close Shot", "Free Throw", "Offensive Consistency", "Shot IQ"]
    },
    {
        name: "Inside Scoring",
        skills: ["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands"]
    },
    {
        name: "Defense",
        skills: ["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense IQ"]
    },
    {
        name: "Athleticism",
        skills: ["Speed", "Strength", "Agility", "Vertical", "Hustle", "Stamina", "Overall Durability"]
    },
    {
        name: "Playmaking",
        skills: ["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass Vision", "Pass IQ"]
    },
    {
        name: "Rebounding",
        skills: ["Defensive Rebound", "Offensive Rebound"]
    },
    {
        name: "Potential",
        skills: ["Intangibles", "Potential"]
    }
];

// MOCK USER STATS
let userStats = {};
// Initialize all skills to 0 drills completed
CATEGORIES.forEach(cat => {
    cat.skills.forEach(skill => {
        userStats[skill] = 0;
    });
});

let workoutHistory = [];

// STATE
let currentUser = null;
let selectedSkills = [];
const workoutMode = 'individual';
let workoutDateTime = null;
/** @type {{ date: string, dayName: string, slot: { id: string, start: string, end: string } } | null} */
let selectedSlot = null;
let weekOffset = 0;
let systemAvailability = {};

const BOOKING_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatTime12(hhmm) {
    const parts = String(hhmm || '').split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) || 0;
    if (Number.isNaN(h)) return hhmm;
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatSlotRange(start, end) {
    return `${formatTime12(start)} – ${formatTime12(end)}`;
}

function getMonday(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}

function buildWeekDays(offset) {
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    const out = [];
    for (let i = 0; i < 7; i++) {
        const cell = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const y = cell.getFullYear();
        const mo = String(cell.getMonth() + 1).padStart(2, '0');
        const da = String(cell.getDate()).padStart(2, '0');
        out.push({
            dayName: BOOKING_WEEKDAYS[i],
            dateISO: `${y}-${mo}-${da}`,
            label: cell.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        });
    }
    return out;
}

function pickPrimaryBooking(bookings) {
    if (!bookings || !bookings.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...bookings].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const upcoming = sorted.filter((b) => b.date >= today);
    if (upcoming.length) return upcoming[0];
    return sorted[sorted.length - 1];
}

function formatBookingWhen(b) {
    if (!b) return '';
    const dateStr = b.date || '';
    let prettyDate = dateStr;
    try {
        const parts = dateStr.split('-').map(Number);
        if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
            const [y, m, d] = parts;
            const dt = new Date(y, m - 1, d);
            prettyDate = dt.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        }
    } catch {
        /* keep raw */
    }
    if (b.time_start && b.time_end) {
        return `${prettyDate} · ${formatSlotRange(b.time_start, b.time_end)}`;
    }
    return `${prettyDate} · ${b.time || ''}`;
}

function hideHomeBooking() {
    document.getElementById('home-my-booking')?.classList.add('hidden');
    document.getElementById('home-booking-confirmed')?.classList.add('hidden');
}

function renderHomeBooking(booking, venueFallback, options) {
    const card = document.getElementById('home-my-booking');
    const whenEl = document.getElementById('home-my-booking-when');
    const whereEl = document.getElementById('home-my-booking-where');
    const banner = document.getElementById('home-booking-confirmed');
    if (!card || !whenEl || !whereEl) return;
    if (!booking) {
        hideHomeBooking();
        return;
    }
    const venue = (booking.venue && String(booking.venue).trim()) || venueFallback || '';
    whenEl.textContent = formatBookingWhen(booking);
    whereEl.textContent = venue;
    card.classList.remove('hidden');
    if (options.justConfirmed && banner) {
        banner.classList.remove('hidden');
        window.clearTimeout(renderHomeBooking._bannerT);
        renderHomeBooking._bannerT = window.setTimeout(() => {
            banner.classList.add('hidden');
        }, 10000);
    } else if (banner) {
        banner.classList.add('hidden');
    }
}

async function renderHomeBookingFromServer(booking, options) {
    let fallback = '';
    try {
        const r = await fetch('/api/config');
        const c = await r.json();
        fallback = c.venue || '';
    } catch {
        /* ignore */
    }
    renderHomeBooking(booking, fallback, options || {});
}

async function loadMyBooking(options) {
    if (!currentUser) {
        hideHomeBooking();
        return;
    }
    try {
        const res = await fetch(`/api/bookings/mine?email=${encodeURIComponent(currentUser)}`);
        const data = await res.json();
        const venueFallback = data.venueDefault || '';
        const b = pickPrimaryBooking(data.bookings || []);
        renderHomeBooking(b, venueFallback, options || {});
    } catch {
        hideHomeBooking();
    }
}

// DOM ELEMENTS
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const categoriesContainer = document.getElementById('categories-container');
const btnNextTime = document.getElementById('btn-next-time');

// WIZARD STEPS
const stepFocus = document.getElementById('step-focus');
const stepTime = document.getElementById('step-time');
const stepPayment = document.getElementById('step-payment');
const bookingSuccess = document.getElementById('booking-success');
const bookingWizardEl = document.querySelector('.booking-wizard');

// INITIALIZATION
async function init() {
    setupNavigation();
    setupWizard();
    setupAuth();
    setupLogout();
    await tryRestoreSession();
    await handleCheckoutReturn();
}

/** After Stripe redirect: verify session and show confirmation on home. */
async function handleCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');

    if (checkout === 'success' && sessionId) {
        window.history.replaceState({}, '', window.location.pathname || '/');
        try {
            const res = await fetch(`/api/checkout/verify?session_id=${encodeURIComponent(sessionId)}`);
            const data = await res.json();
            if (data.ok) {
                stepFocus.classList.remove('active');
                stepTime.classList.remove('active');
                stepPayment.classList.remove('active');
                bookingWizardEl?.classList.add('hidden');
                bookingSuccess.classList.add('hidden');
                resetBooking();
                await fetchTrackerStats();
                switchView('view-home');
                if (data.booking) {
                    await renderHomeBookingFromServer(data.booking, { justConfirmed: true });
                } else {
                    await loadMyBooking({ justConfirmed: true });
                }
            } else {
                alert('We could not confirm your payment. If you were charged, contact support with your email.');
            }
        } catch {
            alert('Could not verify payment with the server.');
        }
        return;
    }

    if (checkout === 'cancel') {
        window.history.replaceState({}, '', window.location.pathname || '/');
        switchView('view-booking');
        stepFocus.classList.remove('active');
        stepTime.classList.remove('active');
        stepPayment.classList.add('active');
        bookingWizardEl?.classList.remove('hidden');
        bookingSuccess.classList.add('hidden');
    }
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    if (!msg) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
}

function persistSession(email, displayName) {
    sessionStorage.setItem('hoopify_session', JSON.stringify({ email, displayName: displayName || '' }));
}

function applyDisplayName(displayName) {
    const name = String(displayName || '').trim();
    const el = document.getElementById('user-display');
    const out = document.getElementById('btn-logout');
    const homeWelcome = document.getElementById('home-welcome');
    const trackerName = document.getElementById('tracker-player-name');

    if (el) {
        if (name) {
            el.textContent = name;
            el.style.display = 'inline';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
    }
    if (out) out.style.display = name ? 'inline' : 'none';

    if (homeWelcome) {
        if (name) {
            homeWelcome.textContent = `Welcome, ${name}`;
            homeWelcome.style.display = 'block';
        } else {
            homeWelcome.textContent = '';
            homeWelcome.style.display = 'none';
        }
    }
    if (trackerName) {
        if (name) {
            trackerName.textContent = name;
            trackerName.style.display = 'block';
        } else {
            trackerName.textContent = '';
            trackerName.style.display = 'none';
        }
    }
}

function clearSession() {
    sessionStorage.removeItem('hoopify_session');
    currentUser = null;
    const el = document.getElementById('user-display');
    const out = document.getElementById('btn-logout');
    const homeWelcome = document.getElementById('home-welcome');
    const trackerName = document.getElementById('tracker-player-name');
    if (el) {
        el.textContent = '';
        el.style.display = 'none';
    }
    if (out) out.style.display = 'none';
    if (homeWelcome) {
        homeWelcome.textContent = '';
        homeWelcome.style.display = 'none';
    }
    if (trackerName) {
        trackerName.textContent = '';
        trackerName.style.display = 'none';
    }
    hideHomeBooking();
}

function setupLogout() {
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        clearSession();
        showAuthError('');
        switchView('view-auth');
    });
}

function setAuthTab(which) {
    const signin = document.getElementById('tab-signin');
    const signup = document.getElementById('tab-signup');
    const pIn = document.getElementById('panel-signin');
    const pUp = document.getElementById('panel-signup');
    if (which === 'signin') {
        signin?.classList.add('active');
        signup?.classList.remove('active');
        pIn?.classList.add('active');
        pUp?.classList.remove('active');
        signin?.setAttribute('aria-selected', 'true');
        signup?.setAttribute('aria-selected', 'false');
    } else {
        signup?.classList.add('active');
        signin?.classList.remove('active');
        pUp?.classList.add('active');
        pIn?.classList.remove('active');
        signup?.setAttribute('aria-selected', 'true');
        signin?.setAttribute('aria-selected', 'false');
    }
}

function setupAuth() {
    document.getElementById('tab-signin')?.addEventListener('click', () => {
        setAuthTab('signin');
        showAuthError('');
    });
    document.getElementById('tab-signup')?.addEventListener('click', () => {
        setAuthTab('signup');
        showAuthError('');
    });

    document.getElementById('form-signin')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        showAuthError('');
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showAuthError(data.error || 'Sign in failed.');
                return;
            }
            await enterApp(data.username, data.displayName);
        } catch {
            showAuthError('Could not reach the server.');
        }
    });

    document.getElementById('form-signup')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        showAuthError('');
        const firstName = document.getElementById('signup-first').value.trim();
        const lastName = document.getElementById('signup-last').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const password2 = document.getElementById('signup-password2').value;
        if (password !== password2) {
            showAuthError('Passwords do not match.');
            return;
        }
        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName, lastName, email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showAuthError(data.error || 'Could not create account.');
                return;
            }
            await enterApp(data.username, data.displayName);
        } catch {
            showAuthError('Could not reach the server.');
        }
    });
}

async function enterApp(email, displayName) {
    currentUser = email;
    persistSession(email, displayName);
    applyDisplayName(displayName);
    await fetchTrackerStats();
    renderCategories();
    switchView('view-home');
}

async function tryRestoreSession() {
    const raw = sessionStorage.getItem('hoopify_session');
    if (!raw) return;
    let email;
    let displayName = '';
    try {
        const s = JSON.parse(raw);
        email = s.email;
        displayName = s.displayName || '';
    } catch {
        sessionStorage.removeItem('hoopify_session');
        return;
    }
    if (!email) return;
    try {
        const res = await fetch(`/api/tracker?username=${encodeURIComponent(email)}`);
        if (!res.ok) {
            clearSession();
            return;
        }
        await enterApp(email, displayName);
    } catch {
        clearSession();
    }
}

async function fetchTrackerStats() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/tracker?username=${encodeURIComponent(currentUser)}`);
        const data = await res.json();
        const tracker = data.tracker || {};
        Object.keys(tracker).forEach((skill) => {
            if (userStats[skill] !== undefined) {
                userStats[skill] = tracker[skill];
            }
        });
        workoutHistory = Array.isArray(data.history) ? [...data.history] : [];
    } catch (e) {
        console.warn('Backend not reachable. Displaying empty tracker stats.');
    }
}

// RENDER CATEGORIES FOR SELECTION
function renderCategories() {
    categoriesContainer.innerHTML = '';
    
    CATEGORIES.forEach((cat, index) => {
        const group = document.createElement('div');
        group.className = 'category-group open';
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <span>${cat.name}</span>
            <span class="chevron">▼</span>
        `;
        
        header.addEventListener('click', () => {
            group.classList.toggle('open');
        });
        
        const body = document.createElement('div');
        body.className = 'category-body';
        
        cat.skills.forEach(skill => {
            const chip = document.createElement('div');
            chip.className = 'skill-chip';
            chip.textContent = skill;
            chip.dataset.skill = skill;
            
            chip.addEventListener('click', () => toggleSkill(chip, skill));
            body.appendChild(chip);
        });
        
        group.appendChild(header);
        group.appendChild(body);
        categoriesContainer.appendChild(group);
    });
}

function toggleSkill(chipElement, skill) {
    if (selectedSkills.includes(skill)) {
        selectedSkills = selectedSkills.filter(s => s !== skill);
        chipElement.classList.remove('selected');
    } else {
        selectedSkills.push(skill);
        chipElement.classList.add('selected');
    }
    
    btnNextTime.disabled = selectedSkills.length === 0;
}

// NAVIGATION
function switchView(targetId) {
    views.forEach(v => v.classList.remove('active'));
    
    const targetElement = document.getElementById(targetId);
    if(targetElement) targetElement.classList.add('active');
    
    if(targetId === 'view-tracker') {
        fetchTrackerStats().then(renderTracker);
    }
    if (targetId === 'view-home' && currentUser) {
        loadMyBooking();
    }
}

function setupNavigation() {
    // Logo goes home (or auth if not signed in)
    document.getElementById('logo-home')?.addEventListener('click', () => {
        if (currentUser) switchView('view-home');
        else switchView('view-auth');
    });

    // Homepage Big Buttons
    document.getElementById('btn-go-booking')?.addEventListener('click', () => {
        switchView('view-booking');
    });
    document.getElementById('btn-go-stats')?.addEventListener('click', () => {
        switchView('view-tracker');
    });
}

// WIZARD LOGIC
function setupWizard() {
    const weekCalendarEl = document.getElementById('week-calendar');
    const weekLabelEl = document.getElementById('week-label');
    const btnNextPayment = document.getElementById('btn-next-payment');
    const slotHintEl = document.getElementById('slot-hint');

    function updateWeekLabel() {
        const days = buildWeekDays(weekOffset);
        if (weekLabelEl && days.length) {
            weekLabelEl.textContent = `${days[0].label} – ${days[6].label}`;
        }
    }

    function renderWeekCalendar() {
        if (!weekCalendarEl) return;
        const days = buildWeekDays(weekOffset);
        updateWeekLabel();
        weekCalendarEl.innerHTML = '';

        days.forEach((d) => {
            const col = document.createElement('div');
            col.className = 'week-col';
            col.innerHTML = `<div class="week-col-head"><span class="week-dow">${d.dayName.slice(0, 3)}</span><span class="week-date">${d.label}</span></div>`;
            const slotsWrap = document.createElement('div');
            slotsWrap.className = 'week-slots';

            const slots = systemAvailability[d.dayName] || [];
            const list = Array.isArray(slots) ? slots : [];

            if (list.length === 0) {
                slotsWrap.innerHTML = '<div class="week-no-slots">—</div>';
            } else {
                list.forEach((slot) => {
                    if (!slot || !slot.start || !slot.end) return;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'slot-btn';
                    btn.textContent = formatSlotRange(slot.start, slot.end);
                    const isSel =
                        selectedSlot &&
                        selectedSlot.date === d.dateISO &&
                        selectedSlot.slot.id === slot.id;
                    if (isSel) btn.classList.add('selected');

                    btn.addEventListener('click', () => {
                        selectedSlot = { date: d.dateISO, dayName: d.dayName, slot: { ...slot } };
                        weekCalendarEl.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
                        btn.classList.add('selected');
                        if (btnNextPayment) btnNextPayment.disabled = false;
                        if (slotHintEl) {
                            slotHintEl.textContent = `Selected: ${d.label} · ${formatSlotRange(slot.start, slot.end)}`;
                        }
                    });
                    slotsWrap.appendChild(btn);
                });
            }

            col.appendChild(slotsWrap);
            weekCalendarEl.appendChild(col);
        });
    }

    // Step 1 -> 2
    btnNextTime.addEventListener('click', async () => {
        stepFocus.classList.remove('active');
        stepTime.classList.add('active');
        selectedSlot = null;
        if (btnNextPayment) btnNextPayment.disabled = true;
        if (slotHintEl) slotHintEl.textContent = 'Tap a time to select it, then continue.';

        try {
            const res = await fetch('/api/availability');
            systemAvailability = await res.json();
        } catch (e) {
            systemAvailability = {};
        }
        renderWeekCalendar();
    });

    document.getElementById('week-prev')?.addEventListener('click', () => {
        weekOffset -= 1;
        renderWeekCalendar();
    });
    document.getElementById('week-next')?.addEventListener('click', () => {
        weekOffset += 1;
        renderWeekCalendar();
    });

    // Back 2 -> 1
    document.getElementById('btn-back-focus').addEventListener('click', () => {
        stepTime.classList.remove('active');
        stepFocus.classList.add('active');
    });

    // Step 2 -> 3
    btnNextPayment.addEventListener('click', async () => {
        if (!selectedSlot) {
            alert('Please select an available time slot.');
            return;
        }

        const { date, slot } = selectedSlot;
        const timeLabel = `${slot.start}–${slot.end}`;
        workoutDateTime = {
            date,
            time: timeLabel,
            time_start: slot.start,
            time_end: slot.end,
        };

        document.getElementById('summary-type').textContent = 'Individual (1-on-1)';
        document.getElementById('summary-focus').textContent = selectedSkills.join(', ');
        document.getElementById('summary-datetime').textContent = `${date} · ${formatSlotRange(slot.start, slot.end)}`;

        let venueText = '—';
        try {
            const r = await fetch('/api/config');
            const c = await r.json();
            if (c.venue) venueText = c.venue;
        } catch {
            /* keep placeholder */
        }
        const locEl = document.getElementById('summary-location');
        if (locEl) locEl.textContent = venueText;

        document.getElementById('summary-price').textContent = '$50.00';

        stepTime.classList.remove('active');
        stepPayment.classList.add('active');
    });

    // Back 3 -> 2
    document.getElementById('btn-back-time').addEventListener('click', () => {
        stepPayment.classList.remove('active');
        stepTime.classList.add('active');
    });

    // Pay -> Stripe Checkout (redirect)
    document.getElementById('btn-pay-now').addEventListener('click', async () => {
        if (!currentUser) {
            alert('Please sign in to pay.');
            return;
        }
        const btn = document.getElementById('btn-pay-now');
        const originalText = btn.textContent;
        btn.textContent = 'Redirecting to secure checkout…';
        btn.disabled = true;

        try {
            const res = await fetch('/api/checkout/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentUser,
                    date: workoutDateTime.date,
                    time: workoutDateTime.time,
                    time_start: workoutDateTime.time_start,
                    time_end: workoutDateTime.time_end,
                    focus: selectedSkills,
                    mode: workoutMode,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.error || 'Could not start checkout. Is Stripe configured on the server?');
                return;
            }
            if (data.url) {
                window.location.href = data.url;
                return;
            }
            alert('No checkout URL returned.');
        } catch (e) {
            alert('Error connecting to payment service.');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    // Reset loop
    document.getElementById('btn-book-another').addEventListener('click', () => {
        bookingSuccess.classList.add('hidden');
        bookingWizardEl?.classList.remove('hidden');
        resetBooking();
        stepFocus.classList.add('active');
    });
}

function resetBooking() {
    selectedSkills = [];
    document.querySelectorAll('.skill-chip').forEach(c => c.classList.remove('selected'));
    btnNextTime.disabled = true;
    selectedSlot = null;
    weekOffset = 0;
    const btnNp = document.getElementById('btn-next-payment');
    if (btnNp) btnNp.disabled = true;
    const hint = document.getElementById('slot-hint');
    if (hint) hint.textContent = 'Tap a time to select it, then continue.';
    const wc = document.getElementById('week-calendar');
    if (wc) wc.innerHTML = '';
}

// removed completeWorkoutBook locally since we use API and Tracker handles this

// TRACKER RENDERING
function renderTracker() {
    const attributesDisplay = document.getElementById('attributes-display');
    attributesDisplay.innerHTML = '';

    let totalDrills = 0;

    CATEGORIES.forEach(cat => {
        let catHtml = `
            <div class="attr-category">
                <div class="attr-category-header">${cat.name}</div>
        `;
        
        cat.skills.forEach(skill => {
            const val = userStats[skill];
            totalDrills += val;
            
            // For the visual bar, let's treat every 10 drills as a "level" to fill the bar
            const cycle = val % 10;
            const progress = val > 0 && cycle === 0 ? 100 : cycle * 10;
            let barColor = val > 0 ? 'var(--brand-green)' : 'var(--text-secondary)';
            
            catHtml += `
                <div class="attr-row">
                    <div class="attr-name">${skill}</div>
                    <div class="attr-bar-container">
                        <div class="attr-bar" style="width: ${val === 0 ? 0 : Math.max(progress, 5)}%; background: ${barColor}"></div>
                    </div>
                    <div class="attr-val" style="color: ${barColor}">${val}</div>
                </div>
            `;
        });
        
        catHtml += `</div>`;
        attributesDisplay.innerHTML += catHtml;
    });

    // Update Overall Drills Count
    document.getElementById('overall-score').textContent = totalDrills;
    
    // SVG circle math: fill based on milestone of 50 total drills to wrap around 
    const ringProgress = Math.min((totalDrills % 50) * 2, 100); 
    document.getElementById('overall-chart').setAttribute('stroke-dasharray', `${ringProgress === 0 && totalDrills > 0 ? 100 : ringProgress}, 100`);

    // Render History
    renderHistory();
}

function renderHistory() {
    const historyContainer = document.getElementById('history-container');
    
    if (workoutHistory.length === 0) {
        historyContainer.innerHTML = '<div class="empty-state">No workouts completed yet.</div>';
        return;
    }

    historyContainer.innerHTML = '';
    
    workoutHistory.forEach(item => {
        let gainTags = item.gains.map(g => `<span class="gain-tag">+${g.gain} ${g.skill}</span>`).join('');
        
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="hist-date">${item.date} • ${(item.mode || 'individual') === 'individual' ? '1-on-1' : 'Group Session'}</div>
            <div class="hist-title">Targeted Training</div>
            <div class="hist-gains">${gainTags}</div>
        `;
        historyContainer.appendChild(card);
    });
}

// START
document.addEventListener('DOMContentLoaded', init);

})();
