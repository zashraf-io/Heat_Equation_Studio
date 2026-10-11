/**
 * Heat Equation PDE Solver
 * ∂u/∂t = β∇²u + f(x,y,t)
 * 
 * Explicit finite difference (Forward Euler) with CFL stability.
 * Supports 1D (rod) and 2D (plate) domains.
 * Boundary conditions: Dirichlet, Neumann, Robin (Newton cooling).
 */

class HeatSolver {
    constructor(config = {}) {
        // Physical parameters
        this.beta = config.beta ?? 0.01;
        this.L = 1.0;

        // Domain
        this.dimension = config.dimension ?? '1d';

        // Grid resolution
        this.nx = this.dimension === '1d' ? 200 : 64;
        this.ny = this.dimension === '2d' ? 64 : 1;

        this.dx = this.L / this.nx;
        this.dy = this.dimension === '2d' ? this.L / this.ny : this.dx;

        // Boundary conditions
        this.bcType = config.bcType ?? 'dirichlet';
        this.bcParams = Object.assign({}, config.bcParams ?? {});
        this._fillDefaultBC();

        // Initial condition type
        this.icType = config.icType ?? 'sine';

        // Forcing function type
        this.forcingType = config.forcingType ?? 'none';

        // Compute stable time step
        this._computeDt();

        // Simulation state
        this.time = 0;
        this.stepCount = 0;
        this.steady = false;
        this.maxChange = Infinity;
        this.uMin = 0;
        this.uMax = 1;
        this.initialUMax = 1;
        this.initialUMin = 0;

        // Allocate arrays and apply IC + BC
        this._init();
    }

    /* ---- internal helpers ---- */

    _fillDefaultBC() {
        const p = this.bcParams;
        switch (this.bcType) {
            case 'dirichlet':
                if (p.left  === undefined) p.left  = 0;
                if (p.right === undefined) p.right = 0;
                if (p.top   === undefined) p.top   = 0;
                if (p.bottom === undefined) p.bottom = 0;
                break;
            case 'neumann':
                if (p.left  === undefined) p.left  = 0;
                if (p.right === undefined) p.right = 0;
                if (p.top   === undefined) p.top   = 0;
                if (p.bottom === undefined) p.bottom = 0;
                break;
            case 'robin':
                if (p.h === undefined) p.h = 5.0;
                if (p.uAmbient === undefined) p.uAmbient = 0;
                break;
        }
    }

    _computeDt() {
        const safety = 0.4;
        if (this.dimension === '1d') {
            this.dt = safety * this.dx * this.dx / (2 * this.beta);
        } else {
            const d = Math.min(this.dx, this.dy);
            this.dt = safety * d * d / (4 * this.beta);
        }
    }

    _init() {
        const size = this.dimension === '1d'
            ? this.nx + 1
            : (this.nx + 1) * (this.ny + 1);

        this.u    = new Float64Array(size);
        this.uTmp = new Float64Array(size);

        this._applyIC();
        this._applyBC(this.u);
        this._updateRange();

        this.initialUMax = this.uMax;
        this.initialUMin = this.uMin;
    }

    /* ---- 2D flat-index helper ---- */

    idx(i, j) {
        return j * (this.nx + 1) + i;
    }

    /* ================================================================
       INITIAL CONDITIONS
       ================================================================ */

    _applyIC() {
        if (this.dimension === '1d') {
            for (let i = 0; i <= this.nx; i++) {
                this.u[i] = this._ic1D(i * this.dx);
            }
        } else {
            for (let j = 0; j <= this.ny; j++) {
                for (let i = 0; i <= this.nx; i++) {
                    this.u[this.idx(i, j)] = this._ic2D(i * this.dx, j * this.dy);
                }
            }
        }
    }

