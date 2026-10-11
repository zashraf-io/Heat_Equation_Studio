/**
 * Heat Equation Visualizer – Application Controller
 * Manages UI, animation loop, Plotly graphs, and KaTeX equations.
 */

/* ================================================================
   GLOBALS
   ================================================================ */

let solver, renderer;
let playing  = false;
let animId   = null;
let speed    = 'normal';
let frameIdx = 0;

// Color range (fixed to initial, only expanded)
let colorMin = 0;
let colorMax = 1;

// Spacetime data for 1D (accumulated)
let spacetimeX  = [];
let spacetimeT  = [];
let spacetimeU  = [];
const MAX_SNAPSHOTS = 180;
let snapshotInterval = 0;
let lastSnapshotStep = 0;

/* ================================================================
   SPEED  –  simulation seconds per wall second
   ================================================================ */

const SPEED_MAP = { slow: 2, normal: 8, fast: 35 };

function stepsPerFrame() {
    const simPerSec = SPEED_MAP[speed];
    const fps = 60;
    return Math.max(1, Math.round(simPerSec / (fps * solver.dt)));
}

/* ================================================================
   INITIALISE
   ================================================================ */

function init() {
    const canvas = document.getElementById('body-canvas');
    renderer = new HeatRenderer(canvas);

    buildSolver();
    bindUI();
    updateEquationDisplay();
    renderStaticMath();
    window.addEventListener('resize', onResize);
    onResize();
    initGraphs();
    renderFrame();          // one initial draw
}

