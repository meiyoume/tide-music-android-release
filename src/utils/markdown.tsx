import { Fragment, type ReactNode } from 'react'
import { View } from 'react-native'
import he from 'he'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'

/**
 * 轻量 Markdown → RN 元素：只覆盖更新说明实际会用到的几种语法
 * （用户之前看到的是一坨裸 `##` / `**` / 反引号，就是没渲染）。
 *   ## / ### / ####  标题
 *   - / * 开头         列表项
 *   **加粗**           加粗
 *   `行内代码`         等宽高亮
 *   空行               段落间距
 * 不引第三方依赖，样式走主题色由调用方给。
 */
const inline = (text: string, keyBase: string): ReactNode[] => {
  const out: ReactNode[] = []
  // 同时拆 **粗体** 与 `代码`
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i++}`}>{he.decode(text.slice(last, m.index))}</Fragment>)
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<Text key={`${keyBase}-b${i++}`} style={styles.strong}>{he.decode(tok.slice(2, -2))}</Text>)
    } else {
      out.push(<Text key={`${keyBase}-c${i++}`} style={styles.code}>{he.decode(tok.slice(1, -1))}</Text>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-t${i++}`}>{he.decode(text.slice(last))}</Fragment>)
  return out
}

export const renderMarkdown = (source: string, color?: string): ReactNode => {
  const lines = String(source ?? '').split(/\r?\n/)
  const blocks: ReactNode[] = []
  let key = 0
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      blocks.push(<View key={`sp${key++}`} style={styles.gap} />)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push(<Text key={`h${key++}`} style={styles.heading} color={color}>{inline(h[2], `h${key}`)}</Text>)
      continue
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) {
      blocks.push(<Text key={`li${key++}`} style={styles.listItem} color={color}>{'• '}{inline(li[1], `li${key}`)}</Text>)
      continue
    }
    blocks.push(<Text key={`p${key++}`} style={styles.para} color={color}>{inline(line, `p${key}`)}</Text>)
  }
  return <>{blocks}</>
}

const styles = createStyle({
  heading: { fontSize: 15, fontWeight: 'bold', marginTop: 2 },
  para: { fontSize: 13, lineHeight: 19 },
  listItem: { fontSize: 13, lineHeight: 19, paddingLeft: 4 },
  code: { fontFamily: 'monospace', fontSize: 12 },
  strong: { fontWeight: 'bold' },
  gap: { height: 6 },
})
