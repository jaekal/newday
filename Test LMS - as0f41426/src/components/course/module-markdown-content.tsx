import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders legacy module body text stored as Markdown (seed + older content).
 * JSON block content is handled separately via {@link RichContentViewer}.
 */
export function ModuleMarkdownContent({ source }: { source: string }) {
  return (
    <article className="module-markdown text-[15px] leading-relaxed text-gray-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-8 border-b border-gray-100 pb-2 text-xl font-bold tracking-tight text-[#111] first:mt-0">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-6 text-lg font-semibold text-[#111]">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-5 text-base font-semibold text-[#111]">{children}</h4>
          ),
          p: ({ children }) => <p className="mt-4 first:mt-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-gray-400">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-3 list-decimal space-y-2 pl-5 marker:font-medium marker:text-gray-500">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#111]">{children}</strong>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-800 hover:decoration-blue-800/50"
            >
              {children}
            </a>
          ),
          // Images in Markdown are wrapped in <p> by default — do not use <figure>/<figcaption>
          // here (invalid inside <p> and causes hydration errors). Use img + caption span.
          img: ({ src, alt }) => (
            <span className="my-6 block overflow-hidden rounded-xl border border-gray-200/80 bg-gray-50 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external URLs from CMS/seed */}
              <img
                src={src ?? ""}
                alt={alt ?? ""}
                className="block h-auto max-h-[min(420px,70vh)] w-full object-cover"
                loading="lazy"
              />
              {alt ? (
                <span className="block border-t border-gray-100 px-3 py-2 text-center text-xs text-gray-500">
                  {alt}
                </span>
              ) : null}
            </span>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-[var(--c-accent,#ff6a00)] bg-orange-50/50 py-2 pl-4 pr-3 text-[14px] text-gray-800 [&>p]:mt-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-8 border-gray-100" />,
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[13px] text-gray-900"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-lg border border-gray-200 bg-[#1e1e1e] p-4 text-[13px] text-gray-100">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[280px] border-collapse text-left text-[14px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50 text-[13px] font-semibold text-[#111]">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-gray-100">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-gray-50/80">{children}</tr>,
          th: ({ children }) => (
            <th className="whitespace-nowrap px-3 py-2.5 first:rounded-tl-lg last:rounded-tr-lg">{children}</th>
          ),
          td: ({ children }) => <td className="px-3 py-2.5 align-top text-gray-700">{children}</td>,
        }}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}
