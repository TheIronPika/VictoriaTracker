// ─────────────────────────────────────────────────────────────────────
// web/ui/animations.js
// All visual + audio effects: bubble pops, confetti, floating particles,
// time-based color shift, balance counter animation, weather fetch.
// No Firebase. No DOM structure — only DOM reads/writes to existing nodes.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { getTier, toCumulative } from '../../Core/habits.js';
import { getDayIdx } from '../../Core/utils.js';
import { computeStreaksFromHistory } from '../../Core/streaks.js';
import { isCycleDue } from '../../Core/cycles.js';
import { WEATHER_CONFIG } from '../../Core/config.js';

// ── Bubble pop sound ──────────────────────────────────────────────────

function getAudioCtx() {
    if (!uiState.audioCtx) {
        uiState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return uiState.audioCtx;
}

export function playBubblePop(isFilling) {
    try {
        const ctx  = getAudioCtx();
        const now  = ctx.currentTime;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        const filt = ctx.createBiquadFilter();

        osc.connect(filt);
        filt.connect(gain);
        gain.connect(ctx.destination);

        filt.type = 'bandpass';
        filt.frequency.value = isFilling ? 1200 : 700;
        filt.Q.value = 1.2;

        osc.type = 'sine';
        const startF = isFilling ? 880 : 440;
        const endF   = isFilling ? 420 : 200;
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.exponentialRampToValueAtTime(endF, now + 0.08);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(isFilling ? 0.18 : 0.10, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.15);
    } catch (e) { /* audio blocked — silently skip */ }
}

// ── Tier fanfare confetti ─────────────────────────────────────────────

export function triggerFanfare(tier) {
    if (tier === 'low') {
        const shapes = [confetti.shapeFromText({ text: '🎀', scalar: 2 })];
        confetti({ particleCount: 9, spread: 45, origin: { y: 0.8 }, shapes, scalar: 2 });
        confetti({ particleCount: 36, spread: 45, origin: { y: 0.8 }, colors: ['#f6d365', '#e67e22'] });
    } else if (tier === 'goal') {
        const shapes = [confetti.shapeFromText({ text: '🌸', scalar: 2 })];
        confetti({ particleCount: 12, spread: 55, origin: { y: 0.7 }, shapes, scalar: 2 });
        confetti({ particleCount: 48, spread: 55, origin: { y: 0.7 }, colors: ['#84fab0', '#27ae60'] });
        setTimeout(() => confetti({ particleCount: 4, spread: 35, origin: { y: 0.75, x: 0.5 }, colors: ['#84fab0', '#27ae60'], startVelocity: 20 }), 150);
    } else if (tier === 'bonus') {
        const shapes = [confetti.shapeFromText({ text: '🦋', scalar: 2 })];
        confetti({ particleCount: 27, spread: 65, origin: { y: 0.75, x: 0.5 }, shapes, scalar: 2 });
        confetti({ particleCount: 108, spread: 65, origin: { y: 0.75, x: 0.5 }, colors: ['#d4a0fc', '#8e44ad'] });
    }
}

// ── Cleanup old perfectWeek localStorage keys ─────────────────────────
export function cleanupOldPerfectWeekKeys() {
    const cutoff   = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('perfectWeek_')) {
            const d = new Date(k.replace('perfectWeek_', '')).getTime();
            if (!isNaN(d) && d < cutoff) toRemove.push(k);
        }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
}

// ── Perfect week confetti ─────────────────────────────────────────────

export function checkPerfectWeek() {
    if (!uiState.habits.length) return;
    const key = 'perfectWeek_' + new Date().toDateString();
    if (localStorage.getItem(key)) return;
    // Only require habits that actually count this week — exclude excused and
    // not-yet-due cyclic habits. Without this, a single excused or dormant
    // habit made the celebration almost impossible to trigger.
    const counting = uiState.habits.filter(h => !h.excused && isCycleDue(h));
    if (!counting.length) return;
    const allGood = counting.every(h => {
        const tier = getTier(h, toCumulative(h.history)[getDayIdx(uiState.viewingDate)] || 0);
        return tier === 'goal' || tier === 'bonus';
    });
    if (allGood) { localStorage.setItem(key, '1'); triggerPerfectWeek(); }
}

