// ─────────────────────────────────────────────────────────────────────
// web/ui/lucky-draw.js
// Lucky-draw effects: clover popup over the bubble + toast notification
// with clover/star confetti. Odds scale by tier (see Core/config.js
// LUCKY_DRAW_ODDS), max once per habit per day. Called from
// habits-ui.js toggleBubble.
// ─────────────────────────────────────────────────────────────────────

export function showCloverPopup(bubbleElement) {
    if (!bubbleElement) return;
    const rect    = bubbleElement.getBoundingClientRect();
    const centerX = rect.left + rect.width  / 2;
    const centerY = rect.top  + rect.height / 2;

    const clover = document.createElement('div');
    clover.className   = 'clover-popup';
    clover.textContent = '🍀';
    clover.style.left  = centerX + 'px';
    clover.style.top   = centerY + 'px';
    document.body.appendChild(clover);

    setTimeout(() => clover.remove(), 1200);
}

export function showLuckyDrawToast() {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = '<span>🍀</span> <span>Lucky draw! +1 ⭐</span>';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);

    // 🍀 Clovers + ⭐ Stars confetti
    const clover = confetti.shapeFromText({ text: '🍀', scalar: 2 });
    const star   = confetti.shapeFromText({ text: '⭐', scalar: 2 });
    confetti({ particleCount: 20, spread: 60, origin: { y: 0.75, x: 0.5 }, shapes: [clover], scalar: 2, startVelocity: 30 });
    setTimeout(() => {
        confetti({ particleCount: 15, spread: 50, origin: { y: 0.75, x: 0.5 }, shapes: [star], scalar: 2, startVelocity: 25 });
    }, 150);
}