function renderStaticMath() {
    if (typeof renderMathInElement === 'function') {
        const eduSection = document.getElementById('edu-section');
        if (eduSection) {
            renderMathInElement(eduSection, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        }
    }
}

function buildSolver() {
    const dim = getActiveDim();
    const beta = parseFloat(document.getElementById('beta-input').value) || 0.01;
    const bcType = document.getElementById('bc-select').value;
    const icType = document.getElementById('ic-select').value;
    const forcingType = document.getElementById('forcing-select').value;

    const bcParams = readBCParams(bcType);

    solver = new HeatSolver({
        dimension: dim,
        beta,
        bcType,
        bcParams,
        icType,
        forcingType,
    });

    renderer.setup(solver);

    // Update dynamic UI labels
    const badge = document.getElementById('body-type-badge');
    if (badge) {
        badge.textContent = dim === '1d' ? '1D Metallic Rod' : '2D Square Plate';
    }
    const t2d = document.getElementById('graph-2d-title');
    const t3d = document.getElementById('graph-3d-title');
    if (t2d) t2d.textContent = dim === '1d' ? 'Temperature Profile u(x, t)' : 'Centerline Slice u(x, y=L/2)';
    if (t3d) t3d.textContent = dim === '1d' ? 'Spacetime Evolution u(x, t)' : '3D Surface u(x, y, t)';

    // Color range
    colorMin = solver.uMin;
    colorMax = solver.uMax;
    if (Math.abs(colorMax - colorMin) < 1e-8) colorMax = colorMin + 1;

    // Spacetime reset
    spacetimeX = [];
    spacetimeT = [];
    spacetimeU = [];
    snapshotInterval = Math.max(1, Math.round(stepsPerFrame() * 0.5));
    lastSnapshotStep = 0;

    updateStats();
    updateLegend();
    const overlay = document.getElementById('steady-state-overlay');
    if (overlay) overlay.classList.add('hidden');

    const statusBadge = document.getElementById('status-badge');
    if (statusBadge) {
        statusBadge.classList.remove('steady');
        if (!playing) {
            statusBadge.classList.remove('running');
            statusBadge.querySelector('.status-text').textContent = 'Paused';
        }
    }
}

/* ================================================================
   UI  BINDING
   ================================================================ */

function bindUI() {
    /* presets mapping */
    const PRESETS = {
        dirichlet_zero: {
            dim: '1d', beta: 0.01, bcType: 'dirichlet', icType: 'sine', forcing: 'none',
            bcParams: { left: 0, right: 0 }
        },
        neumann_insulated: {
            dim: '1d', beta: 0.015, bcType: 'neumann', icType: 'step', forcing: 'none',
            bcParams: { left: 0, right: 0 }
        },
        robin_cooling: {
            dim: '1d', beta: 0.02, bcType: 'robin', icType: 'gaussian', forcing: 'none',
            bcParams: { h: 5.0, uAmbient: 0.0 }
        },
        lecture_harmonics: {
            dim: '1d', beta: 0.02, bcType: 'dirichlet', icType: 'harmonics', forcing: 'none',
            bcParams: { left: 0, right: 0 }
        },
        heat_source: {
            dim: '1d', beta: 0.01, bcType: 'dirichlet', icType: 'sine', forcing: 'center',
            bcParams: { left: 0, right: 0 }
        },
        plate_2d: {
            dim: '2d', beta: 0.01, bcType: 'dirichlet', icType: 'gaussian', forcing: 'none',
            bcParams: { left: 0, right: 0, top: 0, bottom: 0 }
        }
    };

    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const presetKey = chip.dataset.preset;
            const p = PRESETS[presetKey];
            if (!p) return;

            document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            // Set dimension
            document.querySelectorAll('#dimension-toggle .toggle-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.value === p.dim);
            });

            // Set Beta
            document.getElementById('beta-input').value = p.beta.toFixed(4);
            document.getElementById('beta-slider').value = Math.log10(p.beta);

            // Set Selects
            document.getElementById('bc-select').value = p.bcType;
            document.getElementById('ic-select').value = p.icType;
            document.getElementById('forcing-select').value = p.forcing;

            buildBCParamsUI();
            if (p.bcParams) {
                if (p.bcParams.left !== undefined && document.getElementById('bc-left')) document.getElementById('bc-left').value = p.bcParams.left;
                if (p.bcParams.right !== undefined && document.getElementById('bc-right')) document.getElementById('bc-right').value = p.bcParams.right;
                if (p.bcParams.top !== undefined && document.getElementById('bc-top')) document.getElementById('bc-top').value = p.bcParams.top;
                if (p.bcParams.bottom !== undefined && document.getElementById('bc-bottom')) document.getElementById('bc-bottom').value = p.bcParams.bottom;
                if (p.bcParams.h !== undefined && document.getElementById('bc-h')) document.getElementById('bc-h').value = p.bcParams.h;
                if (p.bcParams.uAmbient !== undefined && document.getElementById('bc-uamb')) document.getElementById('bc-uamb').value = p.bcParams.uAmbient;
            }

            resetSimulation();
            if (!playing) togglePlay();
        });
    });

    /* dimension toggle */
    document.querySelectorAll('#dimension-toggle .toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#dimension-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            buildBCParamsUI();
            resetSimulation();
        });
    });

    /* beta slider ↔ input */
    const bSlider = document.getElementById('beta-slider');
    const bInput  = document.getElementById('beta-input');
    bSlider.addEventListener('input', () => {
        bInput.value = Math.pow(10, parseFloat(bSlider.value)).toFixed(4);
        updateEquationDisplay();
        resetSimulation();
    });
    bInput.addEventListener('change', () => {
        const v = parseFloat(bInput.value);
        if (v > 0) bSlider.value = Math.log10(v);
        updateEquationDisplay();
        resetSimulation();
    });

    /* selects */
    document.getElementById('bc-select').addEventListener('change', () => {
        buildBCParamsUI();
        updateEquationDisplay();
        resetSimulation();
    });
    document.getElementById('ic-select').addEventListener('change', () => {
        updateEquationDisplay();
        resetSimulation();
    });
    document.getElementById('forcing-select').addEventListener('change', () => {
        updateEquationDisplay();
        resetSimulation();
    });

    /* speed */
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            speed = btn.dataset.speed;
        });
    });

    /* play / reset */
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-reset').addEventListener('click', resetSimulation);

    /* educational accordion toggle */
    const eduHeader = document.getElementById('edu-header');
    const eduSection = document.getElementById('edu-section');
    if (eduHeader && eduSection) {
        eduHeader.addEventListener('click', () => {
            eduSection.classList.toggle('collapsed');
        });
    }

    /* initial BC params UI */
    buildBCParamsUI();
}