export function triggerPerfectWeek() {
    const colors = ['#d4a3a3','#c49abd','#9b72b5','#f5e6f8','#ffffff','#f9c8e0'];
    const end    = Date.now() + 5000;
    (function frame() {
        confetti({ particleCount: 8, angle: 55,  spread: 90, origin: { x: 0,   y: 0.7 }, colors });
        confetti({ particleCount: 8, angle: 125, spread: 90, origin: { x: 1,   y: 0.7 }, colors });
        confetti({ particleCount: 5, angle: 90,  spread: 60, origin: { x: 0.5, y: 0.9 }, colors });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

// ── Streak milestone confetti ─────────────────────────────────────────
// Fires when a habit's streak hits 1, 2, 4, or 14+ weeks exactly.
// Uses localStorage to avoid re-triggering on every page load.

export function checkStreakMilestones() {
    if (!state.weeklyHistory.length) return;
    const milestones = [1, 2, 4, 14];
    uiState.habits.forEach(h => {
        const { streak } = computeStreaksFromHistory(state.weeklyHistory, h.id);
        if (!milestones.includes(streak)) return;
        const key = `streakMilestone_${h.id}_${streak}`;
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');

        const shapes = [confetti.shapeFromText({ text: '🔥', scalar: 2 })];
        confetti({ particleCount: 60, spread: 50, origin: { x: 0.4, y: 0.8 }, shapes, scalar: 2, startVelocity: 45 });
        confetti({ particleCount: 60, spread: 50, origin: { x: 0.6, y: 0.8 }, colors: ['#ff6b5b', '#ff3d3d'], startVelocity: 45 });
        setTimeout(() => {
            confetti({ particleCount: 40, spread: 70, origin: { x: 0.5, y: 0.75 }, shapes, scalar: 2, startVelocity: 35 });
        }, 300);
        setTimeout(() => {
            confetti({ particleCount: 30, spread: 60, origin: { x: 0.5, y: 0.75 }, colors: ['#ff6b5b', '#ff3d3d'], startVelocity: 30 });
        }, 300);
    });
}

// ── Animated balance counter ──────────────────────────────────────────

export function animateMoneyDisplay(target) {
    if (uiState.moneyAnimFrame) cancelAnimationFrame(uiState.moneyAnimFrame);
    const start    = uiState.displayedMoney;
    const t0       = performance.now();
    const duration = 550;
    function step(now) {
        const p    = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
        const cur  = start + (target - start) * ease;
        uiState.displayedMoney = cur;
        const el = document.getElementById('moneyDisplay');
        if (el) {
            el.innerText = (cur < 0 ? '-$' : '$') + Math.abs(cur).toFixed(2);
            el.style.color = cur < 0 ? 'var(--color-punish)' : cur > 0 ? 'var(--color-goal)' : 'var(--text-main)';
        }
        if (p < 1) { uiState.moneyAnimFrame = requestAnimationFrame(step); }
        else { uiState.displayedMoney = target; uiState.moneyAnimFrame = null; }
    }
    uiState.moneyAnimFrame = requestAnimationFrame(step);
}

// ── Floating particle background ──────────────────────────────────────

export function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    const pts = Array.from({ length: 38 }, () => ({
        x:     Math.random() * window.innerWidth,
        y:     Math.random() * window.innerHeight,
        r:     Math.random() * 2.5 + 0.8,
        speed: Math.random() * 0.35 + 0.08,
        drift: (Math.random() - 0.5) * 0.25,
        op:    Math.random() * 0.18 + 0.04,
        phase: Math.random() * Math.PI * 2
    }));

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const color = getComputedStyle(document.documentElement)
            .getPropertyValue('--header-pink').trim() || '#d4a3a3';
        pts.forEach(p => {
            p.y     -= p.speed;
            p.x     += p.drift;
            p.phase += 0.018;
            if (p.y < -8)                p.y = canvas.height + 8, p.x = Math.random() * canvas.width;
            if (p.x < -8)                p.x = canvas.width + 8;
            if (p.x > canvas.width + 8)  p.x = -8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = p.op * (0.65 + 0.35 * Math.sin(p.phase));
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        requestAnimationFrame(draw);
    }
    draw();
}

// ── Time-based color shift ────────────────────────────────────────────
// Morning (5–10): warm pink → Night (20+): deep purple

export function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
}

export function applyTimeColor() {
    // Manual vibe override takes priority over time-based shift
    const overrideHue = localStorage.getItem('vt_vibeHue');
    if (overrideHue !== null) {
        const hue = parseInt(overrideHue);
        const sat = parseInt(localStorage.getItem('vt_vibeSat') || '37');
        document.documentElement.style.setProperty('--header-pink', hslToHex(hue, sat, 73));
        document.documentElement.style.setProperty('--soft-rose',   hslToHex(hue, Math.round(sat * 0.55), 95));
        return;
    }

    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const stops = [
        [0,  '#8c75b8', '#e8e0f2'],
        [5,  '#d4a3a3', '#f9ecec'],
        [10, '#d4a3a3', '#f9ecec'],
        [15, '#c49abd', '#f5eaf5'],
        [19, '#a882c4', '#f0e8f8'],
        [22, '#9070b8', '#ebe0f5'],
        [24, '#8c75b8', '#e8e0f2'],
    ];
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (h >= stops[i][0] && h < stops[i + 1][0]) { s0 = stops[i]; s1 = stops[i + 1]; break; }
    }
    const t = (h - s0[0]) / (s1[0] - s0[0]);

    function lerpHex(a, b, t) {
        const r  = c => parseInt(c.slice(1, 3), 16);
        const g  = c => parseInt(c.slice(3, 5), 16);
        const bv = c => parseInt(c.slice(5, 7), 16);
        const iv = (a, b) => Math.round(a + (b - a) * t);
        const h2 = v => v.toString(16).padStart(2, '0');
        return '#' + h2(iv(r(a), r(b))) + h2(iv(g(a), g(b))) + h2(iv(bv(a), bv(b)));
    }

    document.documentElement.style.setProperty('--header-pink', lerpHex(s0[1], s1[1], t));
    document.documentElement.style.setProperty('--soft-rose',   lerpHex(s0[2], s1[2], t));
}

// ── Greeting ──────────────────────────────────────────────────────────

export function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good Morning';
    if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
    else if (hour >= 17 && hour < 21) greeting = 'Good Evening';
    else if (hour >= 21 || hour < 5)  greeting = 'Good Night';
    document.getElementById('daytimeGreeting').innerText = greeting;
}

