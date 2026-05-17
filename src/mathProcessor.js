/**
 * Math (LaTeX) Processing for Markdown
 *
 * Preview: KaTeX (fast, loaded via CDN)
 * Clipboard: MathJax tex2svg (lazy-loaded, pure SVG paths → canvas → PNG)
 *
 * MathJax SVG uses <path> elements for glyphs (no web fonts, no foreignObject),
 * so canvas.toDataURL() works without SecurityError.
 */

const MATH_PLACEHOLDER_PREFIX = '\u0000MATH_';
const MATH_PLACEHOLDER_SUFFIX = '\u0000';

// ─── Extraction ──────────────────────────────────────────────────────────

export function extractMath(text) {
    const expressions = [];
    let counter = 0;
    let result = text;

    const codeBlocks = [];
    result = result.replace(/(```[\s\S]*?```)/g, (m) => {
        const id = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
        codeBlocks.push(m);
        return id;
    });
    result = result.replace(/(`[^`]+`)/g, (m) => {
        const id = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
        codeBlocks.push(m);
        return id;
    });

    result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
        const id = `${MATH_PLACEHOLDER_PREFIX}${counter}${MATH_PLACEHOLDER_SUFFIX}`;
        expressions.push({ id, latex: latex.trim(), displayMode: true });
        counter++;
        return id;
    });

    result = result.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, latex) => {
        const id = `${MATH_PLACEHOLDER_PREFIX}${counter}${MATH_PLACEHOLDER_SUFFIX}`;
        expressions.push({ id, latex: latex.trim(), displayMode: false });
        counter++;
        return id;
    });

    for (let i = codeBlocks.length - 1; i >= 0; i--) {
        result = result.replace(`\u0000CODE_BLOCK_${i}\u0000`, codeBlocks[i]);
    }

    return { processedText: result, expressions };
}

// ─── Preview (KaTeX HTML) ────────────────────────────────────────────────

export function replaceMathWithKatex(html, expressions, katex) {
    if (!katex || expressions.length === 0) return html;

    let result = html;
    for (const expr of expressions) {
        try {
            const rendered = katex.renderToString(expr.latex, {
                displayMode: expr.displayMode,
                throwOnError: false,
                output: 'html',
            });
            const wrapper = expr.displayMode
                ? `<div class="math-block" style="text-align:center;margin:12pt 0;overflow-x:auto;">${rendered}</div>`
                : `<span class="math-inline">${rendered}</span>`;
            result = result.replace(expr.id, wrapper);
        } catch {
            const fallback = expr.displayMode
                ? `<div style="text-align:center;margin:12pt 0;color:#c00;font-family:monospace;">${expr.latex}</div>`
                : `<code style="color:#c00;">${expr.latex}</code>`;
            result = result.replace(expr.id, fallback);
        }
    }
    return result;
}

// ─── Clipboard (MathJax SVG → Canvas → PNG) ──────────────────────────────

let _mathJaxPromise = null;

/**
 * Lazy-load MathJax v3 tex-svg. Only loaded on first clipboard copy with math.
 */
async function loadMathJax() {
    if (window.MathJax?.tex2svg) return window.MathJax;
    if (_mathJaxPromise) return _mathJaxPromise;

    _mathJaxPromise = new Promise((resolve, reject) => {
        window.MathJax = {
            tex: { packages: { '[+]': ['ams'] } },
            svg: { fontCache: 'none' },
            startup: {
                typeset: false,
                ready: () => {
                    window.MathJax.startup.defaultReady();
                    window.MathJax.startup.promise.then(() => resolve(window.MathJax));
                },
            },
        };

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load MathJax'));
        document.head.appendChild(script);
    });

    return _mathJaxPromise;
}

/**
 * Render a single LaTeX expression to PNG via MathJax SVG → canvas.
 */
async function latexToPng(latex, displayMode) {
    const mj = await loadMathJax();
    const scale = 3;

    // MathJax renders to self-contained SVG (path data, no external fonts)
    const container = mj.tex2svg(latex, { display: displayMode });
    const svgEl = container.querySelector('svg');
    if (!svgEl) throw new Error('MathJax produced no SVG');

    // Measure pixel dimensions by temporarily adding to DOM
    const measurer = document.createElement('div');
    measurer.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;';
    measurer.appendChild(svgEl.cloneNode(true));
    document.body.appendChild(measurer);
    const rect = measurer.querySelector('svg').getBoundingClientRect();
    const width = Math.ceil(rect.width) + 8;
    const height = Math.ceil(rect.height) + 4;
    document.body.removeChild(measurer);

    // Set explicit pixel dimensions
    svgEl.setAttribute('width', `${width}px`);
    svgEl.setAttribute('height', `${height}px`);

    // Serialize SVG → Blob URL → Image → Canvas → PNG
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve({ dataUri: canvas.toDataURL('image/png'), width, height });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('SVG to canvas failed'));
        };
        img.src = url;
    });
}

/**
 * Replace KaTeX HTML with PNG <img> tags for clipboard (Google Docs).
 */
export async function replaceMathWithImages(html, expressions, katex) {
    if (!katex || expressions.length === 0) return html;

    let result = html;

    for (const expr of expressions) {
        try {
            const { dataUri, width, height } = await latexToPng(expr.latex, expr.displayMode);

            const imgStyle = expr.displayMode
                ? 'display:block;margin:12pt auto;'
                : `display:inline;vertical-align:middle;height:${height}px;`;
            const imgTag = `<img src="${dataUri}" width="${width}" height="${height}" alt="${expr.latex.replace(/"/g, '&quot;')}" style="${imgStyle}" />`;

            // Replace the KaTeX HTML wrapper
            const katexHtml = katex.renderToString(expr.latex, {
                displayMode: expr.displayMode,
                throwOnError: false,
                output: 'html',
            });

            if (expr.displayMode) {
                const pattern = `<div class="math-block" style="text-align:center;margin:12pt 0;overflow-x:auto;">${katexHtml}</div>`;
                result = result.includes(pattern)
                    ? result.replace(pattern, imgTag)
                    : result.replace(expr.id, imgTag);
            } else {
                const pattern = `<span class="math-inline">${katexHtml}</span>`;
                result = result.includes(pattern)
                    ? result.replace(pattern, imgTag)
                    : result.replace(expr.id, imgTag);
            }
        } catch (e) {
            console.error('Math image conversion failed:', expr.latex, e);
            result = result.replace(expr.id, `<code>${expr.latex}</code>`);
        }
    }

    return result;
}