    _ic1D(x) {
        const L = this.L;
        switch (this.icType) {
            case 'sine':      return Math.sin(Math.PI * x / L);
            case 'harmonics': {
                // Lecture example: superposition of harmonics demonstrating higher-frequency decay
                const v = 0.5 * Math.sin(2 * Math.PI * x / L) - 0.7 * Math.sin(5 * Math.PI * x / L);
                return Math.max(0, v + 0.6);
            }
            case 'gaussian':  return Math.exp(-60 * (x - L / 2) ** 2);
            case 'step':      return x < L / 2 ? 1.0 : 0.0;
            case 'triangle': {
                const half = L / 2;
                return x <= half ? (2 * x / L) : (2 * (L - x) / L);
            }
            default: return Math.sin(Math.PI * x / L);
        }
    }

    _ic2D(x, y) {
        const L = this.L;
        switch (this.icType) {
            case 'sine':
                return Math.sin(Math.PI * x / L) * Math.sin(Math.PI * y / L);
            case 'harmonics': {
                const v1 = Math.sin(2 * Math.PI * x / L) * Math.sin(2 * Math.PI * y / L);
                const v2 = 0.5 * Math.sin(4 * Math.PI * x / L) * Math.sin(4 * Math.PI * y / L);
                return Math.max(0, 0.5 * (v1 - v2) + 0.5);
            }
            case 'gaussian':
                return Math.exp(-60 * ((x - L / 2) ** 2 + (y - L / 2) ** 2));
            case 'step':
                return (x > L * 0.25 && x < L * 0.75 && y > L * 0.25 && y < L * 0.75)
                    ? 1.0 : 0.0;
            case 'triangle': {
                const tx = x < L / 2 ? 2 * x / L : 2 * (L - x) / L;
                const ty = y < L / 2 ? 2 * y / L : 2 * (L - y) / L;
                return tx * ty;
            }
            default:
                return Math.sin(Math.PI * x / L) * Math.sin(Math.PI * y / L);
        }
    }

    /* ================================================================
       BOUNDARY CONDITIONS
       ================================================================ */

    _applyBC(arr) {
        if (this.dimension === '1d') {
            this._applyBC1D(arr);
        } else {
            this._applyBC2D(arr);
        }
    }

    _applyBC1D(a) {
        const n = this.nx;
        const p = this.bcParams;

        switch (this.bcType) {
            case 'dirichlet':
                a[0] = p.left;
                a[n] = p.right;
                break;

            case 'neumann':
                // du/dx(0) = p.left,  du/dx(L) = p.right
                a[0] = a[1] - this.dx * p.left;
                a[n] = a[n - 1] + this.dx * p.right;
                break;

            case 'robin': {
                // Newton cooling: -k du/dn = h(u - u_amb)
                const h = p.h;
                const ua = p.uAmbient;
                const k = this.beta;
                const denom = h + k / this.dx;
                a[0] = (k * a[1] / this.dx + h * ua) / denom;
                a[n] = (k * a[n - 1] / this.dx + h * ua) / denom;
                break;
            }
        }
    }

