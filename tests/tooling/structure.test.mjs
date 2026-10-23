import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const FILES = [
  'src/api/knowledge/client.ts',
  'src/api/knowledge/types.ts',
  'src/views/knowledge/KnowledgeView.vue',
  'src/views/knowledge/DocumentEditor.vue',
  'src/views/knowledge/LexiconEditor.vue',
  'src/views/knowledge/SearchTrial.vue',
  'src/api/http/client.ts',
  'src/api/backend/runtime.ts',
  'src/api/backend/field.ts',
  'src/api/backend/media.ts',
  'src/stores/inspection/attachments.ts',
  'src/stores/inspection/issues.ts',
  'src/stores/inspection/plans.ts',
  'src/stores/inspection/taskWriteGuards.ts',
  'src/stores/inspection/tasks.ts',
  'src/stores/inspection/workOrders.ts',
  'src/stores/inspection/remote/issues.ts',
  'src/stores/inspection/remote/tasks.ts',
  'src/stores/maintenance/plans.ts',
  'src/stores/maintenance/tasks.ts',
  'src/views/operations/ReportsView.vue',
  'src/views/operations/EventReportView.vue',
  'src/components/inspection/issue/WorkOrderPanel.vue',
  'src/api/backend/assistant.ts',
  'src/api/backend/mediaSession.ts',
  'src/assistant/remote/answer.ts',
  'src/assistant/remote/citations.ts',
  'src/assistant/remote/session.ts',
  'src/assistant/guide/reread.ts',
  'src/assistant/session.ts',
  'src/media/sessionRemote.ts',
  'src/stores/media.ts',
  'src/components/assistant/AskAnswer.vue',
  'src/components/assistant/presentation/AnswerSources.vue',
  'src/components/media/MediaSourcePanel.vue',
  'src/components/media/MediaComparePanel.vue',
]

function sourceOf(file) {
  const raw = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return raw
  const match = raw.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)
  return match?.[1] ?? ''
}

function lineCount(source) {
  return source.split(/\r?\n/).length
}

test('阶段 5—7 实际改动的 TS/Vue 函数不超过 80 行、参数不超过 5 个', () => {
  const problems = []
  for (const file of FILES) {
    const source = sourceOf(file)
    const script = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const lineOf = (position) => script.getLineAndCharacterOfPosition(position).line
    const visit = (node) => {
      let name = null
      let target = node
      if (ts.isFunctionDeclaration(node) && node.name) {
        name = node.name.text
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          ) {
            name = declaration.name.text
            target = declaration.initializer
          }
        }
      }
      if (name) {
        const length = lineOf(target.end) - lineOf(target.getStart(script)) + 1
        const params = target.parameters.length
        if (length > 80) problems.push(`${file}:${name} lines=${length}`)
        if (params > 5) problems.push(`${file}:${name} params=${params}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(script)
    if (lineCount(source) > 450) problems.push(`${file} fileLines=${lineCount(source)}`)
  }
  assert.deepEqual(problems, [])
})
