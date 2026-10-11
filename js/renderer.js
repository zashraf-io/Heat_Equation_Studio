/**
 * Heat Equation Canvas Renderer
 * Renders the physical body (rod / plate), heat-flow arrows, and animated particles.
 */

/* ================================================================
   COLOR MAP  –  "Inferno"-inspired thermal palette
   ================================================================ */

const COLORMAP = [
    { pos: 0.00, r: 4,   g: 3,   b: 28  },
    { pos: 0.10, r: 30,  g: 10,  b: 72  },
    { pos: 0.20, r: 72,  g: 17,  b: 110 },
    { pos: 0.30, r: 120, g: 28,  b: 109 },
    { pos: 0.40, r: 165, g: 44,  b: 85  },
    { pos: 0.50, r: 207, g: 68,  b: 50  },
    { pos: 0.60, r: 237, g: 105, b: 15  },
    { pos: 0.70, r: 252, g: 155, b: 5   },
    { pos: 0.80, r: 250, g: 205, b: 40  },
    { pos: 0.90, r: 245, g: 240, b: 120 },
    { pos: 1.00, r: 252, g: 255, b: 230 },
];

function temperatureColor(t) {
    t = Math.max(0, Math.min(1, t));
    let i = 0;
    while (i < COLORMAP.length - 2 && COLORMAP[i + 1].pos < t) i++;
    const c0 = COLORMAP[i], c1 = COLORMAP[i + 1];
    const f = (t - c0.pos) / (c1.pos - c0.pos);
    return [
        Math.round(c0.r + f * (c1.r - c0.r)),
        Math.round(c0.g + f * (c1.g - c0.g)),
        Math.round(c0.b + f * (c1.b - c0.b)),
    ];
}

function colormapCSS() {
    return 'linear-gradient(to top,' +
        COLORMAP.map(c => `rgb(${c.r},${c.g},${c.b}) ${c.pos * 100}%`).join(',') + ')';
}

/* ================================================================
   PARTICLE
   ================================================================ */

function makeParticle(dim) {
    return {
        x: Math.random(),
        y: dim === '2d' ? Math.random() : 0.2 + Math.random() * 0.6,
        life: Math.random(),
        maxLife: 0.4 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 2,
    };
}

/* ================================================================
   RENDERER
   ================================================================ */

class HeatRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.solver = null;

        /* off-screen canvas for 2-D ImageData */
        this.offCanvas = null;
        this.offCtx = null;
        this.imgData = null;

        /* particles */
        this.particles = [];

        /* cached layout */
        this.W = 0;
        this.H = 0;

        this.resize();
    }

    /* ---- sizing ---- */

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width  = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.W = rect.width;
        this.H = rect.height;

        if (this.solver && this.solver.dimension === '2d') this._initOffscreen();
    }

    /* ---- bind to solver ---- */

    setup(solver) {
        this.solver = solver;
        this.particles = [];
        const count = solver.dimension === '1d' ? 80 : 350;
        for (let i = 0; i < count; i++) {
            this.particles.push(makeParticle(solver.dimension));
        }
        if (solver.dimension === '2d') this._initOffscreen();
    }

    _initOffscreen() {
        const s = this.solver;
        this.offCanvas = document.createElement('canvas');
        this.offCanvas.width  = s.nx + 1;
        this.offCanvas.height = s.ny + 1;
        this.offCtx = this.offCanvas.getContext('2d');
        this.imgData = this.offCtx.createImageData(s.nx + 1, s.ny + 1);
    }

    /* ================================================================
       MAIN RENDER
       ================================================================ */

    render(cMin, cMax, simDt) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);

        if (!this.solver) return;

        if (this.solver.dimension === '1d') {
            this._render1D(ctx, cMin, cMax, simDt);
        } else {
            this._render2D(ctx, cMin, cMax, simDt);
        }
    }

    /* ================================================================
       1-D  ROD
       ================================================================ */

    _render1D(ctx, cMin, cMax, simDt) {
        const s = this.solver;
        const W = this.W, H = this.H;

        const pad   = W * 0.06;
        const rodX  = pad;
        const rodW  = W - 2 * pad;
        const rodH  = Math.min(H * 0.22, 90);
        const rodY  = H * 0.38 - rodH / 2;

        /* ---- draw rod segments ---- */
        const segW = rodW / s.nx + 0.5;
        for (let i = 0; i <= s.nx; i++) {
            const t = this._norm(s.u[i], cMin, cMax);
            const [r, g, b] = temperatureColor(t);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(rodX + (i / s.nx) * rodW, rodY, segW, rodH);
        }

        /* ---- glossy highlights ---- */
        const gTop = ctx.createLinearGradient(0, rodY, 0, rodY + rodH * 0.35);
        gTop.addColorStop(0, 'rgba(255,255,255,0.18)');
        gTop.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gTop;
        ctx.fillRect(rodX, rodY, rodW, rodH * 0.35);

        const gBot = ctx.createLinearGradient(0, rodY + rodH * 0.7, 0, rodY + rodH);
        gBot.addColorStop(0, 'rgba(0,0,0,0)');
        gBot.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = gBot;
        ctx.fillRect(rodX, rodY + rodH * 0.7, rodW, rodH * 0.3);

        /* ---- outline glow ---- */
        ctx.save();
        ctx.shadowColor = 'rgba(255,120,0,0.35)';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(rodX, rodY, rodW, rodH);
        ctx.restore();

        /* ---- rounded caps ---- */
        this._drawCap(ctx, rodX, rodY, rodH, cMin, cMax, s.u[0], true);
        this._drawCap(ctx, rodX + rodW, rodY, rodH, cMin, cMax, s.u[s.nx], false);

        /* ---- arrows ---- */
        this._drawArrows1D(ctx, s, rodX, rodY, rodW, rodH, cMin, cMax);

        /* ---- particles ---- */
        this._updateParticles1D(s, simDt, rodX, rodY, rodW, rodH);
        this._drawParticles(ctx, rodX, rodY, rodW, rodH, cMin, cMax);

        /* ---- axis labels ---- */
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '500 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('x = 0', rodX, rodY + rodH + 24);
        ctx.fillText('x = L', rodX + rodW, rodY + rodH + 24);

        /* ---- boundary labels ---- */
        this._drawBCLabel1D(ctx, s, rodX, rodY, rodW, rodH);
    }

    _drawCap(ctx, cx, y, h, cMin, cMax, uVal, isLeft) {
        const t = this._norm(uVal, cMin, cMax);
        const [r, g, b] = temperatureColor(t);
        const radius = h / 2;

        ctx.save();
        ctx.beginPath();
        if (isLeft) {
            ctx.arc(cx, y + radius, radius, Math.PI * 0.5, Math.PI * 1.5);
        } else {
            ctx.arc(cx, y + radius, radius, -Math.PI * 0.5, Math.PI * 0.5);
        }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
        ctx.restore();
    }

    _drawBCLabel1D(ctx, s, rx, ry, rw, rh) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        const y = ry - 12;
        switch (s.bcType) {
            case 'dirichlet':
                ctx.fillText(`u = ${s.bcParams.left}`, rx, y);
                ctx.fillText(`u = ${s.bcParams.right}`, rx + rw, y);
                break;
            case 'neumann':
                ctx.fillText(`∂u/∂x = ${s.bcParams.left}`, rx, y);
                ctx.fillText(`∂u/∂x = ${s.bcParams.right}`, rx + rw, y);
                break;
            case 'robin':
                ctx.fillText(`h=${s.bcParams.h}`, rx, y);
                ctx.fillText(`h=${s.bcParams.h}`, rx + rw, y);
                break;
        }
    }

    /* ---- 1D arrows ---- */

    _drawArrows1D(ctx, s, rx, ry, rw, rh, cMin, cMax) {
        const grad = s.getGradient1D();
        const spacing = Math.max(8, Math.floor(s.nx / 24));
        const arrowY = ry + rh + 40;
        const arrowLen = rw / s.nx * spacing * 0.35;

        ctx.save();
        for (let i = spacing; i < s.nx; i += spacing) {
            const x = rx + (i / s.nx) * rw;
            // Heat flux = -β * grad  → arrow direction
            const flux = -grad[i];
            const mag = Math.abs(flux);
            if (mag < 1e-6) continue;

            const dir = flux > 0 ? 1 : -1;
            const len = Math.min(arrowLen * mag * 30, arrowLen * 2.5);

            const t = this._norm(s.u[i], cMin, cMax);
            const [r, g, b] = temperatureColor(Math.min(1, t + 0.2));

            ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(0.7, mag * 20 + 0.1)})`;
            ctx.fillStyle   = ctx.strokeStyle;
            ctx.lineWidth = 1.8;

            // shaft
            ctx.beginPath();
            ctx.moveTo(x - dir * len / 2, arrowY);
            ctx.lineTo(x + dir * len / 2, arrowY);
            ctx.stroke();

            // arrowhead
            const tipX = x + dir * len / 2;
            ctx.beginPath();
            ctx.moveTo(tipX, arrowY);
            ctx.lineTo(tipX - dir * 5, arrowY - 4);
            ctx.lineTo(tipX - dir * 5, arrowY + 4);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Heat Flux q = −β ∂u/∂x', rx + rw / 2, arrowY + 18);
    }

    /* ================================================================
       2-D  PLATE
       ================================================================ */

    _render2D(ctx, cMin, cMax, simDt) {
        const s = this.solver;
        const W = this.W, H = this.H;

        const pad = W * 0.06;
        const maxSide = Math.min(W - 2 * pad, H - 2 * pad - 30);
        const side = Math.max(100, maxSide);
        const plateX = (W - side) / 2;
        const plateY = (H - side) / 2;

        /* ---- fill ImageData ---- */
        const data = this.imgData.data;
        const range = cMax - cMin || 1;
        for (let j = 0; j <= s.ny; j++) {
            for (let i = 0; i <= s.nx; i++) {
                const idx = this.idx2(i, j, s.nx + 1);
                const t = (s.u[s.idx(i, s.ny - j)] - cMin) / range;   // flip Y
                const [r, g, b] = temperatureColor(Math.max(0, Math.min(1, t)));
                data[idx]     = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            }
        }
        this.offCtx.putImageData(this.imgData, 0, 0);

        /* ---- draw scaled ---- */
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.offCanvas, plateX, plateY, side, side);

        /* ---- outline glow ---- */
        ctx.save();
        ctx.shadowColor = 'rgba(255,120,0,0.3)';
        ctx.shadowBlur = 20;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(plateX, plateY, side, side);
        ctx.restore();

        /* ---- 2D arrows ---- */
        this._drawArrows2D(ctx, s, plateX, plateY, side, side, cMin, cMax);

        /* ---- particles ---- */
        this._updateParticles2D(s, simDt, plateX, plateY, side, side);
        this._drawParticles2D(ctx, plateX, plateY, side, side, cMin, cMax);

        /* ---- axis labels ---- */
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('x', plateX + side / 2, plateY + side + 18);
        ctx.save();
        ctx.translate(plateX - 14, plateY + side / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('y', 0, 0);
        ctx.restore();

        /* ---- boundary labels ---- */
        this._drawBCLabel2D(ctx, s, plateX, plateY, side, side);
    }

    _drawBCLabel2D(ctx, s, px, py, pw, ph) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';

        const p = s.bcParams;
        let lblT = '', lblB = '', lblL = '', lblR = '';

        if (s.bcType === 'dirichlet') {
            lblT = `Top: u=${p.top}`;
            lblB = `Bottom: u=${p.bottom}`;
            lblL = `Left: u=${p.left}`;
            lblR = `Right: u=${p.right}`;
        } else if (s.bcType === 'neumann') {
            lblT = `Top flux: ${p.top}`;
            lblB = `Bottom flux: ${p.bottom}`;
            lblL = `Left flux: ${p.left}`;
            lblR = `Right flux: ${p.right}`;
        } else if (s.bcType === 'robin') {
            lblT = `Robin (h=${p.h}, u∞=${p.uAmbient})`;
        }

        // Draw Top
        ctx.fillText(lblT, px + pw / 2, py - 6);
        // Draw Bottom
        if (lblB) ctx.fillText(lblB, px + pw / 2, py + ph + 32);

        // Draw Left
        if (lblL) {
            ctx.save();
            ctx.translate(px - 28, py + ph / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(lblL, 0, 0);
            ctx.restore();
        }

        // Draw Right
        if (lblR) {
            ctx.save();
            ctx.translate(px + pw + 16, py + ph / 2);
            ctx.rotate(Math.PI / 2);
            ctx.fillText(lblR, 0, 0);
            ctx.restore();
        }
    }

    idx2(i, j, w) { return (j * w + i) * 4; }

    /* ---- 2D arrows ---- */

    _drawArrows2D(ctx, s, px, py, pw, ph, cMin, cMax) {
        const { gx, gy } = s.getGradient2D();
        const step = Math.max(4, Math.floor(s.nx / 10));
        const scale = pw / s.nx * step * 0.3;

        ctx.save();
        for (let j = step; j < s.ny; j += step) {
            for (let i = step; i < s.nx; i += step) {
                const ci = s.idx(i, j);
                const fx = -gx[ci];
                const fy =  gy[ci];  // flip y for screen
                const mag = Math.sqrt(fx * fx + fy * fy);
                if (mag < 1e-5) continue;

                const cx = px + (i / s.nx) * pw;
                const cy = py + ((s.ny - j) / s.ny) * ph;

                const len = Math.min(scale * mag * 25, scale * 2);
                const nx_ = fx / mag, ny_ = fy / mag;

                const t = this._norm(s.u[ci], cMin, cMax);
                const [r, g, b] = temperatureColor(Math.min(1, t + 0.15));
                const alpha = Math.min(0.65, mag * 15 + 0.08);

                ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
                ctx.fillStyle   = ctx.strokeStyle;
                ctx.lineWidth = 1.4;

                ctx.beginPath();
                ctx.moveTo(cx - nx_ * len / 2, cy - ny_ * len / 2);
                ctx.lineTo(cx + nx_ * len / 2, cy + ny_ * len / 2);
                ctx.stroke();

                // head
                const tipX = cx + nx_ * len / 2;
                const tipY = cy + ny_ * len / 2;
                const perpX = -ny_, perpY = nx_;
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(tipX - nx_ * 4 + perpX * 3, tipY - ny_ * 4 + perpY * 3);
                ctx.lineTo(tipX - nx_ * 4 - perpX * 3, tipY - ny_ * 4 - perpY * 3);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    }

    /* ================================================================
       PARTICLES
       ================================================================ */

    _updateParticles1D(s, dt, rx, ry, rw, rh) {
        const grad = s.getGradient1D();
        const speed = 0.0015;

        for (const p of this.particles) {
            const i = Math.round(p.x * s.nx);
            const ci = Math.max(0, Math.min(s.nx, i));
            const flux = -grad[ci] * s.beta;

            p.x += flux * speed * 60;
            p.life -= 0.008;

            if (p.life <= 0 || p.x < 0 || p.x > 1) {
                Object.assign(p, makeParticle('1d'));
            }
        }
    }

    _drawParticles(ctx, rx, ry, rw, rh, cMin, cMax) {
        const s = this.solver;
        ctx.save();
        for (const p of this.particles) {
            const sx = rx + p.x * rw;
            const sy = ry + p.y * rh;

            const ci = Math.round(p.x * s.nx);
            const t = this._norm(s.u[Math.max(0, Math.min(s.nx, ci))], cMin, cMax);
            const [r, g, b] = temperatureColor(t);
            const alpha = p.life / p.maxLife * 0.65;

            ctx.beginPath();
            ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.7})`;
            ctx.shadowBlur = 6;
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    _updateParticles2D(s, dt, px, py, pw, ph) {
        const { gx, gy } = s.getGradient2D();
        const speed = 0.0012;

        for (const p of this.particles) {
            const i = Math.round(p.x * s.nx);
            const j = Math.round(p.y * s.ny);
            const ci = s.idx(
                Math.max(0, Math.min(s.nx, i)),
                Math.max(0, Math.min(s.ny, j))
            );

            const fx = -gx[ci] * s.beta;
            const fy = -gy[ci] * s.beta;

            p.x += fx * speed * 60;
            p.y += fy * speed * 60;
            p.life -= 0.007;

            if (p.life <= 0 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
                Object.assign(p, makeParticle('2d'));
            }
        }
    }

    _drawParticles2D(ctx, px, py, pw, ph, cMin, cMax) {
        const s = this.solver;
        ctx.save();
        for (const p of this.particles) {
            const sx = px + p.x * pw;
            const sy = py + (1 - p.y) * ph;  // flip Y

            const i = Math.round(p.x * s.nx);
            const j = Math.round(p.y * s.ny);
            const ci = s.idx(
                Math.max(0, Math.min(s.nx, i)),
                Math.max(0, Math.min(s.ny, j))
            );
            const t = this._norm(s.u[ci], cMin, cMax);
            const [r, g, b] = temperatureColor(t);
            const alpha = p.life / p.maxLife * 0.55;

            ctx.beginPath();
            ctx.arc(sx, sy, p.size * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.6})`;
            ctx.shadowBlur = 5;
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    /* ---- normalize ---- */

    _norm(val, cMin, cMax) {
        const range = cMax - cMin;
        return range > 1e-12 ? (val - cMin) / range : 0;
    }
}