    _applyBC2D(a) {
        const nx = this.nx, ny = this.ny;
        const p = this.bcParams;

        switch (this.bcType) {
            case 'dirichlet':
                for (let i = 0; i <= nx; i++) {
                    a[this.idx(i, 0)]  = p.bottom;
                    a[this.idx(i, ny)] = p.top;
                }
                for (let j = 0; j <= ny; j++) {
                    a[this.idx(0, j)]  = p.left;
                    a[this.idx(nx, j)] = p.right;
                }
                break;

            case 'neumann': {
                const fluxB = isNaN(p.bottom) ? 0 : (p.bottom ?? 0);
                const fluxT = isNaN(p.top) ? 0 : (p.top ?? 0);
                const fluxL = isNaN(p.left) ? 0 : (p.left ?? 0);
                const fluxR = isNaN(p.right) ? 0 : (p.right ?? 0);

                for (let i = 1; i < nx; i++) {
                    a[this.idx(i, 0)]  = a[this.idx(i, 1)] - this.dy * fluxB;
                    a[this.idx(i, ny)] = a[this.idx(i, ny - 1)] + this.dy * fluxT;
                }
                for (let j = 1; j < ny; j++) {
                    a[this.idx(0, j)]  = a[this.idx(1, j)] - this.dx * fluxL;
                    a[this.idx(nx, j)] = a[this.idx(nx - 1, j)] + this.dx * fluxR;
                }
                // Corners
                a[this.idx(0, 0)]   = 0.5 * (a[this.idx(1, 0)] - this.dx * fluxL + a[this.idx(0, 1)] - this.dy * fluxB);
                a[this.idx(nx, 0)]  = 0.5 * (a[this.idx(nx - 1, 0)] + this.dx * fluxR + a[this.idx(nx, 1)] - this.dy * fluxB);
                a[this.idx(0, ny)]  = 0.5 * (a[this.idx(1, ny)] - this.dx * fluxL + a[this.idx(0, ny - 1)] + this.dy * fluxT);
                a[this.idx(nx, ny)] = 0.5 * (a[this.idx(nx - 1, ny)] + this.dx * fluxR + a[this.idx(nx, ny - 1)] + this.dy * fluxT);
                break;
            }

            case 'robin': {
                const h = p.h;
                const ua = p.uAmbient;
                const k = this.beta;
                const cx = 1 / (h + k / this.dx);
                const cy = 1 / (h + k / this.dy);

                for (let i = 1; i < nx; i++) {
                    a[this.idx(i, 0)]  = (k * a[this.idx(i, 1)] / this.dy + h * ua) * cy;
                    a[this.idx(i, ny)] = (k * a[this.idx(i, ny - 1)] / this.dy + h * ua) * cy;
                }
                for (let j = 0; j <= ny; j++) {
                    a[this.idx(0, j)]  = (k * a[this.idx(1, j)] / this.dx + h * ua) * cx;
                    a[this.idx(nx, j)] = (k * a[this.idx(nx - 1, j)] / this.dx + h * ua) * cx;
                }
                break;
            }
        }
    }

    /* ================================================================
       FORCING (SOURCE TERM)
       ================================================================ */

    _forcing(x, y) {
        const L = this.L;
        switch (this.forcingType) {
            case 'none': return 0;
            case 'center':
                if (this.dimension === '1d') {
                    return 5.0 * Math.exp(-200 * (x - L / 2) ** 2);
                }
                return 5.0 * Math.exp(-200 * ((x - L / 2) ** 2 + (y - L / 2) ** 2));
            case 'uniform':
                return 0.5;
            default: return 0;
        }
    }

    /* ================================================================
       TIME STEPPING
       ================================================================ */

    step(numSteps = 1) {
        if (this.steady) return;

        let maxDelta = 0;

        for (let s = 0; s < numSteps; s++) {
            let localMax = 0;

            if (this.dimension === '1d') {
                localMax = this._step1D();
            } else {
                localMax = this._step2D();
            }

            this.time += this.dt;
            this.stepCount++;
            if (localMax > maxDelta) maxDelta = localMax;
        }

        this.maxChange = maxDelta;
        this._updateRange();

        const rateOfChange = this.maxChange / this.dt;
        if (rateOfChange < 2e-4 && this.stepCount > 60) {
            this.steady = true;
        }
    }

    _step1D() {
        const n = this.nx;
        const r = this.beta * this.dt / (this.dx * this.dx);
        let maxD = 0;

        for (let i = 1; i < n; i++) {
            const lap = this.u[i + 1] - 2 * this.u[i] + this.u[i - 1];
            const f = this._forcing(i * this.dx, 0);
            const delta = r * lap + this.dt * f;
            this.uTmp[i] = this.u[i] + delta;
            const ad = Math.abs(delta);
            if (ad > maxD) maxD = ad;
        }

        for (let i = 1; i < n; i++) this.u[i] = this.uTmp[i];
        this._applyBC(this.u);
        return maxD;
    }

