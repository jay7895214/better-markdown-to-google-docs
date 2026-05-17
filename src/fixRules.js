/**
 * Markdown Auto-Fix Rules
 * 
 * Strategy: ADD missing characters, never REMOVE existing ones.
 * 
 * Two-stage processing:
 *   1. Pre-fix:  Modify Markdown BEFORE parsing (add spaces to help marked)
 *   2. Post-fix: Modify HTML AFTER parsing (clean up extra spaces from stage 1)
 */

// ==========================================
// Stage 1: Pre-fix rules (Markdown → Markdown)
// ==========================================
export const fixRules = [
    // --- Heading ---
    {
        name: 'heading-spacing',
        pattern: /^(#{1,6})([^\s#])/gm,
        replace: '$1 $2',
        description: 'Add space after heading marker: ##Title → ## Title',
    },
    // --- Unordered list ---
    {
        name: 'unordered-list-spacing',
        // Negative lookahead: skip lines where * is used as emphasis (another * exists later)
        pattern: /^(?!\s*\*[^*\n]*\*)(\s*[*\-+])([^\s*\-+])/gm,
        replace: '$1 $2',
        description: 'Add space after list marker: *item → * item',
    },
    // --- Ordered list ---
    {
        name: 'ordered-list-spacing',
        pattern: /^(\s*\d+\.)([^\s])/gm,
        replace: '$1 $2',
        description: 'Add space after ordered list marker: 1.item → 1. item',
    },
    // --- Blockquote ---
    {
        name: 'blockquote-spacing',
        pattern: /^(\s*>)([^\s>])/gm,
        replace: '$1 $2',
        description: 'Add space after blockquote marker: >text → > text',
    },
];

/**
 * Bold left-flanking fix (function-based).
 * Matches complete **...**  pairs, then checks if the OPENING ** needs a space before it.
 * CommonMark rule: if ** is followed by punctuation, it needs whitespace/punctuation before it.
 */
function fixBoldFlanking(text) {
    return text.replace(/\*\*([^*\n]+)\*\*/g, (match, content, offset, str) => {
        const charBefore = offset > 0 ? str[offset - 1] : '';
        const charAfter = str[offset + match.length] || '';
        const firstChar = content[0];
        const lastChar = content[content.length - 1];

        // Opening **: when followed by punctuation, needs whitespace/punctuation before it
        const needsSpaceBefore = charBefore &&
            !/\s/.test(charBefore) &&
            !/[\p{P}]/u.test(charBefore) &&
            /[\p{P}]/u.test(firstChar);

        // Closing **: when preceded by punctuation, needs whitespace/punctuation after it
        const needsSpaceAfter = charAfter &&
            !/\s/.test(charAfter) &&
            !/[\p{P}]/u.test(charAfter) &&
            /[\p{P}]/u.test(lastChar);

        return (needsSpaceBefore ? '\u200B ' : '') + match + (needsSpaceAfter ? ' \u200B' : '');
    });
}

// ==========================================
// Stage 2: Post-fix rules (HTML → HTML)
// Clean up extra spaces introduced by stage 1
// ==========================================
export const postFixRules = [
    {
        name: 'remove-bold-fix-marker-before',
        pattern: /\u200B /g,
        replace: '',
        description: 'Remove marker + space added before opening **',
    },
    {
        name: 'remove-bold-fix-marker-after',
        pattern: / \u200B/g,
        replace: '',
        description: 'Remove space + marker added after closing **',
    },
];

// ==========================================
// Footnote processing
// marked.js doesn't support footnote syntax ([^N] / [^N]: content).
// We handle it with custom pre/post processing.
// ==========================================

/**
 * Extract footnote definitions from Markdown text.
 * Matches lines like: [^1]: content  or  [^1]：content
 * Supports both half-width (:) and full-width (：) colons.
 * Handles multi-line definitions (continuation lines indented with spaces/tabs).
 *
 * @param {string} text - Raw Markdown text
 * @returns {{ cleanedText: string, footnotes: Map<string, string> }}
 */
export function extractFootnotes(text) {
    const footnotes = new Map();
    const lines = text.split('\n');
    const cleanedLines = [];
    let currentId = null;
    let currentContent = '';

    const save = () => {
        if (currentId !== null) {
            footnotes.set(currentId, currentContent.trim());
            currentId = null;
            currentContent = '';
        }
    };

    for (const line of lines) {
        const match = line.match(/^\[\^([^\]]+)\][：:]\s*(.*)/);

        if (match) {
            save();
            currentId = match[1];
            currentContent = match[2];
        } else if (currentId !== null && /^[ \t]/.test(line) && line.trim() !== '') {
            currentContent += ' ' + line.trim();
        } else {
            save();
            cleanedLines.push(line);
        }
    }
    save();

    return { cleanedText: cleanedLines.join('\n'), footnotes };
}

