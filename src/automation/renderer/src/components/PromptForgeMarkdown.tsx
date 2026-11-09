import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown for PromptForge replies. react-markdown escapes raw HTML by default,
 * so model output cannot inject markup into the renderer.
 */
export default function PromptForgeMarkdown({ content }: { content: string }) {
  return (
    <div className="pf-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
