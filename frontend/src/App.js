import React, { useEffect, useState } from 'react';
import Call from './components/Call';
import './App.css';

const SAFE_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const POLL_INTERVAL_MS = 2000;
const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '/api').replace(/\/$/, '');

function App() {
  const [callIdInput, setCallIdInput] = useState('');
  const [listeningCallId, setListeningCallId] = useState('');
  const [listenerStatus, setListenerStatus] = useState(null);
  const [message, setMessage] = useState('Enter a call ID to monitor its RTMS session.');
  const [error, setError] = useState('');
  const [rtmsStatus, setRtmsStatus] = useState('waiting');
  const [actionPending, setActionPending] = useState('');
  const [debugEvents, setDebugEvents] = useState([]);
  const [debugError, setDebugError] = useState('');
  const [debugUpdatedAt, setDebugUpdatedAt] = useState(null);

  useEffect(() => {
    if (!listeningCallId) {
      return undefined;
    }

    let cancelled = false;

    async function pollCallStatus() {
      try {
        const response = await fetch(
          `${BACKEND_URL}/rtms/calls/${encodeURIComponent(listeningCallId)}`,
          { headers: { Accept: 'application/json' } }
        );

        if (!response.ok) {
          throw new Error('RTMS status request failed');
        }

        const status = await response.json();
        if (cancelled) {
          return;
        }

        setListenerStatus(status);
        setError('');
        if (status.active) {
          setRtmsStatus('capturing');
          setMessage(`RTMS session is active for call ${listeningCallId}.`);
        } else {
          setRtmsStatus('ready');
          setMessage(`Waiting for an RTMS webhook for call ${listeningCallId}.`);
        }
      } catch (_pollError) {
        if (!cancelled) {
          setRtmsStatus('error');
          setError('Unable to read RTMS status. Check that the backend and RTMS services are running.');
        }
      }
    }

    pollCallStatus();
    const intervalId = window.setInterval(pollCallStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [listeningCallId]);

  useEffect(() => {
    let cancelled = false;

    async function pollDebugEvents() {
      try {
        const response = await fetch(
          `${BACKEND_URL}/debug/events?limit=100`,
          { headers: { Accept: 'application/json' } }
        );

        if (!response.ok) {
          throw new Error('Debug events request failed');
        }

        const result = await response.json();
        if (cancelled) {
          return;
        }

        setDebugEvents(Array.isArray(result.events) ? result.events : []);
        setDebugUpdatedAt(result.checkedAt || new Date().toISOString());
        setDebugError('');
      } catch (_debugError) {
        if (!cancelled) {
          setDebugError('Debug events are unavailable. The listener can still be used.');
        }
      }
    }

    pollDebugEvents();
    const intervalId = window.setInterval(pollDebugEvents, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  function handleListen(event) {
    event.preventDefault();
    const normalizedCallId = callIdInput.trim();

    if (!SAFE_CALL_ID_PATTERN.test(normalizedCallId)) {
      setError('Enter a valid call ID using only letters, numbers, hyphens, or underscores.');
      return;
    }

    setError('');
    setListenerStatus(null);
    setListeningCallId(normalizedCallId);
    setRtmsStatus('ready');
    setMessage(`Started monitoring call ${normalizedCallId}.`);
  }

  function handleStopListening() {
    setListeningCallId('');
    setListenerStatus(null);
    setRtmsStatus('waiting');
    setMessage('Enter a call ID to monitor its RTMS session.');
    setError('');
  }

  async function handleRtmsAction(action) {
    const normalizedCallId = callIdInput.trim();
    if (!SAFE_CALL_ID_PATTERN.test(normalizedCallId)) {
      setError('Enter a valid call ID before starting or stopping RTMS.');
      return;
    }

    if (listeningCallId !== normalizedCallId) {
      setListeningCallId(normalizedCallId);
      setListenerStatus(null);
    }

    setActionPending(action);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/rtms/calls/${encodeURIComponent(normalizedCallId)}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'RTMS action request failed');
      }

      setRtmsStatus('ready');
      setMessage(
        action === 'start'
          ? `RTMS start accepted for call ${normalizedCallId}. Waiting for the Phone RTMS webhook.`
          : `RTMS stop accepted for call ${normalizedCallId}. Waiting for the stop webhook.`
      );
    } catch (actionError) {
      setRtmsStatus('error');
      setError(actionError.message);
    } finally {
      setActionPending('');
    }
  }

  function handleAuthorize() {
    window.location.assign(`${BACKEND_URL}/auth/login`);
  }

  return (
    <div className="App">
      <Call
        callIdInput={callIdInput}
        listeningCallId={listeningCallId}
        listenerStatus={listenerStatus}
        rtmsStatus={rtmsStatus}
        message={message}
        error={error}
        debugEvents={debugEvents}
        debugError={debugError}
        debugUpdatedAt={debugUpdatedAt}
        onCallIdChange={setCallIdInput}
        onListen={handleListen}
        onStopListening={handleStopListening}
        onRtmsAction={handleRtmsAction}
        actionPending={actionPending}
        onAuthorize={handleAuthorize}
      />
    </div>
  );
}

export default App;
