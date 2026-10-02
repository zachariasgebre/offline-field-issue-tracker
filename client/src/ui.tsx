import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { categories, priorities, statuses, type Category, type Priority, type Status } from '@field/shared';
import { db, type Report } from './db.js';
import { changeStatus, createReport, updateReport } from './repository.js';
import { refreshServerReports, retryReport, syncNow } from './sync.js';

export function App() {
  const reports = useLiveQuery(() => db.reports.orderBy('reportedAt').reverse().toArray(), [], []);
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const [online, setOnline] = useState(navigator.onLine), [apiOnline, setApiOnline] = useState(false);
  const [role, setRole] = useState(localStorage.getItem('field-role') ?? 'field_worker');
  const [filter, setFilter] = useState('All'), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState('');
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { const check = () => fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/health`, { signal: AbortSignal.timeout(3000) }).then(r => setApiOnline(r.ok)).catch(() => setApiOnline(false)); void check(); const timer = window.setInterval(check, 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (apiOnline) void syncNow(); }, [apiOnline]);
  useEffect(() => { const timer = window.setInterval(() => { if (apiOnline && pending > 0) void syncNow(); }, 30_000); return () => clearInterval(timer); }, [apiOnline, pending]);
  useEffect(() => {
    if (role !== 'coordinator' || !apiOnline) return;
    const refresh = () => refreshServerReports().catch(e => setNotice(e instanceof Error ? e.message : 'Could not refresh server reports.'));
    void refresh(); const timer = window.setInterval(refresh, 30_000); return () => clearInterval(timer);
  }, [role, apiOnline]);
  const visible = useMemo(() => reports.filter(r => (role !== 'coordinator' || !!r.serverId) && (filter === 'All' || (filter === 'Failed' ? r.syncState === 'failed' : r.status === filter))), [reports, filter, role]);
  const setUserRole = (value: string) => { localStorage.setItem('field-role', value); setRole(value); };
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(event.currentTarget);
    try {
      const customFields: Record<string, string | number | boolean> = {};
      for (const [key, value] of form.entries()) if (key.startsWith('custom:') && String(value).trim()) customFields[key.slice(7)] = String(value).trim();
      await createReport({ category: String(form.get('category')) as Category, priority: String(form.get('priority')) as Priority, description: String(form.get('description')), location: { text: String(form.get('location') ?? '') }, customFields });
      setNotice('Report saved on this device. It will sync when the server is reachable.'); formElement.reset(); void syncNow();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save report.'); }
  }
  async function move(report: Report, status: Status) { try { await changeStatus(report.clientId, status); setNotice(`Moved to ${status}.`); void syncNow(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not update status.'); } }
  return <main>
    <header className="topbar"><a className="brand" href="#home"><span className="brand-mark">F</span><span>Field<span className="brand-light">Issues</span><small>OFFLINE TRACKER</small></span></a><div className="top-actions"><span className={`connection ${online && apiOnline ? 'is-online' : ''}`}><i />{online && apiOnline ? 'Connected' : 'Offline'}</span><label className="role-select">View as <select value={role} onChange={e => setUserRole(e.target.value)}><option value="field_worker">Field worker</option><option value="coordinator">Coordinator</option></select></label><button className="button dark" onClick={() => void syncNow()}>↻ <span>Sync now</span></button><span className="pending-count">{pending} pending</span></div></header>
    <section className="hero"><div><div className="eyebrow">FIELD OPERATIONS <span>•</span> ISSUE MANAGEMENT</div><h1>Issues from the field,<br/><em>handled with care.</em></h1><p>Capture it where it happens. We’ll keep everything safe until you’re back online.</p></div><div className="hero-art"><div className="sun"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="pin"><span>+</span></div><div className="art-card"><span className="art-dot"/><span>Issue logged</span><b>Just now</b></div></div></section>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    <div className="workspace"><section className="list-pane"><div className="section-heading"><div><div className="eyebrow">{role === 'coordinator' ? 'SERVER WORKSPACE' : 'YOUR WORKSPACE'}</div><h2>{role === 'coordinator' ? 'Coordinator queue' : 'Field reports'} <span className="count-pill">{visible.length}</span></h2></div><span className="saved-label"><span/> {role === 'coordinator' ? 'Server reports refreshed automatically' : 'Saved on this device'}</span></div><div className="filters">{['All', ...statuses, 'Failed'].map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div><div className="reports">{visible.length ? visible.map(r => <ReportCard key={r.clientId} report={r} active={selected === r.clientId} onClick={() => setSelected(selected === r.clientId ? null : r.clientId)} />) : <div className="empty"><span>✳</span><b>{role === 'coordinator' ? 'No server reports found' : 'No reports here yet'}</b><small>{role === 'coordinator' ? 'Connect to the API to load the coordinator queue.' : 'When you log an issue, it will appear here.'}</small></div>}</div>{selected && reports.find(r => r.clientId === selected) && <Detail report={reports.find(r => r.clientId === selected)!} role={role} onMove={move}/>}</section>
      <aside className="form-pane">{role === 'coordinator' && <div className="coordinator-note"><div className="eyebrow">COORDINATOR INBOX</div><strong>{reports.filter(r => !!r.serverId).length} reports from the server</strong><p>Assign or update status from a report’s history panel.</p><button onClick={() => void refreshServerReports().catch(e => setNotice(e instanceof Error ? e.message : 'Refresh failed.'))}>Refresh reports</button></div>}<div className="form-intro"><span className="form-icon">✳</span><div><div className="eyebrow">QUICK CAPTURE</div><h2>Log an issue</h2><p>Every detail helps us get it resolved.</p></div></div><form id="report-form" onSubmit={add}><label>What needs attention?<textarea name="description" required minLength={4} maxLength={5000} placeholder="Describe what you noticed..." rows={3}/></label><div className="field-row"><label>Issue type<select name="category" defaultValue="water_point">{categories.map(c => <option value={c} key={c}>{label(c)}</option>)}</select></label><label>Priority<select name="priority" defaultValue="medium">{priorities.map(p => <option key={p}>{label(p)}</option>)}</select></label></div><label>Location <span className="optional">OPTIONAL</span><div className="input-icon"><span>⌖</span><input name="location" placeholder="Site, landmark or coordinates"/></div></label><details className="custom"><summary>＋ Add a custom detail <span>Optional</span></summary><div className="custom-inputs"><input name="custom:team" placeholder="Team or asset ID"/><input name="custom:contact" placeholder="Contact name"/></div></details><div className="form-foot"><div className="local-note"><span>◈</span><span>Saved to your device first<br/><small>Safe even without a signal.</small></span></div><button className="button primary" type="submit">Save report <span>↗</span></button></div></form><div className="field-note"><span>✳</span> Your reports stay on this device and sync when you reconnect.</div></aside></div>
    <footer>FIELD ISSUES <span>•</span> BUILT FOR THE MOMENTS BETWEEN SIGNAL</footer>
  </main>;
}
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); }
const statusTone: Record<string, string> = { Draft: 'draft', Submitted: 'submitted', Assigned: 'assigned', 'In Progress': 'progress', Resolved: 'resolved', Rejected: 'rejected' };
function ReportCard({ report, active, onClick }: { report: Report; active: boolean; onClick: () => void }) { return <button className={`report-card ${active ? 'chosen' : ''}`} onClick={onClick}><div className="card-meta"><span className={`status ${statusTone[report.status]}`}>{report.status}</span><span className={`sync-state ${report.syncState}`}>{report.syncState === 'synchronized' ? '✓ Synced' : report.syncState === 'failed' ? '⚠ Failed' : '◌ Pending'}</span></div><strong>{report.description}</strong><div className="card-bottom"><span>{label(report.category)} <i>·</i> {report.location.text || 'Location not set'}</span><span className={`priority ${report.priority}`}>{report.priority} priority</span></div><time>{new Date(report.reportedAt).toLocaleString()}</time></button>; }
function Detail({ report, role, onMove }: { report: Report; role: string; onMove: (r: Report, s: Status) => void }) {
  const history = useLiveQuery(() => db.history.where('clientId').equals(report.clientId).sortBy('at'), [report.clientId], []);
  const [serverHistory, setServerHistory] = useState<any[]>([]);
  const [editing, setEditing] = useState(false), [saved, setSaved] = useState('');
  const next = ({ Draft: ['Submitted'], Submitted: ['Assigned', 'Rejected'], Assigned: ['In Progress', 'Rejected'], 'In Progress': ['Resolved', 'Rejected'], Resolved: [], Rejected: [] } as Record<Status, Status[]>)[report.status];
  useEffect(() => {
    if (!report.serverId) { setServerHistory([]); return; }
    let active = true;
    fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/reports/${report.serverId}`).then(r => r.ok ? r.json() : null).then(data => {
      if (active && data?.history) setServerHistory(data.history.map((item: any) => ({ id: `server-${item.id}`, type: item.event_type, fromStatus: item.from_status, toStatus: item.to_status, at: item.created_at, source: 'server' })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [report.serverId]);
  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      await updateReport(report.clientId, { description: String(form.get('description')), category: String(form.get('category')) as Category, priority: String(form.get('priority')) as Priority, location: { ...report.location, text: String(form.get('location') ?? '') } });
      setEditing(false); setSaved('Changes saved on this device and queued to sync.'); void syncNow();
    } catch (e) { setSaved(e instanceof Error ? e.message : 'Could not save changes.'); }
  }
  return <div className="detail">
    <div className="detail-title"><h3>Report history</h3><div className="detail-controls"><span>{history.length} events</span><button onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit report'}</button></div></div>
    {saved && <p className="edit-message" role="status">{saved}</p>}
    {editing && <form className="edit-form" onSubmit={saveEdit}><label>Description<textarea name="description" required minLength={1} maxLength={5000} defaultValue={report.description}/></label><div className="field-row"><label>Issue type<select name="category" defaultValue={report.category}>{categories.map(c => <option value={c} key={c}>{label(c)}</option>)}</select></label><label>Priority<select name="priority" defaultValue={report.priority}>{priorities.map(p => <option value={p} key={p}>{label(p)}</option>)}</select></label></div><label>Location<input name="location" defaultValue={report.location.text ?? ''}/></label><button className="button primary" type="submit">Save changes</button></form>}
    {[...serverHistory, ...history].sort((a, b) => a.at.localeCompare(b.at)).map(h => <div className="timeline" key={h.id}><i/><div><b>{label(h.type)}</b>{h.fromStatus && <p>{h.fromStatus} → {h.toStatus}</p>}<time>{new Date(h.at).toLocaleString()} · {h.source}</time></div></div>)}
    {report.lastSyncError && <div className="error-box">{report.lastSyncError}<button onClick={() => void retryReport(report.clientId)}>Retry</button></div>}
    {role === 'coordinator' && next.length > 0 && <div className="status-actions">{next.map(s => <button key={s} onClick={() => onMove(report, s)}>Move to {s}</button>)}</div>}
  </div>;
}