function getActiveDim() {
    const active = document.querySelector('#dimension-toggle .toggle-btn.active');
    return active ? active.dataset.value : '1d';
}

/* ================================================================
   BOUNDARY CONDITION  PARAMS  UI
   ================================================================ */

function buildBCParamsUI() {
    const bcType = document.getElementById('bc-select').value;
    const container = document.getElementById('bc-params-container');
    container.innerHTML = '';

    const dim = getActiveDim();

    if (bcType === 'dirichlet') {
        addBCInput(container, 'bc-left',   dim === '1d' ? 'Left Temp (x=0)' : 'Left', 0);
        addBCInput(container, 'bc-right',  dim === '1d' ? 'Right Temp (x=L)' : 'Right', 0);
        if (dim === '2d') {
            addBCInput(container, 'bc-top',    'Top', 0);
            addBCInput(container, 'bc-bottom', 'Bottom', 0);
        }
    } else if (bcType === 'neumann') {
        addBCInput(container, 'bc-left',  dim === '1d' ? 'Flux at x=0' : 'Left Flux', 0);
        addBCInput(container, 'bc-right', dim === '1d' ? 'Flux at x=L' : 'Right Flux', 0);
        if (dim === '2d') {
            addBCInput(container, 'bc-top',    'Top Flux', 0);
            addBCInput(container, 'bc-bottom', 'Bottom Flux', 0);
        }
        const note = document.createElement('p');
        note.className = 'bc-note';
        note.textContent = '0 = perfectly insulated (adiabatic)';
        container.appendChild(note);
    } else if (bcType === 'robin') {
        addBCInput(container, 'bc-h',      'Convection Coeff. (h)', 5);
        addBCInput(container, 'bc-uamb',   'Ambient Temp (u∞)', 0);
        const note = document.createElement('p');
        note.className = 'bc-note';
        note.textContent = 'Newton cooling: −k ∂u/∂n = h(u − u∞)';
        container.appendChild(note);
    }
}

function addBCInput(container, id, label, defaultVal) {
    const group = document.createElement('div');
    group.className = 'control-group compact';
    group.innerHTML = `
        <label for="${id}">${label}</label>
        <input type="number" id="${id}" value="${defaultVal}" step="0.1">
    `;
    container.appendChild(group);
    group.querySelector('input').addEventListener('input', () => {
        resetSimulation();
    });
}

function readBCParams(bcType) {
    const p = {};
    const parseVal = (id, fallback = 0) => {
        const el = document.getElementById(id);
        if (!el) return fallback;
        const v = parseFloat(el.value);
        return isNaN(v) ? fallback : v;
    };
    if (bcType === 'dirichlet' || bcType === 'neumann') {
        p.left   = parseVal('bc-left', 0);
        p.right  = parseVal('bc-right', 0);
        p.top    = parseVal('bc-top', 0);
        p.bottom = parseVal('bc-bottom', 0);
    } else if (bcType === 'robin') {
        p.h        = parseVal('bc-h', 5);
        p.uAmbient = parseVal('bc-uamb', 0);
    }
    return p;
}

/* ================================================================
   PLAY / PAUSE / RESET
   ================================================================ */

