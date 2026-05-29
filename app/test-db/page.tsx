'use client';

import { useState, useEffect } from 'react';
import styles from './test-db.module.css';

export default function TestDBPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const testCreate = async () => {
    try {
      setStatus('Creating test session...');
      const testSession = {
        id: `test-${Date.now()}`,
        title: 'Test Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      };

      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', data: testSession }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('✅ Session created successfully');
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const loadSessions = async () => {
    try {
      setStatus('Loading sessions...');
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data);
      setStatus(`✅ Loaded ${data.length} sessions`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  return (
    <div className={styles.container}>
      <h1>SQLite Database Test</h1>

      <div className={styles.status}>
        {status && <p>{status}</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      </div>

      <div className={styles.actions}>
        <button onClick={testCreate}>Create Test Session</button>
        <button onClick={loadSessions}>Reload Sessions</button>
      </div>

      <div className={styles.sessions}>
        <h2>Sessions ({sessions.length})</h2>
        <pre>{JSON.stringify(sessions, null, 2)}</pre>
      </div>
    </div>
  );
}
