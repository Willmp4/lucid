import { expect, test } from 'claude-code/testing'
import { PLAIN, THEME, applySgr, color256, escapeXml, parseAnsi, renderSvg, trimRows } from './screenshot-svg'

const ESC = '\x1b'

test('applySgr sets and resets bold, dim, italic, underline, and inverse', () => {
  const styled = applySgr(PLAIN, '1;2;3;4;7')
  expect(styled).toEqual({ ...PLAIN, bold: true, dim: true, italic: true, underline: true, inverse: true })
  expect(applySgr(styled, '22;23;24;27')).toEqual(PLAIN)
  expect(applySgr(styled, '0')).toEqual(PLAIN)
  expect(applySgr(styled, '')).toEqual(PLAIN)
})

test('applySgr reads 16-colour, 256-colour, and 24-bit colours', () => {
  expect(applySgr(PLAIN, '31').fg).toBe('#f38ba8')
  expect(applySgr(PLAIN, '44').bg).toBe('#89b4fa')
  expect(applySgr(PLAIN, '90').fg).toBe('#585b70')
  expect(applySgr(PLAIN, '38;5;196').fg).toBe('#ff0000')
  expect(applySgr(PLAIN, '48;5;232').bg).toBe('#080808')
  expect(applySgr(PLAIN, '38;2;215;119;87').fg).toBe('#d77757')
  expect(applySgr(PLAIN, '48;2;0;0;0;1').bg).toBe('#000000')
  expect(applySgr(PLAIN, '48;2;0;0;0;1').bold).toBe(true)
  expect(applySgr(PLAIN, '38:2::1:2:3').fg).toBe('#010203')
  expect(applySgr(applySgr(PLAIN, '31;41'), '39;49')).toEqual(PLAIN)
})

test('color256 covers the standard colours, the cube, and the greys', () => {
  expect(color256(1)).toBe('#f38ba8')
  expect(color256(16)).toBe('#000000')
  expect(color256(231)).toBe('#ffffff')
  expect(color256(255)).toBe('#eeeeee')
})

test('parseAnsi places characters on the grid and skips other escapes', () => {
  const rows = parseAnsi(`${ESC}[1mab${ESC}[0m${ESC}]0;title\x07c\r\n${ESC}[2Cd中e`)
  expect(rows[0]?.map(cell => cell?.text)).toEqual(['a', 'b', 'c'])
  expect(rows[0]?.[0]?.style.bold).toBe(true)
  expect(rows[0]?.[2]?.style.bold).toBe(false)
  expect(rows[1]?.[2]?.text).toBe('d')
  expect(rows[1]?.[3]?.width).toBe(2)
  expect(rows[1]?.[5]?.text).toBe('e')
})

test('trimRows drops blank rows at the end only', () => {
  const rows = trimRows(parseAnsi('\r\nx\r\n   \r\n\r\n'))
  expect(rows.length).toBe(2)
})

test('escapeXml escapes markup and drops characters XML cannot hold', () => {
  expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;')
  expect(escapeXml('a\x00b\x1fc')).toBe('abc')
})

test('renderSvg escapes text, colours runs, and gives each character its column', () => {
  const svg = renderSvg(parseAnsi(`${ESC}[38;2;255;0;0m<x>${ESC}[0m & y`), { title: 'a & b' })
  expect(svg).toContain('<title>a &amp; b</title>')
  expect(svg).toContain('<tspan fill="#ff0000">&lt;x&gt;</tspan> &amp; y')
  expect(svg).toContain('<text x="14 20 26 32 38 44 50"')
  expect(svg).toContain(`fill="${THEME.bg}"`)
})

test('renderSvg draws backgrounds as rectangles behind the text', () => {
  const svg = renderSvg(parseAnsi(`${ESC}[48;2;1;2;3m  ${ESC}[0mz`))
  expect(svg).toContain('<rect x="14" y="32" width="12" height="12" fill="#010203"/>')
  expect(svg).toContain('<text x="26"')
})

test('renderSvg draws box-drawing lines as merged strokes and blocks as rectangles', () => {
  const svg = renderSvg(parseAnsi('╭──╮\r\n│ab│\r\n╰──╯\r\n█'))
  expect(svg).toContain('M20 38H32')
  expect(svg).toContain('M17 41V59')
  expect(svg).toContain('M17 41A3 3 0 0 1 20 38')
  expect(svg).toContain('M35 41A3 3 0 0 0 32 38')
  expect(svg).toContain('<rect x="14" y="68" width="6" height="12" fill="#cdd6f4"/>')
  expect(svg).toContain('<text x="20 26" y="53.4" xml:space="preserve">ab</text>')
  expect(svg).not.toContain('│')
})