    _step2D() {
        const nx = this.nx, ny = this.ny;
        const rx = this.beta * this.dt / (this.dx * this.dx);
        const ry = this.beta * this.dt / (this.dy * this.dy);
        let maxD = 0;

        for (let j = 1; j < ny; j++) {
            for (let i = 1; i < nx; i++) {
                const c  = this.idx(i, j);
                const lapX = this.u[this.idx(i + 1, j)] - 2 * this.u[c] + this.u[this.idx(i - 1, j)];
                const lapY = this.u[this.idx(i, j + 1)] - 2 * this.u[c] + this.u[this.idx(i, j - 1)];
                const f = this._forcing(i * this.dx, j * this.dy);
                const delta = rx * lapX + ry * lapY + this.dt * f;
                this.uTmp[c] = this.u[c] + delta;
                const ad = Math.abs(delta);
                if (ad > maxD) maxD = ad;
            }
        }

        for (let j = 1; j < ny; j++) {
            for (let i = 1; i < nx; i++) {
                const c = this.idx(i, j);
                this.u[c] = this.uTmp[c];
            }
        }
        this._applyBC(this.u);
        return maxD;
    }

    /* ================================================================
       GRADIENT  (for heat-flow arrows)
       ================================================================ */

    getGradient1D() {
        const n = this.nx;
        const g = new Float64Array(n + 1);
        g[0] = (this.u[1] - this.u[0]) / this.dx;
        for (let i = 1; i < n; i++) {
            g[i] = (this.u[i + 1] - this.u[i - 1]) / (2 * this.dx);
        }
        g[n] = (this.u[n] - this.u[n - 1]) / this.dx;
        return g;
    }

    getGradient2D() {
        const nx = this.nx, ny = this.ny;
        const size = (nx + 1) * (ny + 1);
        const gx = new Float64Array(size);
        const gy = new Float64Array(size);

        for (let j = 0; j <= ny; j++) {
            for (let i = 0; i <= nx; i++) {
                const c = this.idx(i, j);
                // ∂u/∂x
                if (i === 0) gx[c] = (this.u[this.idx(1, j)] - this.u[c]) / this.dx;
                else if (i === nx) gx[c] = (this.u[c] - this.u[this.idx(nx - 1, j)]) / this.dx;
                else gx[c] = (this.u[this.idx(i + 1, j)] - this.u[this.idx(i - 1, j)]) / (2 * this.dx);
                // ∂u/∂y
                if (j === 0) gy[c] = (this.u[this.idx(i, 1)] - this.u[c]) / this.dy;
                else if (j === ny) gy[c] = (this.u[c] - this.u[this.idx(i, ny - 1)]) / this.dy;
                else gy[c] = (this.u[this.idx(i, j + 1)] - this.u[this.idx(i, j - 1)]) / (2 * this.dy);
            }
        }
        return { gx, gy };
    }

    /* ---- 1D profile at arbitrary cross-section (for 2D graphs) ---- */

    getProfile(crossY) {
        if (this.dimension === '1d') {
            return Array.from(this.u);
        }
        const j = Math.round(crossY * this.ny);
        const profile = new Array(this.nx + 1);
        for (let i = 0; i <= this.nx; i++) {
            profile[i] = this.u[this.idx(i, j)];
        }
        return profile;
    }

    /* ---- helpers ---- */

    _updateRange() {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < this.u.length; i++) {
            if (this.u[i] < mn) mn = this.u[i];
            if (this.u[i] > mx) mx = this.u[i];
        }
        this.uMin = mn;
        this.uMax = mx;
    }

    reset() {
        this.time = 0;
        this.stepCount = 0;
        this.steady = false;
        this.maxChange = Infinity;
        this._init();
    }
}
