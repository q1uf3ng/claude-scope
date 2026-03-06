import React, { useState } from 'react'

interface JsonViewProps {
  data: any
  maxDepth?: number
  collapsed?: boolean
}

export function JsonView({ data, maxDepth = 3, collapsed = true }: JsonViewProps) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <JsonNode data={data} depth={0} maxDepth={maxDepth} defaultCollapsed={collapsed} />
    </div>
  )
}

function JsonNode({
  data,
  depth,
  maxDepth,
  defaultCollapsed,
  keyName,
}: {
  data: any
  depth: number
  maxDepth: number
  defaultCollapsed: boolean
  keyName?: string
}) {
  const [isCollapsed, setIsCollapsed] = useState(depth >= 1 && defaultCollapsed)

  if (data === null) return <span className="text-ct-text-secondary">null</span>
  if (data === undefined) return <span className="text-ct-text-secondary">undefined</span>

  if (typeof data === 'string') {
    // Check for base64 image
    if (data.startsWith('data:image/') || (data.length > 500 && /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 100)))) {
      return (
        <span className="text-green-400">
          "[base64 image, {(data.length / 1024).toFixed(1)}KB]"
        </span>
      )
    }
    if (data.length > 500) {
      return (
        <span className="text-green-400">
          "{data.slice(0, 200)}..."
          <span className="text-ct-text-secondary ml-1">({data.length} chars)</span>
        </span>
      )
    }
    return <span className="text-green-400">"{data}"</span>
  }

  if (typeof data === 'number') return <span className="text-ct-orange">{data}</span>
  if (typeof data === 'boolean') return <span className="text-ct-purple">{String(data)}</span>

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-ct-text-secondary">[]</span>

    if (isCollapsed) {
      return (
        <span>
          <button
            onClick={() => setIsCollapsed(false)}
            className="text-ct-text-secondary hover:text-ct-text"
          >
            [{data.length} items...]
          </button>
        </span>
      )
    }

    return (
      <span>
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-ct-text-secondary hover:text-ct-text"
        >
          [
        </button>
        <div className="ml-4 border-l border-ct-border pl-2">
          {data.map((item, i) => (
            <div key={i}>
              <JsonNode
                data={item}
                depth={depth + 1}
                maxDepth={maxDepth}
                defaultCollapsed={defaultCollapsed}
              />
              {i < data.length - 1 && <span className="text-ct-text-secondary">,</span>}
            </div>
          ))}
        </div>
        <span className="text-ct-text-secondary">]</span>
      </span>
    )
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data)
    if (keys.length === 0) return <span className="text-ct-text-secondary">{'{}'}</span>

    if (isCollapsed) {
      return (
        <button
          onClick={() => setIsCollapsed(false)}
          className="text-ct-text-secondary hover:text-ct-text"
        >
          {'{'}
          {keys.length} keys...{'}'}
        </button>
      )
    }

    return (
      <span>
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-ct-text-secondary hover:text-ct-text"
        >
          {'{'}
        </button>
        <div className="ml-4 border-l border-ct-border pl-2">
          {keys.map((key, i) => (
            <div key={key}>
              <span className="text-ct-accent">"{key}"</span>
              <span className="text-ct-text-secondary">: </span>
              <JsonNode
                data={data[key]}
                depth={depth + 1}
                maxDepth={maxDepth}
                defaultCollapsed={defaultCollapsed}
                keyName={key}
              />
              {i < keys.length - 1 && <span className="text-ct-text-secondary">,</span>}
            </div>
          ))}
        </div>
        <span className="text-ct-text-secondary">{'}'}</span>
      </span>
    )
  }

  return <span>{String(data)}</span>
}
