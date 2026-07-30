// ─────────────────────────────────────────────────────────────────────
// web/ui/water-ui.js
// Water tracker card for the Today view. Not a habit — it has its own
// Firestore doc (Core/water.js) and its own daily streak, so it renders
// above sectionsRoot rather than inside the section-order system.
//
// Web counterpart of the native app's components/WaterCard.tsx. Vessel
// silhouettes come from the shared web/ui/vessel-geometry.js port, so both
// apps draw the identical glass. The native card's gyroscope tilt, splash
// physics and rising bubbles are deliberately NOT reproduced here — the
// fill level and its wave are animated in CSS instead.
//
// Visuals stay decoupled from the data layer: every tap goes through
// addWater/undoWater in Core, which owns the payout side-effect.
// ─────────────────────────────────────────────────────────────────────

import { state } from '../../Core/state.js';
import { addWater, undoWater, computeWaterStreak } from '../../Core/water.js';
import { WATER_CONFIG } from '../../Core/config.js';
import { VESSEL_GEOMETRY, VESSEL_IDS, VESSEL_LABELS, shapesToSvg } from './vessel-geometry.js';

const GLASS_FILL   = 'rgba(255,255,255,0.35)';
const GLASS_STROKE = 'rgba(59,143,212,0.55)';

let pickerOpen = false;

function selectedVesselId() {
    const saved = localStorage.getItem('waterVessel');
    return VESSEL_GEOMETRY[saved] ? saved : 'glass';
}

// One vessel drawn at `pct` full. `uid` keeps the clipPath/gradient ids
// unique — the picker renders several of these into the same document.
function vesselSvg(id, pct, goalHit, uid, height) {
    const g = VESSEL_GEOMETRY[id] || VESSEL_GEOMETRY.glass;
    const [vbW, vbH] = g.viewBox;
    const range   = g.fillBottom - g.fillTop;
    const surface = g.fillBottom - range * Math.max(0, Math.min(1, pct));
    const w       = height * (vbW / vbH);

    return `
        <svg class="water-vessel-svg" viewBox="0 0 ${vbW} ${vbH}" width="${w}" height="${height}" aria-hidden="true">
            <defs>
                <clipPath id="wclip-${uid}"><path d="${g.fillClipPath}"/></clipPath>
                <linearGradient id="wgrad-${uid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0"   stop-color="#b7e4f5"/>
                    <stop offset="0.5" stop-color="#4aa3dd"/>
                    <stop offset="1"   stop-color="#1d6bab"/>
                </linearGradient>
            </defs>
            <path d="${g.outlinePath}" fill="${GLASS_FILL}" stroke="${GLASS_STROKE}" stroke-width="2"/>
            <g clip-path="url(#wclip-${uid})">
                <rect class="water-fill" x="0" y="${surface}" width="${vbW}" height="${vbH}" fill="url(#wgrad-${uid})"/>
                <path class="water-wave" d="${wavePath(vbW, surface)}" fill="url(#wgrad-${uid})"/>
                <line x1="0" y1="${surface}" x2="${vbW}" y2="${surface}"
                      stroke="${goalHit ? '#f2dd9a' : '#dff4ff'}" stroke-width="1.5" opacity="0.9"/>
            </g>
            <path d="${g.outlinePath}" fill="none"
                  stroke="${goalHit ? '#e9c96a' : '#ffffff'}" stroke-opacity="${goalHit ? 0.9 : 0.6}" stroke-width="1.5"/>
            ${shapesToSvg(g.decorations)}
        </svg>`;
}

// A shallow two-hump wave sitting on the surface line. Drawn a full period
// wider than the viewBox so the CSS translate can loop it seamlessly.
function wavePath(vbW, surface) {
    const amp = 2.5;
    const seg = vbW / 2;
    let d = `M ${-vbW},${surface}`;
    for (let x = -vbW; x < vbW * 2; x += seg) {
        d += ` q ${seg / 4},${-amp} ${seg / 2},0 q ${seg / 4},${amp} ${seg / 2},0`;
    }
    return d + ` L ${vbW * 2},${surface + 200} L ${-vbW},${surface + 200} Z`;
}

export function renderWaterCard() {
    const root = document.getElementById('waterRoot');
    if (!root) return;
    if (!state.waterLoaded) { root.innerHTML = ''; return; }

    const { amount, goal } = state.waterData;
    const pct     = goal > 0 ? amount / goal : 0;
    const goalHit = amount >= goal;
    const streak  = computeWaterStreak();
    const id      = selectedVesselId();
    const inc     = WATER_CONFIG.incrementOz;

    root.innerHTML = `
        <div class="water-card">
            <div class="water-vessel-col">
                ${vesselSvg(id, pct, goalHit, 'main', 100)}
                <div class="water-ground-shadow"></div>
                <button class="water-vessel-pill" onclick="window.toggleWaterPicker()"
                        title="Change vessel" aria-expanded="${pickerOpen}">
                    <span>${VESSEL_LABELS[id]}</span><span class="water-chevron">${pickerOpen ? '▴' : '▾'}</span>
                </button>
            </div>
            <div class="water-body">
                <div class="water-header">
                    <span class="water-title">Water</span>
                    ${streak >= 1 ? `<span class="water-streak">🔥 ${streak}</span>` : ''}
                </div>
                <div class="water-amount-row">
                    <span class="water-amount${goalHit ? ' water-amount-gold' : ''}">${amount}</span>
                    <span class="water-amount-goal"> / ${goal} oz</span>
                </div>
                ${pickerOpen ? `
                    <div class="water-picker">
                        ${VESSEL_IDS.map(v => `
                            <button class="water-thumb${v === id ? ' water-thumb-sel' : ''}"
                                    onclick="window.selectWaterVessel('${v}')" title="${VESSEL_LABELS[v]}">
                                ${vesselSvg(v, 0.55, false, 'pick-' + v, 34)}
                            </button>`).join('')}
                    </div>` : ''}
                <div class="water-btn-row">
                    <button class="water-undo-btn" onclick="window.undoWaterTap()" ${amount <= 0 ? 'disabled' : ''}>−${inc}</button>
                    <button class="water-add-btn" onclick="window.addWaterTap()">+${inc} oz</button>
                </div>
            </div>
        </div>`;
}

window.toggleWaterPicker = () => {
    pickerOpen = !pickerOpen;
    renderWaterCard();
};

window.selectWaterVessel = (id) => {
    if (!VESSEL_GEOMETRY[id]) return;
    localStorage.setItem('waterVessel', id);
    pickerOpen = false;
    renderWaterCard();
};

window.addWaterTap = async () => {
    const before = state.waterData.amount;
    const goal   = state.waterData.goal;
    await addWater();
    renderWaterCard();
    // Crossing the goal is the moment that banks the habit bubble, so it's
    // worth a fanfare — but only on the crossing, not every tap past it.
    if (before < goal && state.waterData.amount >= goal) {
        const { triggerFanfare } = await import('./animations.js');
        triggerFanfare('goal');
        const { checkWaterStreakMilestone } = await import('./achievements-ui.js');
        await checkWaterStreakMilestone();
    }
    // The linked habit's bubbles may have changed — repaint Today too.
    window.render?.();
};

window.undoWaterTap = async () => {
    if (state.waterData.amount <= 0) return;
    await undoWater();
    renderWaterCard();
    window.render?.();
};
