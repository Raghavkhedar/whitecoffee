'use client';

/*
 * SITE MANAGEMENT — NOT CURRENTLY IN USE
 *
 * Site management was used to create/edit sites with GPS coordinates and geofence radii.
 * The geofencing and daily assignment features that depended on this are also commented out.
 * The /sites Firestore collection still exists but is not managed from the portal.
 *
 * To re-enable:
 *   1. Uncomment the imports below
 *   2. Uncomment SitesPage implementation below
 *   3. Remove the placeholder return above it
 *   4. Uncomment the Site interface in src/types/index.ts
 *   5. Uncomment getAllSites / createSite / updateSite / deleteSite in src/lib/firestore.ts
 *   6. Uncomment the Sites nav entry in src/components/Sidebar.tsx
 *   7. Uncomment the daily assignment system if also re-enabling that feature
 */

// import { useEffect, useState } from 'react';
// import { getAllSites, createSite, updateSite, deleteSite } from '@/lib/firestore';
// import type { Site } from '@/types';

export default function SitesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Site Management</h1>
          <p className="text-text-secondary text-sm mt-1">This feature is currently not in use.</p>
        </div>
      </div>
      <div className="card text-center py-16 text-text-secondary">
        <p className="text-4xl mb-4">🏗️</p>
        <p className="font-medium text-text-primary mb-2">Feature Disabled</p>
        <p className="text-sm">Site management is commented out — geofencing and daily assignments are not active.</p>
        <p className="text-sm mt-1">See the commented code in this file to re-enable.</p>
      </div>
    </div>
  );
}

/*
 * ─── ORIGINAL IMPLEMENTATION (commented out) ──────────────────────────────
 *
 * const EMPTY_FORM = { name: '', latitude: '', longitude: '', geofenceRadius: '200' };
 *
 * export default function SitesPage() {
 *   const [sites, setSites]     = useState<Site[]>([]);
 *   const [loading, setLoading] = useState(true);
 *   const [error, setError]     = useState('');
 *   const [showModal, setShowModal] = useState(false);
 *   const [editing, setEditing] = useState<Site | null>(null);
 *   const [form, setForm]       = useState({ ...EMPTY_FORM });
 *   const [saving, setSaving]   = useState(false);
 *   const [formError, setFormError] = useState('');
 *
 *   async function load() {
 *     setLoading(true);
 *     try {
 *       const s = await getAllSites();
 *       setSites(s.sort((a, b) => a.name.localeCompare(b.name)));
 *     } catch { setError('Failed to load sites.'); }
 *     setLoading(false);
 *   }
 *
 *   useEffect(() => { load(); }, []);
 *
 *   function openAdd() {
 *     setEditing(null);
 *     setForm({ ...EMPTY_FORM });
 *     setFormError('');
 *     setShowModal(true);
 *   }
 *
 *   function openEdit(s: Site) {
 *     setEditing(s);
 *     setForm({
 *       name: s.name,
 *       latitude: s.latitude.toString(),
 *       longitude: s.longitude.toString(),
 *       geofenceRadius: s.geofenceRadius.toString(),
 *     });
 *     setFormError('');
 *     setShowModal(true);
 *   }
 *
 *   async function handleSave() {
 *     setFormError('');
 *     if (!form.name.trim()) { setFormError('Site name is required.'); return; }
 *     const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude), radius = parseFloat(form.geofenceRadius);
 *     if (isNaN(lat) || isNaN(lng)) { setFormError('Valid latitude and longitude are required.'); return; }
 *     setSaving(true);
 *     try {
 *       if (editing) {
 *         await updateSite(editing.id, { name: form.name.trim(), latitude: lat, longitude: lng, geofenceRadius: radius });
 *       } else {
 *         await createSite({ name: form.name.trim(), latitude: lat, longitude: lng, geofenceRadius: radius });
 *       }
 *       setShowModal(false);
 *       await load();
 *     } catch (e: unknown) {
 *       setFormError(e instanceof Error ? e.message : 'Save failed.');
 *     }
 *     setSaving(false);
 *   }
 *
 *   async function handleDelete() {
 *     if (!editing) return;
 *     const confirmed = window.confirm(`Delete "${editing.name}"? This cannot be undone.`);
 *     if (!confirmed) return;
 *     setSaving(true);
 *     try {
 *       await deleteSite(editing.id);
 *       setShowModal(false);
 *       await load();
 *     } catch (e: unknown) {
 *       setFormError(e instanceof Error ? e.message : 'Delete failed. Try again.');
 *     }
 *     setSaving(false);
 *   }
 *
 *   return (
 *     <div>
 *       <div className="flex items-center justify-between mb-8">
 *         <div>
 *           <h1 className="text-2xl font-bold text-text-primary">Site Management</h1>
 *           <p className="text-text-secondary text-sm mt-1">{sites.length} sites</p>
 *         </div>
 *         <button className="btn-primary" onClick={openAdd}>+ Add Site</button>
 *       </div>
 *       {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
 *       <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
 *         {loading ? (
 *           [1,2,3].map(i => <div key={i} className="card animate-pulse h-32" />)
 *         ) : sites.length === 0 ? (
 *           <div className="col-span-3 card text-center text-text-secondary py-12">No sites yet. Add one to get started.</div>
 *         ) : sites.map(site => (
 *           <div key={site.id} className="card hover:border-primary/40 transition-colors">
 *             <div className="flex items-start justify-between mb-3">
 *               <h3 className="font-bold text-text-primary">{site.name}</h3>
 *               <button className="text-primary text-xs font-medium hover:underline ml-3 shrink-0" onClick={() => openEdit(site)}>Edit</button>
 *             </div>
 *             <p className="text-xs text-text-secondary mb-1">📍 {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}</p>
 *             <p className="text-xs text-text-secondary">⭕ {site.geofenceRadius}m geofence</p>
 *           </div>
 *         ))}
 *       </div>
 *       {showModal && (
 *         <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
 *           <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
 *             <h2 className="text-lg font-bold text-text-primary mb-5">{editing ? 'Edit Site' : 'Add Site'}</h2>
 *             <div className="space-y-4">
 *               <div><label className="label">Site Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Senken Gurugaon Site" /></div>
 *               <div className="grid grid-cols-2 gap-3">
 *                 <div><label className="label">Latitude</label><input className="input" type="number" step="any" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} placeholder="28.4595" /></div>
 *                 <div><label className="label">Longitude</label><input className="input" type="number" step="any" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} placeholder="77.0266" /></div>
 *               </div>
 *               <div><label className="label">Geofence Radius (metres)</label><input className="input" type="number" value={form.geofenceRadius} onChange={e => setForm(f => ({ ...f, geofenceRadius: e.target.value }))} /></div>
 *               {formError && <p className="text-red-500 text-sm">{formError}</p>}
 *               <div className="flex gap-3 pt-2">
 *                 <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Site'}</button>
 *                 <button className="btn-outline flex-1" onClick={() => setShowModal(false)}>Cancel</button>
 *               </div>
 *               {editing && (
 *                 <div className="pt-1 border-t border-border">
 *                   <button className="btn-danger w-full" onClick={handleDelete} disabled={saving}>Delete Site</button>
 *                 </div>
 *               )}
 *             </div>
 *           </div>
 *         </div>
 *       )}
 *     </div>
 *   );
 * }
 */