// ── Weather + UV ──────────────────────────────────────────────────────

export async function fetchWeatherAndUV() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        try {
            const res   = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${WEATHER_CONFIG.openWeatherKey}`);
            const wData = await res.json();
            if (wData.main) {
                const iconMap = {
                    '01d':'☀️','01n':'🌙','02d':'⛅','02n':'☁️','03d':'☁️','03n':'☁️',
                    '04d':'☁️','04n':'☁️','09d':'🌧️','09n':'🌧️','10d':'🌦️','10n':'🌧️',
                    '11d':'⛈️','11n':'⛈️','13d':'❄️','13n':'❄️','50d':'🌫️'
                };
                document.getElementById('weatherInfo').innerText =
                    `${iconMap[wData.weather[0].icon] || '☀️'} ${Math.round(wData.main.temp)}°F`;
            }
        } catch (e) {}

        try {
            const uvRes  = await fetch(`https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lon}`, {
                headers: { 'x-access-token': WEATHER_CONFIG.openUVKey }
            });
            const uvData = await uvRes.json();
            const uvIdx  = Math.round(uvData.result.uv);
            const uvEl   = document.getElementById('uvDisplay');
            uvEl.innerText    = `UV Index: ${uvIdx}`;
            uvEl.style.color  = uvIdx <= 2 ? '#27ae60' : uvIdx <= 5 ? '#f1c40f' : uvIdx <= 7 ? '#e67e22' : '#d9534f';
        } catch (e) {
            document.getElementById('uvDisplay').innerText = 'UV Index: --';
        }
    });
}
