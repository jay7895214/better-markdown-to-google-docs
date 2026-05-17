/**
 * Math (LaTeX) Processing for Markdown
 *
 * Handles extraction, rendering, and image conversion of LaTeX math expressions.
 * - $...$   → inline math
 * - $$...$$ → block (display) math
 *
 * Uses KaTeX for rendering. For clipboard copy (Google Docs), renders KaTeX to
 * a hidden DOM element, then captures via canvas with SVG foreignObject approach.
 * This avoids html-to-image's CORS issues with CDN stylesheets.
 */

// Unique prefix to avoid collisions with user content
const MATH_PLACEHOLDER_PREFIX = '\u0000MATH_';
const MATH_PLACEHOLDER_SUFFIX = '\u0000';

/**
 * Extract math expressions from Markdown text.
 * Replaces $...$ and $$...$$ with unique placeholders so marked won't touch them.
 *
 * Must handle:
 * - $$...$$ (block) before $...$ (inline) to avoid partial matches
 * - Escaped \$ should not be treated as delimiters
 * - $ inside code spans/blocks should be ignored (handled by processing order)
 *
 * @param {string} text - Raw Markdown text
 * @returns {{ processedText: string, expressions: Array<{id: string, latex: string, displayMode: boolean}> }}
 */
export function extractMath(text) {
    const expressions = [];
    let counter = 0;
    let result = text;

    // Step 1: Protect code blocks and inline code from math extraction
    const codeBlocks = [];
    // Protect fenced code blocks (```...```)
    result = result.replace(/(```[\s\S]*?```)/g, (match) => {
        const id = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
        codeBlocks.push(match);
        return id;
    });
    // Protect inline code (`...`)
    result = result.replace(/(`[^`]+`)/g, (match) => {
        const id = `\u0000CODE_BLOCK_${codeBlocks.length}\u0000`;
        codeBlocks.push(match);
        return id;
    });

    // Step 2: Extract $$...$$ (block math) — must come before $...$
    result = result.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
        const id = `${MATH_PLACEHOLDER_PREFIX}${counter}${MATH_PLACEHOLDER_SUFFIX}`;
        expressions.push({ id, latex: latex.trim(), displayMode: true });
        counter++;
        return id;
    });

    // Step 3: Extract $...$ (inline math)
    // Avoid matching:
    // - Escaped \$
    // - Empty $$ (already handled above)
    // - Currency-like patterns: $100, $ 50
    result = result.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (match, latex) => {
        const id = `${MATH_PLACEHOLDER_PREFIX}${counter}${MATH_PLACEHOLDER_SUFFIX}`;
        expressions.push({ id, latex: latex.trim(), displayMode: false });
        counter++;
        return id;
    });

    // Step 4: Restore code blocks
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
        result = result.replace(`\u0000CODE_BLOCK_${i}\u0000`, codeBlocks[i]);
    }

    return { processedText: result, expressions };
}

/**
 * Replace math placeholders with KaTeX-rendered HTML (for preview).
 *
 * @param {string} html - Rendered HTML from marked
 * @param {Array} expressions - Math expressions from extractMath()
 * @param {object} katex - KaTeX library instance (window.katex)
 * @returns {string} HTML with rendered math
 */
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
        } catch (e) {
            // Fallback: show raw LaTeX in a code-like style
            const fallback = expr.displayMode
                ? `<div style="text-align:center;margin:12pt 0;color:#c00;font-family:monospace;">${expr.latex}</div>`
                : `<code style="color:#c00;">${expr.latex}</code>`;
            result = result.replace(expr.id, fallback);
        }
    }
    return result;
}

// ─── Image conversion (for clipboard / Google Docs) ───────────────────────

/**
 * Cached KaTeX CSS text fetched from the CDN. Fetched once and reused.
 * @type {string|null}
 */
let _katexCssCache = null;

/**
 * Fetch the KaTeX CSS and inline all font references as base64 data URIs.
 * This makes the SVG foreignObject fully self-contained (no cross-origin resources),
 * preventing the canvas from being tainted.
 */
async function getKatexCss() {
    if (_katexCssCache) return _katexCssCache;

    try {
        const res = await fetch('https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css');
        let css = await res.text();

        // Find all font URLs and convert to base64 data URIs
        const fontUrlRegex = /url\(fonts\/([^)]+)\)/g;
        const fontUrls = new Set();
        let match;
        while ((match = fontUrlRegex.exec(css)) !== null) {
            fontUrls.add(match[1]);
        }

        // Fetch each unique font file and convert to base64
        const fontMap = new Map();
        await Promise.all(
            [...fontUrls].map(async (fontPath) => {
                try {
                    const fontRes = await fetch(
                        `https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/${fontPath}`
                    );
                    const buffer = await fontRes.arrayBuffer();
                    const base64 = btoa(
                        String.fromCharCode(...new Uint8Array(buffer))
                    );
                    const ext = fontPath.split('.').pop().split('?')[0];
                    const mime = ext === 'woff2' ? 'font/woff2' : 'font/woff';
                    fontMap.set(fontPath, `data:${mime};base64,${base64}`);
                } catch {
                    // If a font fails to load, skip it (fallback fonts will be used)
                }
            })
        );

        // Replace all font URLs with their base64 data URIs
        for (const [fontPath, dataUri] of fontMap) {
            css = css.replaceAll(`url(fonts/${fontPath})`, `url(${dataUri})`);
        }

        _katexCssCache = css;
        return css;
    } catch (e) {
        console.warn('Failed to fetch KaTeX CSS for image conversion:', e);
        return '';
    }
}

/**
 * Convert a single KaTeX expression to a PNG data URI.
 *
 * Approach: render KaTeX HTML into an offscreen DOM element, measure it,
 * then use SVG foreignObject + canvas to rasterize — no html-to-image needed.
 *
 * @param {string} latex - LaTeX expression
 * @param {boolean} displayMode - true for block math
 * @param {object} katex - KaTeX library instance
 * @param {string} katexCss - Inlined KaTeX CSS text
 * @returns {Promise<{dataUri: string, width: number, height: number}>}
 */
async function latexToPng(latex, displayMode, katex, katexCss) {
    const scale = 3; // 3x for high-DPI clarity

    // 1. Render KaTeX to HTML string
    const katexHtml = katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        output: 'html',
    });

    // 2. Create a temporary hidden container to measure rendered size
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;z-index:-1;visibility:hidden;';
    container.style.fontSize = '16px';
    container.style.fontFamily = 'Arial, sans-serif';

    const inner = document.createElement('div');
    inner.innerHTML = katexHtml;
    inner.style.display = 'inline-block';
    inner.style.padding = '4px 8px';
    inner.style.whiteSpace = 'nowrap';
    if (displayMode) inner.style.fontSize = '1.21em';
    container.appendChild(inner);
    document.body.appendChild(container);

    // Wait for fonts and layout
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const rect = inner.getBoundingClientRect();
    const width = Math.ceil(rect.width) + 16;  // extra padding
    const height = Math.ceil(rect.height) + 8;

    document.body.removeChild(container);

    // 3. Build an SVG with foreignObject containing the KaTeX HTML + inlined CSS
    const svgHtml = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <foreignObject width="100%" height="100%">
                <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:16px;font-family:Arial,sans-serif;">
                    <style>${katexCss}</style>
                    <div style="display:inline-block;padding:4px 8px;white-space:nowrap;${displayMode ? 'font-size:1.21em;' : ''}">${katexHtml}</div>
                </div>
            </foreignObject>
        </svg>`;

    // 4. Render SVG to canvas
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const dataUri = await new Promise((resolve, reject) => {
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
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(new Error('SVG to canvas failed'));
        };
        img.src = url;
    });

    return { dataUri, width, height };
}

