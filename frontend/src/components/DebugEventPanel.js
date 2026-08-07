import React, { useMemo, useState } from 'react';
import './DebugEventPanel.css';

const EVENT_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'websocket', label: 'WebSocket' }
];

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDetails(details) {
  try {
    return JSON.stringify(details || {}, null, 2);
  } catch (_error) {
    return '{\n  "details": "unavailable"\n}';
  }
}

function getEventTypeLabel(type) {
  if (type === 'websocket') return 'WebSocket';
  if (type === 'webhook') return 'Webhook';
  return 'System';
}

function DebugEventPanel({ events, currentCallId, error, updatedAt }) {
  const [filter, setFilter] = useState('all');

  const visibleEvents = useMemo(() => {
    if (filter === 'all') {
      return events;
    }

    return events.filter((event) => event.type === filter);
  }, [events, filter]);

  return (
    <section className="section debug-events-panel" aria-labelledby="debug-events-title">
      <div className="debug-events-heading">
        <div>
          <h2 id="debug-events-title">Live Debug Events</h2>
          <p className="debug-events-subtitle">
            All recent webhook and RTMS WebSocket activity appears here.
          </p>
        </div>
        <div className={`debug-events-sync ${error ? 'offline' : 'online'}`}>
          <span className="debug-events-sync-dot" aria-hidden="true" />
          {error ? 'Unavailable' : updatedAt ? `Updated ${formatTimestamp(updatedAt)}` : 'Waiting for events'}
        </div>
      </div>

      <div className="debug-events-toolbar" role="group" aria-label="Event filters">
        <div className="debug-event-filters">
          {EVENT_FILTERS.map((option) => (
            <button
              key={option.value}
              className={`debug-filter-button ${filter === option.value ? 'selected' : ''}`}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="debug-event-count">
          {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="debug-events-error" role="status">
          {error}
        </div>
      )}

      {visibleEvents.length === 0 ? (
        <div className="debug-events-empty">
          <strong>No matching events yet</strong>
          <span>Webhook and WebSocket activity will appear here automatically.</span>
        </div>
      ) : (
        <div className="debug-event-list">
          {visibleEvents.map((event) => {
            const isCurrentCall = Boolean(currentCallId && event.callId === currentCallId);
            const eventType = getEventTypeLabel(event.type);

            return (
              <article
                key={event.id}
                className={`debug-event-card ${event.type || 'system'} ${event.level || 'info'}${isCurrentCall ? ' current-call' : ''}`}
              >
                <div className="debug-event-card-topline">
                  <div className="debug-event-badges">
                    <span className={`debug-event-type ${event.type || 'system'}`}>{eventType}</span>
                    <span className="debug-event-source">{event.source || 'unknown'}</span>
                    {event.direction && (
                      <span className={`debug-event-direction ${event.direction}`}>
                        {event.direction === 'sent' ? 'OUT' : 'IN'}
                      </span>
                    )}
                    {isCurrentCall && <span className="debug-current-call-badge">Current call</span>}
                  </div>
                  <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                </div>

                <div className="debug-event-summary">{event.summary || 'Event'}</div>

                <div className="debug-event-meta">
                  {event.callId && <code>callId: {event.callId}</code>}
                  {event.socket && <code>socket: {event.socket}</code>}
                  {event.level && <span className={`debug-event-level ${event.level}`}>{event.level}</span>}
                </div>

                <details className="debug-event-details">
                  <summary>View details</summary>
                  <pre>{formatDetails(event.details)}</pre>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default DebugEventPanel;