function togglePlay() {
    if (solver && solver.steady) {
        resetSimulation();
    }

    playing = !playing;
    const btn = document.getElementById('btn-play');
    const icon = btn.querySelector('.play-icon');
    const text = btn.querySelector('.play-text');
    const badge = document.getElementById('status-badge');

    if (playing) {
        icon.textContent = '⏸';
        if (text) text.textContent = 'Pause';
        btn.classList.add('playing');
        badge.querySelector('.status-text').textContent = 'Running';
        badge.classList.remove('steady');
        badge.classList.add('running');
        requestAnimationFrame(loop);
    } else {
        icon.textContent = '▶';
        if (text) text.textContent = 'Resume';
        btn.classList.remove('playing');
        badge.querySelector('.status-text').textContent = 'Paused';
        badge.classList.remove('running');
        if (animId) cancelAnimationFrame(animId);
        animId = null;
    }
}

function resetSimulation() {
    if (playing) {
        playing = false;
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        const btn = document.getElementById('btn-play');
        btn.querySelector('.play-icon').textContent = '▶';
        const text = btn.querySelector('.play-text');
        if (text) text.textContent = 'Start Simulation';
        btn.classList.remove('playing');
    }
    buildSolver();
    updateEquationDisplay();
    initGraphs();
    renderFrame();
}

/* ================================================================
   ANIMATION LOOP
   ================================================================ */

function loop() {
    if (!playing || solver.steady) {
        if (solver.steady) onSteadyState();
        return;
    }

    const n = stepsPerFrame();
    solver.step(n);

    // Expand color range if needed
    if (solver.uMax > colorMax) colorMax = solver.uMax;
    if (solver.uMin < colorMin) colorMin = solver.uMin;

    renderFrame();

    // Accumulate spacetime snapshot (1D)
    if (solver.dimension === '1d' && solver.stepCount - lastSnapshotStep >= snapshotInterval) {
        addSpacetimeSnapshot();
        lastSnapshotStep = solver.stepCount;
    }

    frameIdx++;
    if (frameIdx % 3 === 0) updateGraphs();
    if (frameIdx % 6 === 0) updateStats();

    animId = requestAnimationFrame(loop);
}

function renderFrame() {
    renderer.render(colorMin, colorMax, solver.dt);
}

function onSteadyState() {
    playing = false;
    const btn = document.getElementById('btn-play');
    btn.querySelector('.play-icon').textContent = '▶';
    const text = btn.querySelector('.play-text');
    if (text) text.textContent = 'Restart';
    btn.classList.remove('playing');

    const badge = document.getElementById('status-badge');
    badge.querySelector('.status-text').textContent = 'Steady State';
    badge.classList.remove('running');
    badge.classList.add('steady');

    document.getElementById('steady-state-overlay').classList.remove('hidden');
    updateGraphs();
    updateStats();
}

/* ================================================================
   STATS
   ================================================================ */

function updateStats() {
    document.getElementById('stat-time').textContent  = solver.time.toFixed(3);
    document.getElementById('stat-max').textContent   = solver.uMax.toFixed(4);
    document.getElementById('stat-min').textContent   = solver.uMin.toFixed(4);
    document.getElementById('stat-steps').textContent = solver.stepCount.toLocaleString();
}

function updateLegend() {
    const grad = document.querySelector('.legend-gradient');
    grad.style.background = colormapCSS();

    document.getElementById('legend-max').textContent = colorMax.toFixed(2);
    document.getElementById('legend-min').textContent = colorMin.toFixed(2);
    document.getElementById('legend-mid').textContent = ((colorMax + colorMin) / 2).toFixed(2);
}

/* ================================================================
   PLOTLY GRAPHS
   ================================================================ */

const plotlyDarkLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor:  'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', size: 11, color: 'rgba(255,255,255,0.65)' },
    margin: { l: 50, r: 20, t: 35, b: 40 },
    xaxis: {
        gridcolor: 'rgba(255,255,255,0.06)',
        zerolinecolor: 'rgba(255,255,255,0.1)',
    },
    yaxis: {
        gridcolor: 'rgba(255,255,255,0.06)',
        zerolinecolor: 'rgba(255,255,255,0.1)',
    },
};

function initGraphs() {
    if (solver.dimension === '1d') {
        initGraphs1D();
    } else {
        initGraphs2D();
    }
}

