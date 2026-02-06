import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw, Trash2, FileText, Check, Download, Link2, Link2Off } from 'lucide-react';

const useMarked = () => {
    const [markedLib, setMarkedLib] = useState(null);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/marked@11.2.0/marked.min.js';
        script.async = true;
        script.onload = () => {
            setMarkedLib(window.marked);
        };
        document.body.appendChild(script);
        return () => {
            document.body.removeChild(script);
        };
    }, []);

    return markedLib;
};

const App = () => {
    const { t, i18n } = useTranslation();
    const marked = useMarked();
    const [markdown, setMarkdown] = useState('');
    const [htmlContent, setHtmlContent] = useState('');
    const [showToast, setShowToast] = useState(false);
    const [toastMsg, setToastMsg] = useState('');
    const [syncScroll, setSyncScroll] = useState(false);

    const previewRef = useRef(null);
    const editorRef = useRef(null);
    const previewContainerRef = useRef(null);
    const isScrollingRef = useRef(null);
    const scrollTimeoutRef = useRef(null);

    const currentLanguage = i18n.language;

    const toggleLanguage = () => {
        const newLang = currentLanguage === 'zh-TW' ? 'en' : 'zh-TW';

        // Smart content switching: if current content matches current language's example,
        // automatically switch to new language's example
        const currentExample = t('example.content');
        if (markdown === currentExample) {
            const newT = i18n.getFixedT(newLang);
            setMarkdown(newT('example.content'));
        }

        i18n.changeLanguage(newLang);
        localStorage.setItem('language', newLang);
    };

    useEffect(() => {
        setMarkdown(t('example.content'));
    }, []);

    useEffect(() => {
        if (marked && markdown) {
            marked.setOptions({
                gfm: true,
                breaks: true,
            });

            const renderer = new marked.Renderer();

            renderer.listitem = (text, task, checked) => {
                if (task) {
                    const checkbox = checked ? '☑ ' : '☐ ';
                    return `<li style="list-style-type: none; text-indent: -1.4em; margin-left: 1.4em;">${checkbox} ${text}</li>`;
                }
                return `<li>${text}</li>`;
            };

            renderer.code = (code, language) => {
                const escapedCode = code
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');

                const contentWithBreaks = escapedCode.split('\n').join('<br>');

                return `
          <br><br>
          <span style="
            display: inline-block;
            width: 95%;
            background-color: #e0e0e0;
            border: 1px solid #cccccc;
            padding: 10pt;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 10pt;
            color: #333;
            white-space: pre-wrap;
            box-sizing: border-box;
          ">${contentWithBreaks}</span>
          <br><br>
        `;
            };

            renderer.codespan = (text) => {
                return `<code style="padding: 2px 4px; border-radius: 2px; font-family: 'Consolas', 'Courier New', monospace; font-size: 0.9em;">${text}</code>`;
            };

            renderer.strong = (text) => {
                return `<strong style="font-weight: 700; color: #000;">${text}</strong>`;
            };

            renderer.em = (text) => {
                return `<em style="font-style: italic;">${text}</em>`;
            };

            renderer.table = (header, body) => {
                const colCount = (header.match(/<\/th>/g) || []).length;
                const colWidth = colCount > 0 ? (21 / colCount).toFixed(2) + 'cm' : 'auto';
                const headerWithWidth = header.replace(/<th([^>]*)style="/g, `<th$1style="width: ${colWidth}; `);

                return `
          <div align="center" style="width: 100%; text-align: center;">
            <table class="data-table" style="
                border-collapse: collapse; 
                width: 21cm;
                margin: 0 auto;
                text-align: left;
                table-layout: fixed;
            ">
              <thead>${headerWithWidth}</thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          <br><br>
        `;
            };

            renderer.tablecell = (content, flags) => {
                const type = flags.header ? 'th' : 'td';
                const tag = type;
                const align = flags.align ? flags.align : 'left';
                const whiteSpace = flags.header ? 'nowrap' : 'normal';

                const style = `
          border: 1px solid #ccc; 
          padding: 2pt 6pt;
          vertical-align: middle;
          background-color: ${flags.header ? '#f3f3f3' : 'transparent'}; 
          font-weight: ${flags.header ? '700' : '400'};
          white-space: ${whiteSpace};
        `;

                const contentWrapped = `<p style="margin: 0; text-align: ${align};">${content}</p>`;

                return `<${tag} style="${style}">${contentWrapped}</${tag}>`;
            };

            marked.use({ renderer });

            setHtmlContent(marked.parse(markdown));
        } else if (!markdown) {
            setHtmlContent(`<p class="text-gray-400 italic">${t('app.previewPlaceholder')}</p>`);
        }
    }, [markdown, marked, t]);

    const handleEditorScroll = () => {
        if (!syncScroll || isScrollingRef.current === 'preview') return;
        const editor = editorRef.current;
        const preview = previewContainerRef.current;
        if (editor && preview) {
            isScrollingRef.current = 'editor';
            const percentage = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
            preview.scrollTop = percentage * (preview.scrollHeight - preview.clientHeight);
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => { isScrollingRef.current = null; }, 50);
        }
    };

    const handlePreviewScroll = () => {
        if (!syncScroll || isScrollingRef.current === 'editor') return;
        const editor = editorRef.current;
        const preview = previewContainerRef.current;
        if (editor && preview) {
            isScrollingRef.current = 'preview';
            const percentage = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
            editor.scrollTop = percentage * (editor.scrollHeight - editor.clientHeight);
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => { isScrollingRef.current = null; }, 50);
        }
    };

    const copyRichText = () => {
        if (!previewRef.current) return;

        const range = document.createRange();
        range.selectNode(previewRef.current);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showNotification(t('app.copied'));
            } else {
                showNotification(t('app.copyFailed'));
            }
        } catch (err) {
            console.error('Copy failed', err);
            showNotification(t('app.notSupported'));
        }

        selection.removeAllRanges();
    };

    const clearContent = () => {
        if (window.confirm(t('app.confirmClear'))) setMarkdown('');
    };

    const loadExample = () => setMarkdown(t('example.content'));

    const showNotification = (msg) => {
        setToastMsg(msg);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
    };

    const downloadHtml = () => {
        const element = document.createElement("a");
        const file = new Blob([
            `<html><head><meta charset="utf-8"><title>Document</title></head><body>${htmlContent}</body></html>`
        ], { type: 'text/html' });
        element.href = URL.createObjectURL(file);
        element.download = "converted-doc.html";
        document.body.appendChild(element);
        element.click();
        showNotification(t('app.downloaded'));
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg">
                        <FileText className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">{t('app.title')}</h1>
                    </div>
                </div>

                <div className="flex gap-2 items-center">
                    <button
                        onClick={toggleLanguage}
                        className="flex items-center justify-center w-10 h-10 text-lg rounded-md transition-colors border bg-white border-gray-200 hover:bg-gray-50"
                        title={t('app.language')}
                    >
                        {currentLanguage === 'zh-TW' ? '🇹🇼' : '🇺🇸'}
                    </button>
                    <button
                        onClick={() => setSyncScroll(!syncScroll)}
                        className={`flex items-center justify-center w-10 h-10 rounded-md transition-colors border ${syncScroll
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                            }`}
                        title={t('app.syncScroll')}
                    >
                        {syncScroll ? <Link2 className="w-5 h-5" /> : <Link2Off className="w-5 h-5" />}
                    </button>
                    <div className="h-6 w-px bg-gray-300 mx-1"></div>
                    <button
                        onClick={loadExample}
                        className="flex items-center justify-center w-10 h-10 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                        title={t('app.example')}
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                    <button
                        onClick={clearContent}
                        className="flex items-center justify-center w-10 h-10 text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                        title={t('app.clear')}
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                <div className="flex-1 flex flex-col border-r border-gray-200 bg-white min-w-0">
                    <div className="h-10 px-4 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center">
                        <span>{t('app.markdownInput')}</span>
                    </div>
                    <textarea
                        ref={editorRef}
                        onScroll={handleEditorScroll}
                        className="flex-1 w-full p-6 resize-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/20 font-mono text-sm leading-relaxed text-gray-700"
                        placeholder={t('app.placeholder')}
                        value={markdown}
                        onChange={(e) => setMarkdown(e.target.value)}
                    />
                </div>

                <div className="flex-1 flex flex-col bg-white min-w-0 relative">
                    <div className="h-10 px-4 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider flex justify-between items-center">
                        <span>{t('app.preview')}</span>
                        <div className="flex gap-1">
                            <button
                                onClick={downloadHtml}
                                className="flex items-center justify-center w-8 h-8 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title={t('app.downloadHtml')}
                            >
                                <Download className="w-4 h-4" />
                            </button>
                            <button
                                onClick={copyRichText}
                                className="flex items-center justify-center w-8 h-8 text-white bg-blue-600 hover:bg-blue-700 rounded transition-all active:scale-95"
                                title={t('app.copyFormat')}
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div
                        ref={previewContainerRef}
                        onScroll={handlePreviewScroll}
                        className="flex-1 overflow-y-auto p-6 bg-white"
                    >
                        <div
                            id="preview-content"
                            ref={previewRef}
                            className="preview-content max-w-[816px] mx-auto"
                            style={{
                                fontFamily: 'Arial, Roboto, sans-serif',
                                lineHeight: '1.5',
                                color: '#000000',
                                wordWrap: 'break-word'
                            }}
                            dangerouslySetInnerHTML={{ __html: htmlContent }}
                        />
                    </div>
                </div>
            </div>

            {showToast && (
                <div className="fixed bottom-6 right-6 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-fade-in-up z-50">
                    <div className="bg-green-500 rounded-full p-1">
                        <Check className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm font-medium">{toastMsg}</span>
                </div>
            )}

            <style>{`
        .preview-content h1 { font-size: 24pt; font-weight: 400; margin-top: 18pt; margin-bottom: 6pt; color: #000; }
        .preview-content h2 { font-size: 18pt; font-weight: 400; margin-top: 16pt; margin-bottom: 6pt; color: #000; }
        .preview-content h3 { font-size: 14pt; font-weight: 700; margin-top: 14pt; margin-bottom: 4pt; color: #434343; }
        .preview-content h4 { font-size: 12pt; font-weight: 700; margin-top: 12pt; margin-bottom: 4pt; color: #666; }
        
        .preview-content p { font-size: 11pt; margin-bottom: 11pt; margin-top: 0; }
        
        .preview-content ul { list-style-type: disc; margin-top: 0; margin-bottom: 11pt; padding-left: 36pt; }
        .preview-content ol { list-style-type: decimal; margin-top: 0; margin-bottom: 11pt; padding-left: 36pt; }
        .preview-content li { font-size: 11pt; margin-bottom: 4pt; }
        
        .preview-content ul ul { list-style-type: circle; margin-bottom: 0; }
        .preview-content ol ol { list-style-type: lower-alpha; margin-bottom: 0; }

        .preview-content blockquote { 
          border-left: 3px solid #ccc; 
          margin-left: 0; 
          padding-left: 12pt; 
          font-style: italic; 
          color: #555;
          margin-bottom: 11pt;
        }
        
        .preview-content code {
          font-family: 'Consolas', 'Courier New', monospace; 
        }

        .preview-content a { color: #1155cc; text-decoration: underline; }
        .preview-content hr { border: 0; border-top: 1px solid #ccc; margin: 18pt 0; }
        
        .preview-content table.data-table { 
            border-collapse: collapse; 
            width: auto; 
            max-width: 100%;
            margin-left: auto;
            margin-right: auto;
        }
        
        .preview-content table.data-table th, 
        .preview-content table.data-table td { 
            border: 1px solid #ccc; 
            padding: 2pt 6pt;
            text-align: left;
            vertical-align: middle;
        }
        
        .preview-content table.data-table th { 
            background-color: #f3f3f3; 
            font-weight: 700; 
        }
        
        .preview-content table.data-table td p, 
        .preview-content table.data-table th p {
            margin: 0;
        }

        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.3s ease-out forwards;
        }
      `}</style>
        </div>
    );
};

export default App;
