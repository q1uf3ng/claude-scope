import React, { useEffect, useState, useCallback } from 'react'
import type { Session, TraceRecord, Stats, WSEvent, Span } from './types'
import { fetchSessions, fetchSessionTraces, fetchStats } from './api'
import { useWebSocket } from './hooks/useWebSocket'
import { StatusBar } from './components/StatusBar'
import { SessionList } from './components/SessionList'
import { Timeline } from './components/Timeline'
import { CostDashboard } from './components/CostDashboard'

type View = 'timeline' | 'dashboard'

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [traces, setTraces] = useState<TraceRecord[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [activeSpans, setActiveSpans] = useState(0)
  const [currentView, setCurrentView] = useState<View>('timeline')
  const [loading, setLoading] = useState(false)

  // Initial data load
  useEffect(() => {
    loadSessions()
    loadStats()
    const interval = setInterval(loadStats, 10000)
    return () => clearInterval(interval)
  }, [])

  async function loadSessions() {
    try {
      const data = await fetchSessions()
      setSessions(data)
      // Auto-select first session if none selected
      if (data.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data[0].id)
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
  }

  async function loadStats() {
    try {
      const data = await fetchStats()
      setStats(data)
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  // Load traces when session changes
  useEffect(() => {
    if (!selectedSessionId) return
    setLoading(true)
    fetchSessionTraces(selectedSessionId)
      .then(setTraces)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedSessionId])

  // WebSocket handler for real-time updates
  const handleWSEvent = useCallback(
    (event: WSEvent) => {
      switch (event.type) {
        case 'span_start': {
          setActiveSpans((prev) => prev + 1)
          // If this span belongs to the selected session, add it to traces
          if (event.span.session_id === selectedSessionId) {
            setTraces((prev) => [
              ...prev,
              {
                ...event.span,
                method: 'POST',
                path: '/v1/messages',
                request_headers: {},
                response_status: 0,
                response_headers: {},
                is_streaming: false,
              } as TraceRecord,
            ])
          }
          // Refresh sessions list
          loadSessions()
          break
        }
        case 'span_chunk': {
          // Update in-flight span with streaming data
          break
        }
        case 'span_end': {
          setActiveSpans((prev) => Math.max(0, prev - 1))
          // Update the trace in our list
          if (event.span.session_id === selectedSessionId) {
            setTraces((prev) =>
              prev.map((t) =>
                t.id === event.span.id
                  ? {
                      ...t,
                      ...event.span,
                      method: t.method || 'POST',
                      path: t.path || '/v1/messages',
                      request_headers: t.request_headers || {},
                      response_status: event.span.status === 'error' ? 500 : 200,
                      response_headers: t.response_headers || {},
                      is_streaming: t.is_streaming || false,
                    }
                  : t
              )
            )
          }
          // Refresh stats
          loadStats()
          loadSessions()
          break
        }
      }
    },
    [selectedSessionId]
  )

  useWebSocket(handleWSEvent)

  return (
    <div className="h-screen flex flex-col bg-ct-bg">
      <StatusBar stats={stats} activeSpans={activeSpans} />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <div className="w-64 border-r border-ct-border bg-ct-surface flex flex-col shrink-0">
          {/* View switcher */}
          <div className="p-2 border-b border-ct-border flex gap-1">
            <button
              onClick={() => setCurrentView('timeline')}
              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                currentView === 'timeline'
                  ? 'bg-ct-accent/20 text-ct-accent'
                  : 'text-ct-text-secondary hover:text-ct-text'
              }`}
            >
              Timeline
            </button>
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                currentView === 'dashboard'
                  ? 'bg-ct-accent/20 text-ct-accent'
                  : 'text-ct-text-secondary hover:text-ct-text'
              }`}
            >
              Dashboard
            </button>
          </div>

          {/* Session list */}
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-ct-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : currentView === 'timeline' ? (
            selectedSessionId ? (
              <Timeline traces={traces} sessionId={selectedSessionId} />
            ) : (
              <div className="flex items-center justify-center h-full text-ct-text-secondary">
                <div className="text-center">
                  <div className="text-4xl mb-4 opacity-20">{ '{ }' }</div>
                  <p className="text-sm mb-2">Select a session to view traces</p>
                  <p className="text-xs">or start making API calls through the proxy</p>
                </div>
              </div>
            )
          ) : (
            <CostDashboard stats={stats} sessions={sessions} />
          )}
        </div>
      </div>
    </div>
  )
}