/**
 * Replace math placeholders with PNG <img> tags (for clipboard/Google Docs).
 *
 * @param {string} html - Rendered HTML from marked (with KaTeX HTML)
 * @param {Array} expressions - Math expressions from extractMath()
 * @param {object} katex - KaTeX library instance
 * @returns {Promise<string>} HTML with math rendered as <img> tags
 */
export async function replaceMathWithImages(html, expressions, katex) {
    if (!katex || expressions.length === 0) return html;

    // Pre-fetch KaTeX CSS once (cached for subsequent calls)
    const katexCss = await getKatexCss();

    let result = html;

    for (const expr of expressions) {
        try {
            const { dataUri, height } = await latexToPng(
                expr.latex, expr.displayMode, katex, katexCss
            );

            // Build <img> tag
            const imgStyle = expr.displayMode
                ? 'display:block;margin:12pt auto;'
                : `display:inline;vertical-align:middle;height:${height}px;`;
            const imgTag = `<img src="${dataUri}" alt="${expr.latex.replace(/"/g, '&quot;')}" style="${imgStyle}" />`;

            // Find and replace the KaTeX HTML wrapper
            const katexHtml = katex.renderToString(expr.latex, {
                displayMode: expr.displayMode,
                throwOnError: false,
                output: 'html',
            });

            if (expr.displayMode) {
                const blockPattern = `<div class="math-block" style="text-align:center;margin:12pt 0;overflow-x:auto;">${katexHtml}</div>`;
                if (result.includes(blockPattern)) {
                    result = result.replace(blockPattern, imgTag);
                } else {
                    result = result.replace(expr.id, imgTag);
                }
            } else {
                const inlinePattern = `<span class="math-inline">${katexHtml}</span>`;
                if (result.includes(inlinePattern)) {
                    result = result.replace(inlinePattern, imgTag);
                } else {
                    result = result.replace(expr.id, imgTag);
                }
            }
        } catch (e) {
            console.error('Math image conversion failed for:', expr.latex, e);
            const fallback = `<code>${expr.latex}</code>`;
            result = result.replace(expr.id, fallback);
        }
    }

    return result;
}
