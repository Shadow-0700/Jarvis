import React, { useState } from 'react';

interface MarkdownViewProps {
  content: string;
  onLinkClick?: (url: string) => void;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, onLinkClick }) => {
  if (!content) return null;

  // Split into blocks: code blocks vs standard text
  const parts: Array<{ type: 'text' | 'code'; code?: string; lang?: string; text?: string }> = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        text: content.slice(lastIndex, match.index)
      });
    }
    parts.push({
      type: 'code',
      lang: match[1] || 'code',
      code: match[2].trimEnd()
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      text: content.slice(lastIndex)
    });
  }

  return (
    <div className="markdown-body">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          return <CodeBlock key={idx} lang={part.lang!} code={part.code!} />;
        }
        return <TextBlock key={idx} text={part.text!} onLinkClick={onLinkClick} />;
      })}
    </div>
  );
};

const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-lang-tag">{lang}</span>
        <button className="code-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-block-content">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const TextBlock: React.FC<{ text: string; onLinkClick?: (url: string) => void }> = ({ text, onLinkClick }) => {
  const lines = text.split('\n');

  return (
    <div className="text-block">
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();

        // Headings
        if (trimmed.startsWith('### ')) {
          return <h3 key={lIdx} className="md-h3">{renderInline(trimmed.slice(4), onLinkClick)}</h3>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={lIdx} className="md-h2">{renderInline(trimmed.slice(3), onLinkClick)}</h2>;
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={lIdx} className="md-h1">{renderInline(trimmed.slice(2), onLinkClick)}</h1>;
        }

        // Bullet lists
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={lIdx} className="md-list-item">
              <span className="md-bullet">•</span>
              <span className="md-list-text">{renderInline(trimmed.slice(2), onLinkClick)}</span>
            </div>
          );
        }

        // Numbered lists
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={lIdx} className="md-list-item">
              <span className="md-num">{numMatch[1]}.</span>
              <span className="md-list-text">{renderInline(numMatch[2], onLinkClick)}</span>
            </div>
          );
        }

        // Empty lines
        if (!trimmed) {
          return <div key={lIdx} style={{ height: '8px' }} />;
        }

        // Standard paragraph
        return <p key={lIdx} className="md-p">{renderInline(line, onLinkClick)}</p>;
      })}
    </div>
  );
};

function renderInline(text: string, onLinkClick?: (url: string) => void): React.ReactNode[] {
  // Parses `inline code`, **bold**, *italic*, [link](url), and standalone URLs
  const tokens: React.ReactNode[] = [];
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|file:\/\/\/[^\s)]+)/g;

  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    // Inline code: `code`
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code key={key++} className="inline-code">
          {token.slice(1, -1)}
        </code>
      );
    }
    // Bold: **text**
    else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={key++} className="md-bold">
          {token.slice(2, -2)}
        </strong>
      );
    }
    // Italic: *text*
    else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={key++} className="md-italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    // Markdown Link: [text](url)
    else if (token.startsWith('[') && token.includes('](')) {
      const parts = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (parts) {
        tokens.push(
          <a
            key={key++}
            href={parts[2]}
            className="md-link"
            onClick={(e) => {
              if (onLinkClick) {
                e.preventDefault();
                onLinkClick(parts[2]);
              }
            }}
            target="_blank"
            rel="noopener noreferrer"
            title={parts[2]}
          >
            {parts[1]}
          </a>
        );
      }
    }
    // Standalone URLs (http/https/file)
    else if (token.startsWith('http') || token.startsWith('file:///')) {
      tokens.push(
        <a
          key={key++}
          href={token}
          className="md-link"
          onClick={(e) => {
            if (onLinkClick) {
              e.preventDefault();
              onLinkClick(token);
            }
          }}
          target="_blank"
          rel="noopener noreferrer"
        >
          {token}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}
