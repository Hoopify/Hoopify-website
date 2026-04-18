function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

// Focus Categories Definitions
const CATEGORIES = [
    { name: "Outside Scoring", skills: ["Three-Point Shot", "Mid-Range Shot", "Close Shot", "Free Throw", "Offensive Consistency", "Shot IQ"] },
    { name: "Inside Scoring", skills: ["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands"] },
    { name: "Defense", skills: ["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense"] },
    { name: "Athleticism", skills: ["Speed", "Acceleration", "Strength", "Vertical", "Stamina", "Hustle", "Overall Durability"] },
    { name: "Playmaking", skills: ["Pass Accuracy", "Ball Handle", "Speed with Ball", "Pass IQ", "Pass Vision"] },
    { name: "Rebounding", skills: ["Offensive Rebound", "Defensive Rebound"] }
];

document.addEventListener('DOMContentLoaded', async () => {
    const raw = sessionStorage.getItem('hoopify_session');
    let sessEmail = '';
    try {
        if (raw) sessEmail = JSON.parse(raw).email || '';
    } catch {
        /* ignore */
    }
    if (!sessEmail) {
        window.location.href = 'index.html';
        return;
    }
    try {
        const gate = await fetch(`/api/admin/status?email=${encodeURIComponent(sessEmail)}`);
        const gateData = await gate.json();
        if (!gateData.allowed) {
            window.location.href = 'index.html';
            return;
        }
    } catch {
        window.location.href = 'index.html';
        return;
    }

    const adminCategories = document.getElementById('admin-categories');
    
    const availDay = document.getElementById('avail-day');
    const availStart = document.getElementById('avail-start');
    const availEnd = document.getElementById('avail-end');
    const btnAddAvail = document.getElementById('btn-add-availability');
    const availList = document.getElementById('availability-list');
    
    const bookingsList = document.getElementById('bookings-list');
    
    const btnLogWorkout = document.getElementById('btn-log-workout');
    const logUsername = document.getElementById('log-username');
    const logDrill = document.getElementById('log-drill');

    // Populate Checkboxes
    CATEGORIES.forEach(cat => {
        cat.skills.forEach(skill => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.innerHTML = `
                <input type="checkbox" value="${skill}">
                ${skill}
            `;
            adminCategories.appendChild(label);
        });
    });

    function formatRange(start, end) {
        const fmt = (h) => {
            const [hh, mm] = h.split(':').map(Number);
            const d = new Date(2000, 0, 1, hh, mm || 0);
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        };
        return `${fmt(start)} – ${fmt(end)}`;
    }

    // AVAILABILITY LOGIC (slots: id, start, end)
    async function fetchAvailability() {
        try {
            const res = await fetch('/api/availability');
            const data = await res.json();
            availList.innerHTML = '';

            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            days.forEach((day) => {
                const slots = data[day] || [];
                if (slots.length === 0) return;

                const block = document.createElement('div');
                block.style.background = 'var(--bg-dark)';
                block.style.padding = '12px';
                block.style.borderRadius = 'var(--radius-md)';
                block.style.marginBottom = '12px';
                block.style.border = '1px solid var(--border-color)';

                const head = document.createElement('div');
                head.style.fontWeight = 'bold';
                head.style.color = 'var(--brand-orange)';
                head.textContent = day;
                block.appendChild(head);

                slots.forEach((slot) => {
                    if (!slot || !slot.id) return;
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.flexWrap = 'wrap';
                    row.style.alignItems = 'center';
                    row.style.gap = '8px';
                    row.style.marginTop = '10px';
                    row.style.paddingTop = '10px';
                    row.style.borderTop = '1px solid var(--border-color)';

                    const label = document.createElement('span');
                    label.style.flex = '1';
                    label.style.minWidth = '160px';
                    label.textContent = formatRange(slot.start, slot.end);

                    const editWrap = document.createElement('div');
                    editWrap.style.display = 'none';
                    editWrap.style.flex = '1 1 100%';
                    editWrap.style.gap = '8px';
                    editWrap.style.alignItems = 'center';

                    const inS = document.createElement('input');
                    inS.type = 'time';
                    inS.value = slot.start;
                    inS.style.flex = '1';
                    inS.style.minWidth = '100px';
                    const inE = document.createElement('input');
                    inE.type = 'time';
                    inE.value = slot.end;
                    inE.style.flex = '1';
                    inE.style.minWidth = '100px';

                    const btnSave = document.createElement('button');
                    btnSave.className = 'btn secondary-btn';
                    btnSave.style.padding = '6px 10px';
                    btnSave.style.fontSize = '12px';
                    btnSave.textContent = 'Save';
                    btnSave.addEventListener('click', async () => {
                        const start = inS.value;
                        const end = inE.value;
                        if (!start || !end || start >= end) {
                            alert('End must be after start.');
                            return;
                        }
                        await fetch('/api/availability', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ day, id: slot.id, start, end }),
                        });
                        fetchAvailability();
                    });

                    const btnCancel = document.createElement('button');
                    btnCancel.className = 'btn';
                    btnCancel.style.padding = '6px 10px';
                    btnCancel.style.fontSize = '12px';
                    btnCancel.textContent = 'Cancel';
                    btnCancel.addEventListener('click', () => {
                        editWrap.style.display = 'none';
                        label.style.display = '';
                    });

                    editWrap.appendChild(inS);
                    editWrap.appendChild(inE);
                    editWrap.appendChild(btnSave);
                    editWrap.appendChild(btnCancel);

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn secondary-btn';
                    btnEdit.style.padding = '4px 10px';
                    btnEdit.style.fontSize = '11px';
                    btnEdit.textContent = 'Edit';
                    btnEdit.addEventListener('click', () => {
                        label.style.display = 'none';
                        editWrap.style.display = 'flex';
                    });

                    const btnDel = document.createElement('button');
                    btnDel.className = 'btn';
                    btnDel.style.padding = '4px 10px';
                    btnDel.style.fontSize = '11px';
                    btnDel.style.background = 'rgba(255,0,0,0.1)';
                    btnDel.style.color = 'red';
                    btnDel.textContent = 'Remove';
                    btnDel.addEventListener('click', async () => {
                        if (!confirm('Remove this open slot?')) return;
                        await fetch('/api/availability', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ day, id: slot.id }),
                        });
                        fetchAvailability();
                    });

                    row.appendChild(label);
                    row.appendChild(btnEdit);
                    row.appendChild(btnDel);
                    row.appendChild(editWrap);
                    block.appendChild(row);
                });

                availList.appendChild(block);
            });

            if (availList.innerHTML === '') {
                availList.innerHTML = '<div class="empty-state">No schedule set.</div>';
            }
        } catch (e) {
            availList.innerHTML = '<div class="empty-state">Failed to load schedule.</div>';
        }
    }

    btnAddAvail.addEventListener('click', async () => {
        const day = availDay.value;
        const start = availStart.value;
        const end = availEnd.value;
        if (!start || !end) return alert('Set start and end times');
        if (start >= end) return alert('End must be after start');
        await fetch('/api/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day, start, end }),
        });
        availStart.value = '';
        availEnd.value = '';
        fetchAvailability();
    });

    // BOOKINGS LOGIC
    async function fetchBookings() {
        try {
            const res = await fetch('/api/bookings');
            const data = await res.json();
            if (data.length === 0) {
                bookingsList.innerHTML = '<div class="empty-state">No active bookings.</div>';
                return;
            }
            bookingsList.innerHTML = '';
            
            // sort by closest date
            data.sort((a,b) => new Date(a.date) - new Date(b.date));

            data.forEach(b => {
                const div = document.createElement('div');
                div.className = 'list-item';
                div.style.flexDirection = 'column';
                div.style.alignItems = 'flex-start';

                const focusList = Array.isArray(b.focus) ? b.focus : [];
                const tags = focusList.map((f) => `<span class="gain-tag" style="margin-right:4px;">${esc(f)}</span>`).join('');
                const when =
                    b.time_start && b.time_end
                        ? `${esc(b.date)} · ${formatRange(b.time_start, b.time_end)}`
                        : `${esc(b.date)} @ ${esc(b.time)}`;
                const place = b.venue ? `<div style="font-size: 13px; color: var(--text-secondary); margin-top: 8px; line-height: 1.4;"><strong style="color: var(--text-secondary);">Place:</strong> ${esc(b.venue)}</div>` : '';
                div.innerHTML = `
                    <div style="font-size: 15px; font-weight: bold; color: var(--brand-orange); margin-bottom: 6px;">${when}</div>
                    <div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">Player: <span style="color: #fff;">${esc(b.username)}</span></div>
                    ${place}
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; margin-top: 8px;">Target Focus:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">${tags}</div>
                    
                    <button class="btn secondary-btn" style="margin-top: 12px; padding: 6px; font-size: 12px;" onclick="document.getElementById('log-username').value = '${esc(b.username)}'">Sync Username to Drill Logger ↓</button>
                `;
                bookingsList.appendChild(div);
            });
        } catch(e) {
            bookingsList.innerHTML = '<div class="empty-state">Failed to load bookings.</div>';
        }
    }

    // LOGGING WORKOUTS LOGIC
    btnLogWorkout.addEventListener('click', async () => {
        const username = logUsername.value.trim();
        const drillTitle = logDrill.value.trim();
        
        const selectedCats = Array.from(adminCategories.querySelectorAll('input:checked')).map(cb => cb.value);
        
        if (!username || !drillTitle || selectedCats.length === 0) {
            return alert('Please enter user, description, and at least one tag.');
        }

        btnLogWorkout.disabled = true;
        btnLogWorkout.innerText = 'Syncing...';

        try {
            const res = await fetch('/api/tracker/log', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username, drillTitle, categories: selectedCats })
            });
            if(res.ok) {
                alert(`Workout logged to ${username}'s tracker!`);
                logUsername.value = '';
                logDrill.value = '';
                adminCategories.querySelectorAll('input:checked').forEach(cb => cb.checked = false);
            }
        } catch(e) {
            alert('Failed to construct workout to user profile.');
        } finally {
            btnLogWorkout.disabled = false;
            btnLogWorkout.innerText = 'Log & Sync to Player Tracker';
        }
    });

    fetchAvailability();
    fetchBookings();
});
