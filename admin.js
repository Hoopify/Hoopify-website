// Focus Categories Definitions
const CATEGORIES = [
    { name: "Outside Scoring", skills: ["Three-Point Shot", "Mid-Range Shot", "Close Shot", "Free Throw", "Offensive Consistency", "Shot IQ"] },
    { name: "Inside Scoring", skills: ["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands"] },
    { name: "Defense", skills: ["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense"] },
    { name: "Athleticism", skills: ["Speed", "Acceleration", "Strength", "Vertical", "Stamina", "Hustle", "Overall Durability"] },
    { name: "Playmaking", skills: ["Pass Accuracy", "Ball Handle", "Speed with Ball", "Pass IQ", "Pass Vision"] },
    { name: "Rebounding", skills: ["Offensive Rebound", "Defensive Rebound"] }
];

document.addEventListener('DOMContentLoaded', () => {
    const adminCategories = document.getElementById('admin-categories');
    
    const availDay = document.getElementById('avail-day');
    const availTime = document.getElementById('avail-time');
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

    // AVAILABILITY LOGIC
    async function fetchAvailability() {
        try {
            const res = await fetch('/api/availability');
            const data = await res.json();
            availList.innerHTML = '';
            
            const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
            days.forEach(day => {
                const times = data[day] || [];
                if(times.length > 0) {
                    const block = document.createElement('div');
                    block.style.background = 'var(--bg-dark)';
                    block.style.padding = '12px';
                    block.style.borderRadius = 'var(--radius-md)';
                    block.style.marginBottom = '12px';
                    block.style.border = '1px solid var(--border-color)';
                    
                    let timesHtml = times.map(t => `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
                        <span>${t}</span>
                        <button class="btn" style="width: auto; padding: 2px 8px; font-size: 11px; background: rgba(255,0,0,0.1); color: red;" onclick="deleteSlot('${day}', '${t}')">X</button>
                    </div>`).join('');
                    
                    block.innerHTML = `<div style="font-weight: bold; color: var(--brand-orange);">${day}</div>${timesHtml}`;
                    availList.appendChild(block);
                }
            });
            if(availList.innerHTML === '') {
                availList.innerHTML = '<div class="empty-state">No schedule set.</div>';
            }
        } catch(e) {
            availList.innerHTML = '<div class="empty-state">Failed to load schedule.</div>';
        }
    }

    window.deleteSlot = async (day, time) => {
        await fetch('/api/availability', {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ day, time })
        });
        fetchAvailability();
    };

    btnAddAvail.addEventListener('click', async () => {
        const day = availDay.value;
        const time = availTime.value;
        if (!time) return alert('Select a time');
        await fetch('/api/availability', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ day, time })
        });
        availTime.value = '';
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
                
                const tags = b.focus.map(f => `<span class="gain-tag" style="margin-right:4px;">${f}</span>`).join('');
                div.innerHTML = `
                    <div style="font-size: 15px; font-weight: bold; color: var(--brand-orange); margin-bottom: 6px;">${b.date} @ ${b.time}</div>
                    <div style="font-size: 14px; font-weight: 500; margin-bottom: 8px;">Player: <span style="color: #fff;">${b.username}</span></div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Target Focus:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">${tags}</div>
                    
                    <button class="btn secondary-btn" style="margin-top: 12px; padding: 6px; font-size: 12px;" onclick="document.getElementById('log-username').value = '${b.username}'">Sync Username to Drill Logger ↓</button>
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
