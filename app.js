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
let workoutMode = "individual"; // individual or group
let workoutDateTime = null;

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

/** After Stripe redirect: verify session and show confirmation. */
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
                switchView('view-booking');
                stepFocus.classList.remove('active');
                stepTime.classList.remove('active');
                stepPayment.classList.remove('active');
                bookingWizardEl?.classList.add('hidden');
                bookingSuccess.classList.remove('hidden');
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
    let systemAvailability = {};

    // Step 1 -> 2
    btnNextTime.addEventListener('click', async () => {
        stepFocus.classList.remove('active');
        stepTime.classList.add('active');
        
        // Fetch Admin Availability Template
        try {
            const res = await fetch('/api/availability');
            systemAvailability = await res.json();
            document.getElementById('workout-time').innerHTML = '<option value="">Select a date first...</option>';
        } catch(e) { }
    });

    // Handle Date Changes to populate Times
    document.getElementById('workout-date').addEventListener('change', (e) => {
        const timeSelect = document.getElementById('workout-time');
        const dateVal = e.target.value;
        if (!dateVal) {
            timeSelect.innerHTML = '<option value="">Select a date first...</option>';
            return;
        }

        // Parse date properly ignoring timezone shifts from ISO
        const [year, month, day] = dateVal.split('-');
        const selectedDate = new Date(year, month - 1, day);
        const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });

        const availableTimes = systemAvailability[dayOfWeek] || [];
        
        if(availableTimes.length === 0) {
            timeSelect.innerHTML = '<option value="">No availability for ' + dayOfWeek + 's</option>';
            return;
        }

        timeSelect.innerHTML = '<option value="" disabled selected>Select a time block...</option>';
        availableTimes.forEach(t => {
            // Display friendly time
            timeSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
    });

    // Back 2 -> 1
    document.getElementById('btn-back-focus').addEventListener('click', () => {
        stepTime.classList.remove('active');
        stepFocus.classList.add('active');
    });

    // Mode Selection
    const modeCards = document.querySelectorAll('.mode-card');
    modeCards.forEach(card => {
        card.addEventListener('click', () => {
            modeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            workoutMode = card.dataset.mode;
        });
    });

    // Step 2 -> 3
    document.getElementById('btn-next-payment').addEventListener('click', () => {
        const dateRaw = document.getElementById('workout-date').value;
        const timeRaw = document.getElementById('workout-time').value;
        
        if(!dateRaw || !timeRaw) {
            alert("Please select a date and an available time block");
            return;
        }

        // populate summary
        workoutDateTime = { date: dateRaw, time: timeRaw };
        document.getElementById('summary-type').textContent = workoutMode === 'individual' ? 'Individual (1-on-1)' : 'Group Workout';
        document.getElementById('summary-focus').textContent = selectedSkills.join(', ');
        document.getElementById('summary-datetime').textContent = `${dateRaw} @ ${timeRaw}`;
        
        const price = workoutMode === 'individual' ? '$50.00' : '$30.00';
        document.getElementById('summary-price').textContent = price;
        document.getElementById('btn-pay-amount').textContent = price;

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
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Redirecting to secure checkout…';
        btn.disabled = true;

        try {
            const res = await fetch('/api/checkout/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentUser,
                    date: workoutDateTime.date,
                    time: workoutDateTime.time,
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
            btn.innerHTML = originalText;
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
    document.getElementById('workout-date').value = '';
    document.getElementById('workout-time').innerHTML = '<option value="">Select a date first...</option>';
    workoutMode = 'individual';
    document.querySelectorAll('.mode-card').forEach((c, idx) => {
        if(idx === 0) c.classList.add('active');
        else c.classList.remove('active');
    });
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