/**
 * Replace footnote references [^N] in Markdown text with superscript HTML.
 * Must run BEFORE marked.parse() to prevent marked from interpreting them as links.
 *
 * @param {string} text - Markdown text (after footnote definitions removed)
 * @returns {string}
 */
export function replaceFootnoteRefs(text) {
    return text.replace(
        /\[\^([^\]]+)\]/g,
        '<sup style="font-size:0.7em;color:#1155cc;">[$1]</sup>'
    );
}

/**
 * Append a formatted footnote section to rendered HTML.
 *
 * @param {string} html - Rendered HTML
 * @param {Map<string, string>} footnotes - Footnote id → content map
 * @param {function} [renderInline] - Optional function to render inline Markdown in footnote content
 * @returns {string}
 */
export function appendFootnoteSection(html, footnotes, renderInline) {
    if (footnotes.size === 0) return html;

    const sorted = [...footnotes.entries()].sort((a, b) => {
        const na = parseInt(a[0]), nb = parseInt(b[0]);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a[0].localeCompare(b[0]);
    });

    let section = '';
    for (const [id, content] of sorted) {
        const rendered = renderInline ? renderInline(content) : content;
        section += `<p style="font-size:9pt;margin-bottom:4pt;margin-top:0;color:#333;"><sup style="font-size:0.7em;">[${id}]</sup>: ${rendered}</p>`;
    }

    return html + section;
}

/**
 * Fix broken table rows.
 * When a table row contains <br> followed by a newline, the row gets split across
 * multiple lines, breaking Markdown table parsing.
 * This function detects broken rows and merges them back into single lines.
 * 
 * A table row is "broken" when it starts with | but doesn't end with |.
 * We keep merging subsequent lines until the row ends with |.
 */
function fixBrokenTables(text) {
    const lines = text.split('\n');
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            // Complete table row — push as-is
            result.push(lines[i]);
        } else if (trimmed.startsWith('|') && !trimmed.endsWith('|')) {
            // Broken table row — start merging
            let merged = trimmed;
            let j = i + 1;
            while (j < lines.length) {
                const nextTrimmed = lines[j].trim();
                if (nextTrimmed === '') {
                    // Skip empty lines within a broken row
                    j++;
                    continue;
                }
                merged += nextTrimmed;
                j++;
                if (merged.endsWith('|')) {
                    // Row is now complete
                    break;
                }
            }
            result.push(merged);
            i = j - 1; // Skip the lines we merged (loop will i++)
        } else {
            result.push(lines[i]);
        }
    }

    return result.join('\n');
}

/**
 * Stage 1: Apply pre-fix rules + bold fix + table fix to Markdown text.
 */
export function applyFixRules(text) {
    let result = text;
    for (const rule of fixRules) {
        result = result.replace(rule.pattern, rule.replace);
    }
    result = fixBoldFlanking(result);
    result = fixBrokenTables(result);
    return result;
}

/**
 * Stage 2: Apply post-fix rules to rendered HTML.
 */
export function applyPostFixRules(html) {
    let result = html;
    for (const rule of postFixRules) {
        result = result.replace(rule.pattern, rule.replace);
    }
    return result;
}