function getGraphYRange() {
    const mn = Math.min(colorMin, solver.uMin);
    const mx = Math.max(colorMax, solver.uMax);
    const span = Math.max(0.1, mx - mn);
    const pad = span * 0.08;
    return [mn - pad, mx + pad];
}

function initGraphs1D() {
    /* Left: u(x) profile */
    const xArr = Array.from({ length: solver.nx + 1 }, (_, i) => i * solver.dx);
    const uArr = Array.from(solver.u);
    const yRange = getGraphYRange();

    Plotly.react('graph-2d', [{
        x: xArr, y: uArr,
        type: 'scatter', mode: 'lines',
        line: { color: '#ff8c00', width: 2.5 },
        name: 'u(x, t)',
    }], {
        ...plotlyDarkLayout,
        title: { text: 'Temperature Profile u(x, t)', font: { size: 13, color: '#ccc' } },
        xaxis: { ...plotlyDarkLayout.xaxis, title: 'x' },
        yaxis: { ...plotlyDarkLayout.yaxis, title: 'u', range: yRange, autorange: false },
    }, { responsive: true, displayModeBar: false });

    /* Right: spacetime heatmap (will build up) */
    spacetimeX = xArr;
    spacetimeT = [0];
    spacetimeU = [Array.from(solver.u)];

    Plotly.react('graph-3d', [{
        z: spacetimeU,
        x: spacetimeX,
        y: spacetimeT,
        type: 'heatmap',
        colorscale: buildPlotlyColorscale(),
        showscale: false,
        zmin: colorMin,
        zmax: colorMax,
    }], {
        ...plotlyDarkLayout,
        title: { text: 'Spacetime u(x, t)', font: { size: 13, color: '#ccc' } },
        xaxis: { ...plotlyDarkLayout.xaxis, title: 'x' },
        yaxis: { ...plotlyDarkLayout.yaxis, title: 'time t', autorange: true },
    }, { responsive: true, displayModeBar: false });
}

function initGraphs2D() {
    const xArr = Array.from({ length: solver.nx + 1 }, (_, i) => i * solver.dx);
    const yArr = Array.from({ length: solver.ny + 1 }, (_, j) => j * solver.dy);
    const zRange = getGraphYRange();

    /* Left: 3D surface */
    const zData = [];
    for (let j = 0; j <= solver.ny; j++) {
        const row = [];
        for (let i = 0; i <= solver.nx; i++) {
            row.push(solver.u[solver.idx(i, j)]);
        }
        zData.push(row);
    }

    Plotly.react('graph-3d', [{
        z: zData, x: xArr, y: yArr,
        type: 'surface',
        colorscale: buildPlotlyColorscale(),
        showscale: false,
        cmin: colorMin, cmax: colorMax,
    }], {
        ...plotlyDarkLayout,
        title: { text: '3D Surface u(x, y, t)', font: { size: 13, color: '#ccc' } },
        scene: {
            xaxis: { title: 'x', backgroundcolor: 'rgba(0,0,0,0)', gridcolor: 'rgba(255,255,255,0.08)' },
            yaxis: { title: 'y', backgroundcolor: 'rgba(0,0,0,0)', gridcolor: 'rgba(255,255,255,0.08)' },
            zaxis: {
                title: 'u',
                backgroundcolor: 'rgba(0,0,0,0)',
                gridcolor: 'rgba(255,255,255,0.08)',
                range: zRange,
                autorange: false
            },
            bgcolor: 'rgba(0,0,0,0)',
            camera: { eye: { x: 1.6, y: -1.6, z: 1.2 } },
        },
        margin: { l: 0, r: 0, t: 35, b: 0 },
    }, { responsive: true, displayModeBar: false });

    /* Right: cross-section */
    const profile = solver.getProfile(0.5);
    Plotly.react('graph-2d', [{
        x: xArr, y: profile,
        type: 'scatter', mode: 'lines',
        line: { color: '#ff8c00', width: 2.5 },
        name: 'u(x, y=L/2)',
    }], {
        ...plotlyDarkLayout,
        title: { text: 'Cross-section u(x, y=L/2)', font: { size: 13, color: '#ccc' } },
        xaxis: { ...plotlyDarkLayout.xaxis, title: 'x' },
        yaxis: { ...plotlyDarkLayout.yaxis, title: 'u', range: zRange, autorange: false },
    }, { responsive: true, displayModeBar: false });
}

