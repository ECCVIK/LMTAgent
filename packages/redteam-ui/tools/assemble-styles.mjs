/**
 * 模块化样式组装器（零外部依赖，仅用 node:fs / node:path / node:url）。
 *
 * 将 packages/redteam-ui/src/styles/00-tokens.css .. 06-animations.css 按文件名升序拼接，
 * 校验不含模板字面量冲突字符（反引号与 ${），生成 packages/redteam-ui/lib/styles.js。
 *
 * 用法：
 *   node packages/redteam-ui/tools/assemble-styles.mjs
 *   node packages/redteam-ui/tools/assemble-styles.mjs --check
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const stylesDir = join(pkgRoot, 'src', 'styles')
const outFile = join(pkgRoot, 'lib', 'styles.js')
const CHECK = process.argv.includes('--check')

const EXPECTED_FILES = [
  '00-tokens.css',
  '01-shell.css',
  '02-wizard.css',
  '03-canvas.css',
  '04-inspector-swimlane.css',
  '05-tabs.css',
  '06-animations.css',
]

if (!existsSync(stylesDir)) {
  console.error('✗ 找不到模块化样式目录：' + stylesDir)
  process.exit(1)
}

const cssFiles = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .sort()

for (const req of EXPECTED_FILES) {
  if (!cssFiles.includes(req)) {
    console.error('✗ 缺少必需的模块化样式文件：src/styles/' + req)
    process.exit(1)
  }
}

const chunks = []
for (const file of cssFiles) {
  const fullPath = join(stylesDir, file)
  const content = readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').trim()
  if (content.includes('`') || content.includes('${')) {
    console.error(`✗ src/styles/${file} 含有反引号或 \${ —— 内联进客户端模板串会截断，请改用单/双引号`)
    process.exit(1)
  }
  chunks.push(content)
}

const combinedCss = chunks.join('\n\n')
if (combinedCss.includes('`') || combinedCss.includes('${')) {
  console.error('✗ 合并后的 CSS 含有反引号或 ${')
  process.exit(1)
}

const header = [
  '/**',
  ' * LMTAgent 工作台样式表（由 tools/assemble-styles.mjs 从 src/styles/*.css 自动组装生成）。',
  ' * 请修改 packages/redteam-ui/src/styles/*.css 后运行：',
  ' *   node packages/redteam-ui/tools/assemble-styles.mjs',
  ' */',
  'export const CSS = String.raw`',
].join('\n')

const generated = `${header}\n${combinedCss}\n\`\n`

if (CHECK) {
  let current
  try {
    current = readFileSync(outFile, 'utf8')
  } catch {
    current = undefined
  }
  if (current !== generated) {
    console.error('✗ packages/redteam-ui/lib/styles.js 与 src/styles/*.css 不同步（请运行 node packages/redteam-ui/tools/assemble-styles.mjs）')
    process.exit(1)
  }
  console.log(`✓ styles.js 与 src/styles/*.css 同步（共 ${cssFiles.length} 个模块化样式文件）`)
  process.exit(0)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, generated, 'utf8')
console.log(`✓ styles.js 已生成（合并 ${cssFiles.length} 个模块化样式文件：${cssFiles.join(', ')}）`)
