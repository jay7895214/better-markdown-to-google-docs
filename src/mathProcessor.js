/**
 * Math (LaTeX) Processing for Markdown
 *
 * Handles extraction, rendering, and image conversion of LaTeX math expressions.
 * - $...$   → inline math
 * - $$...$$ → block (display) math
 *
 * Uses KaTeX for rendering and html-to-image for PNG conversion (clipboard).
 */

import { toPng } from 'html-to-image';

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

/**
 * Wait for KaTeX web fonts to be fully loaded.
 * KaTeX uses custom fonts (KaTeX_Main, KaTeX_Math, etc.) loaded via CSS @font-face.
 * These must be available before capturing to PNG.
 */
async function waitForKatexFonts() {
    await document.fonts.ready;

    // Additionally load specific KaTeX font families used in math rendering
    const katexFontFamilies = [
        'KaTeX_Main',
        'KaTeX_Math',
        'KaTeX_Size1',
        'KaTeX_Size2',
    ];

    const fontPromises = katexFontFamilies.map(family => {
        return document.fonts.load(`16px "${family}"`).catch(() => {
            // Font may not be needed for this expression
        });
    });

    await Promise.all(fontPromises);
}

/**
 * Convert a single KaTeX-rendered element to a PNG data URI.
 * Uses triple-call technique: calls progressively cache fonts and stabilize rendering.
 *
 * @param {HTMLElement} element - DOM element containing KaTeX output
 * @param {number} scale - Pixel density scale (default 3x for clarity in Google Docs)
 * @returns {Promise<string>} PNG data URI
 */
async function elementToPng(element, scale = 3) {
    const options = {
        pixelRatio: scale,
        backgroundColor: '#ffffff',
        style: {
            margin: '0',
            padding: '4px 16px',
            overflow: 'visible',
        },
    };

    // Triple-call technique: each call progressively loads/caches fonts
    for (let i = 0; i < 2; i++) {
        try {
            await toPng(element, options);
        } catch {
            // Early calls may fail — expected
        }
    }

    // Final call captures with fonts fully embedded
    return await toPng(element, options);
}

/**
 * Replace math placeholders with PNG <img> tags (for clipboard/Google Docs).
 * Creates temporary DOM elements, renders with KaTeX, captures as images.
 *
 * @param {string} html - Rendered HTML from marked (with KaTeX placeholders or KaTeX HTML)
 * @param {Array} expressions - Math expressions from extractMath()
 * @param {object} katex - KaTeX library instance
 * @returns {Promise<string>} HTML with math rendered as <img> tags
 */
export async function replaceMathWithImages(html, expressions, katex) {
    if (!katex || expressions.length === 0) return html;

    // Ensure KaTeX fonts are loaded before any conversion
    await waitForKatexFonts();

    let result = html;

    for (const expr of expressions) {
        try {
            // Create a temporary offscreen container with generous sizing
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;z-index:-1;';
            container.style.fontSize = '16px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.lineHeight = '1.5';

            // Render with KaTeX
            const katexHtml = katex.renderToString(expr.latex, {
                displayMode: expr.displayMode,
                throwOnError: false,
                output: 'html',
            });

            const inner = document.createElement('div');
            inner.innerHTML = katexHtml;
            inner.style.display = 'inline-block';
            inner.style.padding = '4px 16px';
            inner.style.overflow = 'visible';
            inner.style.whiteSpace = 'nowrap';
            if (expr.displayMode) {
                inner.style.fontSize = '1.21em';
            }
            container.appendChild(inner);
            document.body.appendChild(container);

            // Give the browser a frame to layout and load fonts
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await document.fonts.ready;

            // Convert to PNG
            const dataUri = await elementToPng(inner);

            // Measure the rendered size for proper img dimensions
            const rect = inner.getBoundingClientRect();

            document.body.removeChild(container);

            // Build <img> tag with natural dimensions to avoid distortion
            const imgStyle = expr.displayMode
                ? `display:block;margin:12pt auto;`
                : `display:inline;vertical-align:middle;height:${Math.ceil(rect.height)}px;`;
            const imgTag = `<img src="${dataUri}" alt="${expr.latex.replace(/"/g, '&quot;')}" style="${imgStyle}" />`;

            // Find and replace the KaTeX HTML wrapper or placeholder
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
