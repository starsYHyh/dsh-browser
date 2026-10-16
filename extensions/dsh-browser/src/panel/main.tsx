import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
import { getUiLocale } from '../i18n.ts'
import { warmUpHighlighter } from './highlight.ts'
import { PANEL_COPY } from './strings.ts'

const locale = getUiLocale()
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
document.title = PANEL_COPY[locale].documentTitle

const root = document.getElementById('root')
if (root === null) throw new Error('panel root missing')
createRoot(root).render(<App />)

// Compile the syntax-highlighting grammars once the panel is idle, so the first
// fenced code block renders without paying for it on the critical path.
const idle = window.requestIdleCallback?.bind(window)
if (idle !== undefined) idle(() => { warmUpHighlighter() }, { timeout: 3000 })
else window.setTimeout(() => { warmUpHighlighter() }, 1200)
