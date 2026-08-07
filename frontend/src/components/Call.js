import React from 'react';
import DebugEventPanel from './DebugEventPanel';
import './Call.css';

function Call({
  callIdInput,
  listeningCallId,
  listenerStatus,
  rtmsStatus,
  message,
  error,
  debugEvents,
  debugError,
  debugUpdatedAt,
  onCallIdChange,
  onListen,
  onStopListening,
  onRtmsAction,
  actionPending,
  onAuthorize
}) {
  const callStatus = listenerStatus?.active ? 'RTMS active' : 'Waiting';

  return (
    <div className="call-container">
      <header className="header call-header">
        <h1>Zoom Phone RTMS Test App</h1>
        <p className="subtitle">Manual call ID listener</p>
      </header>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className={`rtms-status-alert ${rtmsStatus}`}>
        <div className="rtms-status-text">
          {rtmsStatus === 'capturing' && (
            <>
              <strong>RTMS SESSION ACTIVE - LISTENING</strong>
              <br />
              <span className="rtms-status-detail">The selected call has an active RTMS session</span>
            </>
          )}
          {rtmsStatus === 'ready' && (
            <>
              <strong>WAITING FOR RTMS</strong>
              <br />
              <span className="rtms-status-detail">The selected call is not active yet</span>
            </>
          )}
          {rtmsStatus === 'waiting' && (
            <>
              <strong>READY TO LISTEN</strong>
              <br />
              <span className="rtms-status-detail">Enter a call ID below</span>
            </>
          )}
          {rtmsStatus === 'error' && (
            <>
              <strong>RTMS STATUS UNAVAILABLE</strong>
              <br />
              <span className="rtms-status-detail">Check the backend and RTMS services</span>
            </>
          )}
        </div>
      </div>

      {message && (
        <div className="message-box">
          {message}
        </div>
      )}

      <div className="section">
        <h2>Manual Call Listener</h2>
        <form className="call-listener-form" onSubmit={onListen}>
          <label htmlFor="call-id-input">Call ID</label>
          <div className="listener-actions">
            <input
              id="call-id-input"
              className="call-id-input"
              type="text"
              value={callIdInput}
              onChange={(event) => onCallIdChange(event.target.value)}
              placeholder="Enter callId"
              autoComplete="off"
              spellCheck="false"
            />
            <button className="btn btn-primary" type="submit">
              Listen
            </button>
            <button
              className="btn btn-success"
              type="button"
              onClick={() => onRtmsAction('start')}
              disabled={Boolean(actionPending)}
            >
              {actionPending === 'start' ? 'Starting...' : 'Start RTMS'}
            </button>
            {listeningCallId && (
              <>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => onRtmsAction('stop')}
                  disabled={Boolean(actionPending)}
                >
                  {actionPending === 'stop' ? 'Stopping...' : 'Stop RTMS'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={onStopListening}>
                  Stop Watching
                </button>
              </>
            )}
          </div>
          <p className="action-hint">
            Listen watches the local RTMS session. Start RTMS calls the Phone API; audio begins after the
            <code>phone.rtms_started</code> webhook reaches the RTMS server.
          </p>
          <button className="authorize-button" type="button" onClick={onAuthorize}>
            Authorize Zoom for manual RTMS control
          </button>
        </form>
      </div>

      <div className="section">
        <h2>Listener Status</h2>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">Mode:</span>
            <span className="status-value">Manual test</span>
          </div>
          <div className="status-item">
            <span className="status-label">Call ID:</span>
            <span className="status-value">{listeningCallId || 'Not selected'}</span>
          </div>
          <div className="status-item">
            <span className="status-label">Call:</span>
            <span className={`status-value ${listenerStatus?.active ? 'success' : 'pending'}`}>
              {callStatus}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Polling:</span>
            <span className="status-value">Every 2 seconds</span>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>RTMS Information</h2>
        <div className="rtms-info">
          <p className="info-text">
            The backend requests the Phone RTMS action, receives the Phone RTMS webhook, and connects to the RTMS media server.
          </p>
          <ul>
            <li>Audio is stored under <code>rtms/data/audio/</code></li>
            <li>Transcripts are stored under <code>rtms/data/transcripts/</code></li>
            <li>Stopped and interrupted events finalize the selected call's files</li>
          </ul>
        </div>
      </div>

      <DebugEventPanel
        events={debugEvents}
        currentCallId={callIdInput.trim()}
        error={debugError}
        updatedAt={debugUpdatedAt}
      />

      <div className="section footer">
        <p className="footer-text">
          Zoom Phone RTMS Test App | Manual Listener Mode
        </p>
      </div>
    </div>
  );
}

export default Call;
