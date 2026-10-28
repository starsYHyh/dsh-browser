// @vitest-environment jsdom
/**
 * Static-render checks for the collapsible tool-activity card: the panel has no
 * interactive test harness, so the collapsed/expanded markup contract is pinned
 * here (a completed run collapses to one line; a running run is expanded).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolGroup, ToolStepDetail } from '../src/panel/App.tsx'
import type { Row } from '../src/panel/events.ts'
import { PANEL_COPY } from '../src/panel/strings.ts'

const copy = PANEL_COPY.zh

function toolRow(status: 'running' | 'complete'): Row {
  return {
    seq: 9,
    id: 4,
    kind: 'tool',
    status,
    text: '读取页面 → 点击元素 #7',
    tools: [
      { name: 'browser_snapshot', summary: '读取页面', status, args: '{}', ...(status === 'complete' ? { output: '页面标题' } : {}) },
      { name: 'browser_click', summary: '点击元素 #7', status, args: '{"index":7}' },
    ],
  }
}

describe('ToolGroup card', () => {
  it('collapses a finished run to one summary line', () => {
    const html = renderToStaticMarkup(createElement(ToolGroup, { row: toolRow('complete'), copy }))
    expect(html).toContain('tool-activity tool-group complete')
    expect(html).toContain('2 个调用')
    expect(html).toContain('读取页面 → 点击元素 #7')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('tool-steps')
  })

  it('expands a running run and lists every call', () => {
    const html = renderToStaticMarkup(createElement(ToolGroup, { row: toolRow('running'), copy }))
    expect(html).toContain('tool-activity tool-group running')
    expect(html).toContain('正在操作页面')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('tool-steps')
    expect(html.match(/<li class="tool-step /g)).toHaveLength(2)
    // {} 没有可展开的参数：只有分组头和带参数的调用各有一个展开箭头。
    expect(html.match(/tool-chevron/g)).toHaveLength(2)
  })

  it('renders input and output as two scrollable sections', () => {
    const item = {
      name: 'bash',
      summary: '列出文件',
      status: 'complete' as const,
      args: '{"command":"ls"}',
      output: 'a.txt\nb.txt',
    }
    const html = renderToStaticMarkup(createElement(ToolStepDetail, { item, copy }))
    expect(html).toContain('输入')
    expect(html).toContain('输出')
    expect(html.match(/class="tool-step-section"/g)).toHaveLength(2)
    expect(html.match(/class="tool-step-code"/g)).toHaveLength(2)
    expect(html).toContain('a.txt')
  })

  it('marks a failed output section and shows the failure title', () => {
    const item = {
      name: 'bash',
      summary: '运行命令',
      status: 'complete' as const,
      args: '{"command":"false"}',
      output: 'command failed',
      failed: true,
    }
    const html = renderToStaticMarkup(createElement(ToolStepDetail, { item, copy }))
    expect(html).toContain('tool-step-section failed')
    expect(html).toContain('失败')
    expect(html).toContain('command failed')
  })
})
