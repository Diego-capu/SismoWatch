import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  Shield, 
  Radio, 
  MapPin, 
  Calendar, 
  Download, 
  FileText, 
  RotateCw, 
  Filter, 
  LogOut, 
  Sparkles, 
  Database, 
  Cpu, 
  CheckCircle, 
  XCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Sliders
} from 'lucide-react';

declare const L: any;

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

interface User {
  username: string;
  role: 'admin' | 'viewer';
  token: string;
}

interface KPI {
  total_events_24h: number;
  max_magnitude_24h: number;
  avg_magnitude_24h: number;
  tsunami_alerts_24h: number;
  quality_score: number;
  last_updated: string | null;
  status: string;
}

interface Earthquake {
  id: string;
  magnitude: number;
  place: string;
  region: string;
  event_time: string;
  longitude: number;
  latitude: number;
  depth_km: number;
  tsunami: number;
  url: string;
}

interface AIReport {
  id: number;
  report_date: string;
  executive_summary: string;
  high_activity_zones: Array<{ region: string; event_count: number; max_magnitude: number }>;
  notable_events: Array<{ id: string; magnitude: number; place: string; region: string; event_time: string }>;
  total_events: number;
  max_magnitude: number;
  avg_magnitude: number;
  tsunami_alerts: number;
  anomalies_detected: Array<{ region: string; event_count: number; z_score: number; severity: string; explanation: string }>;
  source: string;
  created_at: string;
  model?: string;
  tokens?: number;
  latency_ms?: number;
}

interface QuarantineAudit {
  architecture_notice: string;
  in_memory_validation_engine: string;
  raw_backup_layer: string;
  total_runs_evaluated: number;
  total_records_evaluated: number;
  total_records_discarded: number;
  global_quality_score: number;
  discard_reasons_summary: Record<string, number>;
  recent_runs: Array<{
    id: number;
    dag_run_id: string;
    execution_time: string;
    total_evaluated: number;
    total_valid: number;
    total_discarded: number;
    quality_score: number;
    discard_reasons: Record<string, any>;
  }>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('sismowatch_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'reports' | 'admin'>('dashboard');
  const [kpis, setKpis] = useState<KPI | null>(null);
  const [events, setEvents] = useState<Earthquake[]>([]);
  const [reports, setReports] = useState<AIReport[]>([]);
  const [quarantineAudit, setQuarantineAudit] = useState<QuarantineAudit | null>(null);
  
  // Realtime & Loading States
  const [isLive, setIsLive] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);

  // Filters
  const [minMagnitude, setMinMagnitude] = useState<number>(0);
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');