function updateGraphs() {
    if (solver.dimension === '1d') {
        updateGraphs1D();
    } else {
        updateGraphs2D();
    }
    updateLegend();
}

function updateGraphs1D() {
    const uArr = Array.from(solver.u);
    const yRange = getGraphYRange();

    Plotly.restyle('graph-2d', { y: [uArr] }, [0]);
    Plotly.relayout('graph-2d', { 'yaxis.range': yRange });

    /* spacetime heatmap – update data and dynamic colorscale range */
    if (spacetimeU.length > 0) {
        Plotly.restyle('graph-3d', {
            z: [spacetimeU],
            y: [spacetimeT],
            zmin: colorMin,
            zmax: colorMax,
        }, [0]);
    }
}

function addSpacetimeSnapshot() {
    spacetimeT.push(solver.time);
    spacetimeU.push(Array.from(solver.u));
    if (spacetimeU.length > MAX_SNAPSHOTS) {
        spacetimeT.shift();
        spacetimeU.shift();
    }
}

function updateGraphs2D() {
    const zRange = getGraphYRange();

    /* surface */
    const zData = [];
    for (let j = 0; j <= solver.ny; j++) {
        const row = [];
        for (let i = 0; i <= solver.nx; i++) {
            row.push(solver.u[solver.idx(i, j)]);
        }
        zData.push(row);
    }
    Plotly.restyle('graph-3d', { z: [zData], cmin: colorMin, cmax: colorMax }, [0]);
    Plotly.relayout('graph-3d', { 'scene.zaxis.range': zRange });

    /* cross-section */
    const profile = solver.getProfile(0.5);
    Plotly.restyle('graph-2d', { y: [profile] }, [0]);
    Plotly.relayout('graph-2d', { 'yaxis.range': zRange });
}

/* ---- build Plotly-compatible colorscale from our COLORMAP ---- */

function buildPlotlyColorscale() {
    return COLORMAP.map(c => [c.pos, `rgb(${c.r},${c.g},${c.b})`]);
}

/* ================================================================
   KATEX EQUATION DISPLAY
   ================================================================ */

function updateEquationDisplay() {
    const el = document.getElementById('equation-display');
    if (typeof katex === 'undefined') {
        el.textContent = '';
        return;
    }

    const dim = getActiveDim();
    const beta = document.getElementById('beta-input').value;
    const bcType = document.getElementById('bc-select').value;
    const forcing = document.getElementById('forcing-select').value;

    let eq = '\\frac{\\partial u}{\\partial t} = ' + beta;
    if (dim === '1d') {
        eq += '\\, \\frac{\\partial^2 u}{\\partial x^2}';
    } else {
        eq += '\\left(\\frac{\\partial^2 u}{\\partial x^2} + \\frac{\\partial^2 u}{\\partial y^2}\\right)';
    }
    if (forcing === 'center') eq += ' + f_{\\text{point}}';
    else if (forcing === 'uniform') eq += ' + f_0';

    try {
        katex.render(eq, el, { displayMode: false, throwOnError: false });
    } catch (e) {
        el.textContent = '';
    }
}

/* ================================================================
   RESIZE
   ================================================================ */

function onResize() {
    renderer.resize();
    renderFrame();
    Plotly.Plots.resize(document.getElementById('graph-2d'));
    Plotly.Plots.resize(document.getElementById('graph-3d'));
}

/* ================================================================
   BOOT
   ================================================================ */

window.addEventListener('DOMContentLoaded', () => {
    // Small delay to let KaTeX load
    setTimeout(init, 150);
});