  // Login Form State
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Map references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);

  // ---------------------------------------------------------------------------
  // Authentication Handling
  // ---------------------------------------------------------------------------
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });

      if (!res.ok) {
        throw new Error('Credenciales incorrectas o usuario no encontrado');
      }

      const data = await res.json();
      const userData: User = {
        username: data.username,
        role: data.role,
        token: data.access_token,
      };

      setUser(userData);
      localStorage.setItem('sismowatch_user', JSON.stringify(userData));
    } catch (err: any) {
      setLoginError(err.message || 'Error al autenticar');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('sismowatch_user');
  };

  const quickLogin = (u: string, p: string) => {
    setLoginUser(u);
    setLoginPass(p);
  };

  // ---------------------------------------------------------------------------
  // Data Fetching: KPIs, Events, Reports
  // ---------------------------------------------------------------------------
  const authHeaders = {
    Authorization: `Bearer ${user?.token || ''}`,
    'Content-Type': 'application/json',
  };

  const fetchDashboardData = async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 1. Fetch KPIs
      const kpiRes = await fetch(`${API_BASE}/api/kpis`, { headers: authHeaders });
      if (kpiRes.status === 401) { handleLogout(); return; }
      if (kpiRes.ok) {
        const kpiData = await kpiRes.json();
        setKpis(kpiData);
      }

      // 2. Fetch Events
      let url = `${API_BASE}/api/events?limit=150`;
      if (minMagnitude > 0) url += `&min_mag=${minMagnitude}`;
      if (regionFilter) url += `&region=${encodeURIComponent(regionFilter)}`;

      const evRes = await fetch(url, { headers: authHeaders });
      if (evRes.ok) {
        const evData = await evRes.json();
        setEvents(evData.items || []);
      }
    } catch (err: any) {
      setErrorMessage('No se pudo conectar al servidor de datos. Reintentando...');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReports = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/api/reports?limit=20`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setReports(data || []);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    }
  };

  const fetchQuarantineAudit = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const res = await fetch(`${API_BASE}/api/quality/quarantine`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setQuarantineAudit(data);
      }
    } catch (err) {
      console.error('Error fetching quarantine audit:', err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchDashboardData();
      fetchReports();
      if (user.role === 'admin') {
        fetchQuarantineAudit();
      }
    }
  }, [user, minMagnitude, regionFilter]);

  // ---------------------------------------------------------------------------
  // Server-Sent Events (SSE) Live Stream
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;

    const setupSSE = () => {
      // In web browsers, native EventSource cannot set custom headers, so the JWT token
      // is passed safely via query param ?token=... to authenticate the live stream:
      const sseUrl = `${API_BASE}/api/stream?token=${encodeURIComponent(user.token)}`;
      eventSource = new EventSource(sseUrl);

      eventSource.onopen = () => {
        setIsLive(true);
        setLastHeartbeat(new Date().toLocaleTimeString());
      };

      eventSource.addEventListener('heartbeat', (e: any) => {
        setIsLive(true);
        setLastHeartbeat(new Date().toLocaleTimeString());
      });

      eventSource.addEventListener('seismic_update', (e: any) => {
        setIsLive(true);
        setLastHeartbeat(new Date().toLocaleTimeString());
        try {
          const newQuakes = JSON.parse(e.data);
          if (Array.isArray(newQuakes) && newQuakes.length > 0) {
            setEvents(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const uniqueNew = newQuakes.filter(q => !existingIds.has(q.id));
              return [...uniqueNew, ...prev].slice(0, 150);
            });
          }
        } catch (err) {
          console.error('SSE JSON error:', err);
        }
      });

      eventSource.onerror = () => {
        setIsLive(false);
        if (eventSource) eventSource.close();
        reconnectTimeout = setTimeout(setupSSE, 10000); // Reconnect in 10s
      };
    };

    setupSSE();

    // Auto-refresh fallback every 30s
    const pollInterval = setInterval(() => {
      fetchDashboardData();
    }, 30000);

    return () => {
      if (eventSource) eventSource.close();
      clearTimeout(reconnectTimeout);
      clearInterval(pollInterval);
    };
  }, [user]);

  // ---------------------------------------------------------------------------
  // Leaflet Map Initialization & Rendering
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (activeTab !== 'dashboard' || !mapContainerRef.current || typeof L === 'undefined') return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [20.0, 0.0],
        zoom: 2,
        minZoom: 1,
        maxZoom: 12,
        worldCopyJump: true,
      });

      const cartoApiKey = (import.meta as any).env?.VITE_CARTO_API_KEY || '';
      const cartoParam = cartoApiKey ? `?api_key=${cartoApiKey}` : '';

      const cartoDarkLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${cartoParam}`,
        {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
        }
      );

      const cartoVoyagerLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${cartoParam}`,
        {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
        }
      );

      const esriDarkLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
          maxZoom: 16,
        }
      );

      const satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, USGS, NOAA',
          maxZoom: 18,
        }
      );

      // Si hay API key de Carto configurada se activa Carto por defecto; de lo contrario Esri
      const defaultLayer = cartoApiKey ? cartoDarkLayer : esriDarkLayer;
      defaultLayer.addTo(map);

      // Selector de capas interactivo en el mapa
      L.control.layers(
        {
          'Carto Dark Matter': cartoDarkLayer,
          'Carto Voyager (Calles & Color)': cartoVoyagerLayer,
          'Esri Dark Gray': esriDarkLayer,
          'Satélite Global (Esri)': satelliteLayer,
        },
        {},
        { position: 'topright' }
      ).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    // Refresh markers
    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers();

      events.forEach(q => {
        if (!q.latitude || !q.longitude) return;

        let color = '#22c55e'; // Green < 4.0
        let radius = 5;
        if (q.magnitude >= 6.5) {
          color = '#ef4444'; // Red >= 6.5
          radius = 12;
        } else if (q.magnitude >= 5.0) {
          color = '#f97316'; // Orange 5.0 - 6.4
          radius = 9;
        } else if (q.magnitude >= 4.0) {
          color = '#eab308'; // Yellow 4.0 - 4.9
          radius = 7;
        }

        const marker = L.circleMarker([q.latitude, q.longitude], {
          radius: radius,
          fillColor: color,
          color: '#ffffff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.85,
        });

        const popupContent = `
          <div style="font-family: sans-serif; font-size: 12px; color: #0f172a; min-width: 180px;">
            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; color: ${color};">
              Magnitud ${q.magnitude.toFixed(1)}
            </div>
            <div><strong>Ubicación:</strong> ${q.place || 'Desconocida'}</div>
            <div><strong>Región:</strong> ${q.region || 'N/A'}</div>
            <div><strong>Profundidad:</strong> ${q.depth_km} km</div>
            <div><strong>Fecha:</strong> ${new Date(q.event_time).toLocaleString()}</div>
            ${q.tsunami ? '<div style="color: #dc2626; font-weight: bold; margin-top: 4px;">⚠️ ALERTA TSUNAMI</div>' : ''}
            ${q.url ? `<div style="margin-top: 6px;"><a href="${q.url}" target="_blank" style="color: #0284c7; text-decoration: underline;">Ver en USGS &rarr;</a></div>` : ''}
          </div>
        `;
        marker.bindPopup(popupContent);
        markersLayerRef.current.addLayer(marker);
      });
    }
  }, [activeTab, events]);

  // ---------------------------------------------------------------------------
  // Admin Operations
  // ---------------------------------------------------------------------------
  const handleTriggerBackfill = async (days: number) => {
    setAdminActionStatus('Lanzando backfill histórico en Airflow...');
    try {
      const res = await fetch(`${API_BASE}/api/admin/backfill`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ days: days }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdminActionStatus(`Éxito: ${data.message}`);
        setTimeout(fetchDashboardData, 3000);
      } else {
        setAdminActionStatus(`Error: ${data.detail || 'Fallo al ejecutar backfill'}`);
      }
    } catch (err: any) {
      setAdminActionStatus(`Error de conexión: ${err.message}`);
    }
  };

  const handleRegenerateReport = async () => {
    setAdminActionStatus('Solicitando regeneración de reporte AI...');
    try {
      const res = await fetch(`${API_BASE}/api/admin/reports/regenerate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdminActionStatus(`Éxito: ${data.message}`);
        setTimeout(fetchReports, 3000);
      } else {
        setAdminActionStatus(`Error: ${data.detail || 'Fallo al regenerar reporte'}`);
      }
    } catch (err: any) {
      setAdminActionStatus(`Error de conexión: ${err.message}`);
    }
  };

  const handleTestViewerForbidden = async () => {
    // Tests 403 Forbidden verification directly
    setAdminActionStatus('Verificando RBAC: Intentando acción admin con credenciales actuales...');
    try {
      const res = await fetch(`${API_BASE}/api/admin/backfill`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ days: 1 }),
      });
      if (res.status === 403) {
        setAdminActionStatus('Seguridad validada: El backend rechazó la petición con código 403 Forbidden (Acceso denegado).');
      } else if (res.ok) {
        setAdminActionStatus('Acción autorizada: Tienes rol de Administrador.');
      } else {
        const data = await res.json();
        setAdminActionStatus(`Respuesta del servidor (${res.status}): ${data.detail}`);
      }
    } catch (err: any) {
      setAdminActionStatus(`Error: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Render: Login Screen if not authenticated
  // ---------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <div className="p-3 bg-red-600/20 text-red-500 rounded-xl border border-red-500/30">
              <Activity className="w-8 h-8 animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">SismoWatch</h1>
              <p className="text-xs text-slate-400">Inteligencia y Monitoreo Sísmico Global</p>
            </div>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-950/60 border border-red-800 text-red-200 text-sm rounded-lg flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Usuario
              </label>
              <input
                type="text"
                value={loginUser}
                onChange={e => setLoginUser(e.target.value)}
                placeholder="admin o viewer"
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Contraseña
              </label>
              <input
                type="password"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm rounded-lg transition-colors shadow-lg shadow-cyan-900/40 flex items-center justify-center space-x-2"
            >
              {isLoading ? <RotateCw className="w-4 h-4 animate-spin" /> : <span>Iniciar Sesión</span>}
            </button>
          </form>

          {/* Quick Access Pills */}
          <div className="mt-8 pt-6 border-t border-slate-800">
            <p className="text-xs text-slate-400 text-center mb-3">Acceso Rápido para Demostración:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => quickLogin('admin', 'admin123')}
                className="p-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-lg text-left text-xs transition"
              >
                <div className="font-semibold text-cyan-400 flex items-center space-x-1">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin</span>
                </div>
                <div className="text-[11px] text-slate-400">admin / admin123</div>
              </button>

              <button
                type="button"
                onClick={() => quickLogin('viewer', 'viewer123')}
                className="p-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-lg text-left text-xs transition"
              >
                <div className="font-semibold text-emerald-400 flex items-center space-x-1">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Viewer</span>
                </div>
                <div className="text-[11px] text-slate-400">viewer / viewer123</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Main Authenticated Platform
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-600/20 text-red-500 rounded-lg border border-red-500/30">
                <Activity className="w-5 h-5 animate-pulse" />
              </div>
              <span className="font-bold text-lg text-white tracking-tight">SismoWatch</span>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex space-x-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  activeTab === 'dashboard'
                    ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('reports')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 ${
                  activeTab === 'reports'
                    ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Reportes IA</span>
              </button>

              {user.role === 'admin' ? (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 ${
                    activeTab === 'admin'
                      ? 'bg-slate-800 text-amber-400 border border-slate-700'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>Centro de Control</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-500 self-center px-2 italic">
                  (Control Admin restringido)
                </span>
              )}
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            {/* Live Indicator */}
            <div className="flex items-center space-x-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-full text-xs">
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'}`} />
              <span className="text-[11px] font-semibold tracking-wide text-slate-300">
                {isLive ? 'EN VIVO' : 'CONECTANDO'}
              </span>
              {lastHeartbeat && (
                <span className="text-[10px] text-slate-500 border-l border-slate-800 pl-2">
                  {lastHeartbeat}
                </span>
              )}
            </div>

            {/* User Badge */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-300 font-medium">{user.username}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                user.role === 'admin' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              }`}>
                {user.role}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {errorMessage && (
          <div className="mb-4 p-3 bg-amber-950/40 border border-amber-800 text-amber-200 text-xs rounded-lg flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={fetchDashboardData} className="px-2 py-1 bg-amber-800 text-white rounded text-[11px]">
              Reintentar
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 1: DASHBOARD                                                    */}
        {/* =================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* 6 High-Level KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Sismos (24h)</span>
                <div className="text-2xl font-bold text-white mt-1 flex items-baseline justify-between">
                  <span>{kpis ? kpis.total_events_24h : '...'}</span>
                  <Activity className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="text-[10px] text-slate-500">Mundial verificado</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Magnitud Máx.</span>
                <div className="text-2xl font-bold text-amber-400 mt-1 flex items-baseline justify-between">
                  <span>{kpis ? kpis.max_magnitude_24h.toFixed(1) : '...'}</span>
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                </div>
                <span className="text-[10px] text-slate-500">Pico más severo</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Mag. Promedio</span>
                <div className="text-2xl font-bold text-white mt-1 flex items-baseline justify-between">
                  <span>{kpis ? kpis.avg_magnitude_24h.toFixed(2) : '...'}</span>
                  <Sliders className="w-4 h-4 text-slate-400" />
                </div>
                <span className="text-[10px] text-slate-500">Promedio normal</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Alertas Tsunami</span>
                <div className="text-2xl font-bold text-red-500 mt-1 flex items-baseline justify-between">
                  <span>{kpis ? kpis.tsunami_alerts_24h : '0'}</span>
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                </div>
                <span className="text-[10px] text-slate-500">Avisos activos</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Calidad Pandera</span>
                <div className="text-2xl font-bold text-emerald-400 mt-1 flex items-baseline justify-between">
                  <span>{kpis ? `${kpis.quality_score.toFixed(1)}%` : '...'}</span>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-[10px] text-slate-500">En memoria (sin drop DB)</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Estado Pipeline</span>
                <div className="text-sm font-bold text-emerald-400 mt-2 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>{kpis ? kpis.status : 'CONECTANDO'}</span>
                </div>
                <span className="text-[10px] text-slate-500">Airflow TaskFlow</span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-300">Filtros:</span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Mag. Mínima ({minMagnitude}):</span>
                  <input
                    type="range"
                    min="0"
                    max="7"
                    step="0.5"
                    value={minMagnitude}
                    onChange={e => setMinMagnitude(parseFloat(e.target.value))}
                    className="w-28 accent-cyan-500"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="Filtrar por región..."
                    value={regionFilter}
                    onChange={e => setRegionFilter(e.target.value)}
                    className="px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { setMinMagnitude(0); setRegionFilter(''); }}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white rounded border border-slate-800 hover:bg-slate-800 transition"
                >
                  Restablecer
                </button>
                <button
                  onClick={fetchDashboardData}
                  className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded flex items-center space-x-1 transition"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Refrescar</span>
                </button>
              </div>
            </div>

            {/* Interactive Leaflet Seismic Map */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Mapa Sísmico Global Interactivo</h3>
                </div>
                <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                    <span>&lt; 4.0</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
                    <span>4.0 - 4.9</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
                    <span>5.0 - 6.4</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                    <span>&ge; 6.5</span>
                  </span>
                </div>
              </div>

              <div 
                ref={mapContainerRef} 
                className="w-full h-96 rounded-lg overflow-hidden border border-slate-800"
                style={{ background: '#020617' }}
              />
            </div>

            {/* Events Feed Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Últimos Eventos Curados en Tiempo Real</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <a
                    href={`${API_BASE}/api/reports/export?format=csv&type=events`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center space-x-1 transition border border-slate-700"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Exportar CSV</span>
                  </a>
                  <a
                    href={`${API_BASE}/api/reports/export?format=html&type=events`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center space-x-1 transition border border-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    <span>Exportar HTML</span>
                  </a>
                </div>
              </div>

              {events.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No hay sismos que coincidan con los filtros aplicados.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                        <th className="py-2.5 px-3">Magnitud</th>
                        <th className="py-2.5 px-3">Ubicación</th>
                        <th className="py-2.5 px-3">Región</th>
                        <th className="py-2.5 px-3">Profundidad</th>
                        <th className="py-2.5 px-3">Fecha y Hora (UTC)</th>
                        <th className="py-2.5 px-3 text-right">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {events.map(ev => {
                        let badgeColor = 'bg-green-500/10 text-green-400 border-green-500/30';
                        if (ev.magnitude >= 6.5) badgeColor = 'bg-red-500/20 text-red-400 border-red-500/40 font-bold';
                        else if (ev.magnitude >= 5.0) badgeColor = 'bg-orange-500/20 text-orange-400 border-orange-500/40';
                        else if (ev.magnitude >= 4.0) badgeColor = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';

                        return (
                          <tr key={ev.id} className="hover:bg-slate-800/40 transition">
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] border ${badgeColor}`}>
                                M {ev.magnitude.toFixed(1)}
                              </span>
                              {ev.tsunami ? (
                                <span className="ml-1.5 text-red-400" title="Alerta de Tsunami">🌊</span>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-200">{ev.place}</td>
                            <td className="py-2.5 px-3 text-slate-400">{ev.region}</td>
                            <td className="py-2.5 px-3 text-slate-400">{ev.depth_km} km</td>
                            <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                              {new Date(ev.event_time).toISOString().replace('T', ' ').substring(0, 19)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {ev.url ? (
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-cyan-400 hover:text-cyan-300 inline-flex items-center space-x-0.5"
                                >
                                  <span>USGS</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: AI EXECUTIVE REPORTS                                         */}
        {/* =================================================================== */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  <span>Reportes Ejecutivos Generados por IA</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Resúmenes sintéticos fundamentados en hechos determinísticos, anti-alucinaciones y detección de anomalías Z-Score.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <a
                  href={`${API_BASE}/api/reports/export?format=csv&type=reports`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Exportar CSV</span>
                </a>
                <a
                  href={`${API_BASE}/api/reports/export?format=html&type=reports`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                  <span>Exportar HTML</span>
                </a>
              </div>
            </div>

            {reports.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
                Aún no hay reportes generados. El DAG diario corre a la 01:00 UTC, o un Administrador puede lanzarlo desde el Centro de Control.
              </div>
            ) : (
              <div className="space-y-4">
                {reports.map(rep => (
                  <div key={rep.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-sm text-white">Informe Diario: {rep.report_date}</span>
                        <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                          {rep.source}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                        {rep.model && (
                          <span className="flex items-center space-x-1">
                            <Cpu className="w-3.5 h-3.5 text-slate-400" />
                            <span>Modelo: {rep.model}</span>
                          </span>
                        )}
                        {rep.tokens !== undefined && <span>{rep.tokens} tokens</span>}
                        {rep.latency_ms !== undefined && <span>{rep.latency_ms} ms</span>}
                      </div>
                    </div>

                    {/* Executive Narrative */}
                    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg">
                      <p className="text-xs text-slate-200 leading-relaxed font-sans">
                        {rep.executive_summary}
                      </p>
                    </div>

                    {/* Fact Metrics Bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                        <span className="text-[10px] uppercase text-slate-400">Total Sismos</span>
                        <div className="text-base font-bold text-white">{rep.total_events}</div>
                      </div>
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                        <span className="text-[10px] uppercase text-slate-400">Magnitud Máx.</span>
                        <div className="text-base font-bold text-amber-400">{rep.max_magnitude.toFixed(1)}</div>
                      </div>
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                        <span className="text-[10px] uppercase text-slate-400">Promedio</span>
                        <div className="text-base font-bold text-white">{rep.avg_magnitude.toFixed(2)}</div>
                      </div>
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                        <span className="text-[10px] uppercase text-slate-400">Alertas Tsunami</span>
                        <div className="text-base font-bold text-red-400">{rep.tsunami_alerts}</div>
                      </div>
                    </div>

                    {/* Statistical Anomalies Section */}
                    {rep.anomalies_detected && rep.anomalies_detected.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <span className="text-xs font-semibold text-amber-400 flex items-center space-x-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Anomalías Estadísticas Detectadas (Z-Score &ge; 2.0)</span>
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {rep.anomalies_detected.map((anom, idx) => (
                            <div key={idx} className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-amber-200">{anom.region}</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                  Z = {anom.z_score.toFixed(2)} ({anom.severity})
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-300">{anom.explanation}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: ADMIN CONTROL CENTER                                         */}
        {/* =================================================================== */}
        {activeTab === 'admin' && user.role === 'admin' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Shield className="w-5 h-5 text-amber-400" />
                <span>Centro de Control y Auditoría de Arquitectura (Admin)</span>
              </h2>
              <p className="text-xs text-slate-400">
                Lanzamiento de tareas orquestadas, control de cargas históricas y supervisión del motor de calidad en memoria.
              </p>
            </div>

            {adminActionStatus && (
              <div className="p-3 bg-slate-900 border border-cyan-800 text-cyan-200 text-xs rounded-lg flex items-center justify-between">
                <span>{adminActionStatus}</span>
                <button onClick={() => setAdminActionStatus(null)} className="text-slate-400 hover:text-white text-xs">
                  ✕
                </button>
              </div>
            )}

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Backfill Histórico (30 Días)</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Ejecuta una ingesta masiva parametrizada desde la API de USGS para los últimos 30 días con deduplicación por ID.
                </p>
                <div className="flex items-center space-x-2 pt-2">
                  <button
                    onClick={() => handleTriggerBackfill(30)}
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs rounded-lg transition"
                  >
                    Lanzar Backfill (30 Días)
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-semibold text-white">Regenerar Reporte Diario IA</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Activa el DAG <code>daily_ai_report_dag</code> para reevaluar la actividad sísmica y actualizar las narrativas.
                </p>
                <div className="flex items-center space-x-2 pt-2">
                  <button
                    onClick={handleRegenerateReport}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs rounded-lg transition"
                  >
                    Regenerar Informe Ahora
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Simulador de Seguridad RBAC</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Prueba la protección del backend verificando que los accesos sin privilegios reciben 403 Forbidden.
                </p>
                <div className="flex items-center space-x-2 pt-2">
                  <button
                    onClick={handleTestViewerForbidden}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-lg border border-slate-700 transition"
                  >
                    Verificar Estado RBAC
                  </button>
                </div>
              </div>
            </div>

            {/* In-Memory Quality & Quarantine Audit Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Auditoría de Calidad en Memoria (Restricción de Negocio)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Evidencia de cumplimiento: NO se implementa tabla de cuarentena física. Los datos inválidos se filtran en memoria con Pandera y se auditan aquí.
                </p>
              </div>

              {quarantineAudit && (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-950 border border-cyan-900/40 rounded-lg text-xs text-cyan-200 font-mono">
                    {quarantineAudit.architecture_notice}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <span className="text-[10px] uppercase text-slate-400">Total Evaluados</span>
                      <div className="text-lg font-bold text-white">{quarantineAudit.total_records_evaluated}</div>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <span className="text-[10px] uppercase text-slate-400">Descartados en Memoria</span>
                      <div className="text-lg font-bold text-amber-400">{quarantineAudit.total_records_discarded}</div>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <span className="text-[10px] uppercase text-slate-400">Score Global</span>
                      <div className="text-lg font-bold text-emerald-400">{quarantineAudit.global_quality_score}%</div>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <span className="text-[10px] uppercase text-slate-400">Capa de Respaldo</span>
                      <div className="text-xs font-bold text-slate-300 mt-1">raw.earthquakes</div>
                    </div>
                  </div>

                  {/* Discard Reasons Breakdown */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 mb-2">Desglose de Reglas Rechazadas:</h4>
                    {Object.keys(quarantineAudit.discard_reasons_summary).length === 0 ? (
                      <p className="text-xs text-emerald-400">
                        ✓ Cero registros rechazados: Todas las ingestas recientes cumplieron el 100% de las reglas de calidad de Pandera.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {Object.entries(quarantineAudit.discard_reasons_summary).map(([reason, count]) => (
                          <div key={reason} className="p-2.5 bg-slate-950 border border-slate-800 rounded text-xs flex justify-between">
                            <span className="text-slate-300 font-mono text-[11px]">{reason}</span>
                            <span className="text-amber-400 font-bold">{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <p>SismoWatch &copy; 2026 &mdash; Plataforma de Inteligencia Sísmica en Tiempo Casi Real</p>
      </footer>
    </div>
  );
}
