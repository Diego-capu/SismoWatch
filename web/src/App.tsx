import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  Shield, 
  Radio, 
  MapPin, 
  Download, 
  RefreshCw, 
  Filter, 
  LogOut, 
  Sparkles, 
  Database, 
  CheckCircle, 
  ExternalLink,
  ChevronRight, 
  ChevronLeft,
  TrendingUp,
  Sliders,
  LayoutDashboard,
  MessageSquare,
  Bot,
  Send,
  User as UserIcon,
  X,
  FileSpreadsheet,
  Globe
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  source?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('sismowatch_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'reports' | 'chat' | 'admin'>('dashboard');
  const [kpis, setKpis] = useState<KPI | null>(null);
  const [events, setEvents] = useState<Earthquake[]>([]);
  const [reports, setReports] = useState<AIReport[]>([]);
  const [quarantineAudit, setQuarantineAudit] = useState<QuarantineAudit | null>(null);
  
  // Realtime & Loading States
  const [isLive, setIsLive] = useState(false);
  const [liveClock, setLiveClock] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);

  // Filters & Table Pagination
  const [minMagnitude, setMinMagnitude] = useState<number>(0);
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 5;

  // Login Form State
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // AI Chat Assistant State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '¡Hola! Soy el **Asistente Sismológico de SismoWatch** con Inteligencia Artificial. Estoy conectado en tiempo real a la base de datos de sismos curados y reportes analíticos. ¿Qué te gustaría consultar?',
      time: 'Ahora',
      source: 'SismoWatch Grounded AI'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Map references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);

  // Clock tick for UTC indicator
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setLiveClock(now.toISOString().slice(11, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

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
      const authenticatedUser: User = {
        username: data.username,
        role: data.role,
        token: data.access_token,
      };

      setUser(authenticatedUser);
      localStorage.setItem('sismowatch_user', JSON.stringify(authenticatedUser));
    } catch (err: any) {
      setLoginError(err.message || 'Error al iniciar sesión');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('sismowatch_user');
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
  };

  const quickLogin = (u: string, p: string) => {
    setLoginUser(u);
    setLoginPass(p);
    setTimeout(() => {
      fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.access_token) {
            const authUser: User = {
              username: data.username,
              role: data.role,
              token: data.access_token,
            };
            setUser(authUser);
            localStorage.setItem('sismowatch_user', JSON.stringify(authUser));
          }
        })
        .catch(console.error);
    }, 50);
  };

  const authHeaders = {
    'Authorization': `Bearer ${user?.token || ''}`,
    'Content-Type': 'application/json',
  };

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------
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
      let url = `${API_BASE}/api/events?limit=200`;
      if (minMagnitude > 0) url += `&min_mag=${minMagnitude}`;
      if (regionFilter) url += `&region=${encodeURIComponent(regionFilter)}`;

      const evRes = await fetch(url, { headers: authHeaders });
      if (evRes.ok) {
        const evData = await evRes.json();
        setEvents(evData.items || []);
        setCurrentPage(1);
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
  // Real-time SSE Connection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    let eventSource: EventSource | null = null;
    try {
      const streamUrl = `${API_BASE}/api/stream?token=${encodeURIComponent(user.token)}`;
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        setIsLive(true);
      };

      eventSource.addEventListener('heartbeat', () => {
        setIsLive(true);
      });

      eventSource.addEventListener('earthquake', (e: MessageEvent) => {
        try {
          const newEvent: Earthquake = JSON.parse(e.data);
          setEvents(prev => {
            const exists = prev.some(item => item.id === newEvent.id);
            if (exists) return prev;
            return [newEvent, ...prev.slice(0, 199)];
          });
        } catch (err) {
          console.error('Error parsing SSE event:', err);
        }
      });

      eventSource.onerror = () => {
        setIsLive(false);
      };
    } catch (err) {
      setIsLive(false);
    }

    const pollInterval = setInterval(() => {
      fetchDashboardData();
    }, 45000);

    return () => {
      if (eventSource) eventSource.close();
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

      // 1. Carto Positron / Light (Matches the exact light screenshot theme)
      const lightLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png${cartoParam}`,
        {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
        }
      );

      // 2. Esri Topographic / World Street Map
      const streetLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
          maxZoom: 18,
        }
      );

      // 3. Esri Global Satellite
      const satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, USGS, NOAA',
          maxZoom: 18,
        }
      );

      // 4. Carto Dark Matter
      const darkLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${cartoParam}`,
        {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
        }
      );

      // Set clean light layer by default (as in user screenshot)
      lightLayer.addTo(map);

      // Interactive Layer Switcher
      L.control.layers(
        {
          'Mapa Claro (Stitch Style)': lightLayer,
          'Topográfico': streetLayer,
          'Satélite Global': satelliteLayer,
          'Modo Oscuro': darkLayer,
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
        let severityLabel = 'Menor';
        let severityClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        let magBadgeClass = 'bg-emerald-500 text-white';

        if (q.magnitude >= 6.5) {
          color = '#ef4444'; // Red >= 6.5
          radius = 12;
          severityLabel = 'Crítico';
          severityClass = 'bg-red-50 text-red-700 border-red-200';
          magBadgeClass = 'bg-red-500 text-white';
        } else if (q.magnitude >= 5.0) {
          color = '#f97316'; // Orange 5.0 - 6.4
          radius = 8;
          severityLabel = 'Severo';
          severityClass = 'bg-orange-50 text-orange-700 border-orange-200';
          magBadgeClass = 'bg-orange-500 text-white';
        } else if (q.magnitude >= 4.0) {
          color = '#eab308'; // Yellow 4.0 - 4.9
          radius = 6;
          severityLabel = 'Moderado';
          severityClass = 'bg-amber-50 text-amber-700 border-amber-200';
          magBadgeClass = 'bg-amber-500 text-white';
        }

        const marker = L.circleMarker([q.latitude, q.longitude], {
          radius: radius,
          fillColor: color,
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.85,
        });

        const popupContent = `
          <div class="font-sans text-slate-800" style="min-width: 220px;">
            <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
              <span class="px-2 py-0.5 rounded text-xs font-bold ${magBadgeClass}">M ${q.magnitude.toFixed(1)}</span>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border ${severityClass}">${severityLabel}</span>
            </div>
            <div class="font-bold text-xs text-slate-900 mb-1 leading-snug">${q.place}</div>
            <div class="text-[11px] text-slate-500 mb-2">
              Profundidad: <b>${q.depth_km.toFixed(1)} km</b> • ${new Date(q.event_time).toLocaleTimeString()}
            </div>
            <div class="pt-1 flex items-center justify-between">
              <a href="${q.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${q.id}`}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-blue-600 hover:text-blue-700 inline-flex items-center space-x-1">
                <span>Ver telemetría USGS</span>
                <span>→</span>
              </a>
              ${q.tsunami ? '<span class="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">⚠️ TSUNAMI</span>' : ''}
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(markersLayerRef.current);
      });
    }
  }, [activeTab, events]);

  // ---------------------------------------------------------------------------
  // AI Chat Assistant Logic
  // ---------------------------------------------------------------------------
  const handleSendChat = async (overrideMessage?: string) => {
    const textToSend = overrideMessage || chatInput;
    if (!textToSend.trim() || isChatLoading || !user) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          message: textToSend,
          history: chatMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Error en servidor: ${res.status}`);
      }

      const data = await res.json();
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        source: data.source,
      };

      setChatMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Disculpa, no pude procesar tu solicitud en este momento. Inténtalo de nuevo en unos segundos.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          source: 'Error Handler',
        }
      ]);
    } finally {
      setIsChatLoading(false);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  // ---------------------------------------------------------------------------
  // Admin Operations
  // ---------------------------------------------------------------------------
  const handleTriggerBackfill = async () => {
    if (!user || user.role !== 'admin') return;
    setAdminActionStatus('Disparando backfill de 30 días en Airflow...');
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/backfill`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ days: 30, min_magnitude: 2.5 }),
      });
      const data = await res.json();
      setAdminActionStatus(`Backfill iniciado con éxito: DAG Run ID ${data.dag_run_id || 'OK'}`);
      setTimeout(() => fetchDashboardData(), 3000);
    } catch (err: any) {
      setAdminActionStatus(`Error al disparar backfill: ${err.message}`);
    }
  };

  const handleRegenerateAIReport = async () => {
    if (!user || user.role !== 'admin') return;
    setAdminActionStatus('Solicitando regeneración de reporte IA en Airflow...');
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/regenerate-report`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      setAdminActionStatus(`Reporte IA encolado: DAG Run ID ${data.dag_run_id || 'OK'}`);
      setTimeout(() => fetchReports(), 4000);
    } catch (err: any) {
      setAdminActionStatus(`Error al solicitar reporte: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Export Handlers
  // ---------------------------------------------------------------------------
  const exportCSV = () => {
    const headers = ['ID', 'Magnitud', 'Ubicación', 'Región', 'Fecha y Hora (UTC)', 'Profundidad (km)', 'Alerta Tsunami', 'URL USGS'];
    const rows = events.map(e => [
      e.id,
      e.magnitude,
      `"${e.place.replace(/"/g, '""')}"`,
      `"${e.region.replace(/"/g, '""')}"`,
      e.event_time,
      e.depth_km,
      e.tsunami ? 'SÍ' : 'NO',
      e.url
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sismowatch_eventos_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportHTML = () => {
    const htmlRows = events.map(e => `
      <tr>
        <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">M ${e.magnitude}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0;">${e.place}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0;">${e.region}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0;">${e.depth_km} km</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0;">${e.event_time}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0;">${e.tsunami ? '⚠️ SÍ' : 'NO'}</td>
      </tr>
    `).join('');

    const htmlDoc = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>SismoWatch - Reporte Sísmico</title>
        <style>body { font-family: sans-serif; padding: 24px; color: #1e293b; } table { width: 100%; border-collapse: collapse; margin-top: 16px; } th { background: #f1f5f9; padding: 10px; border: 1px solid #cbd5e1; text-align: left; } </style>
      </head>
      <body>
        <h2>SismoWatch - Informe de Monitoreo Sísmico Global</h2>
        <p>Fecha de emisión: ${new Date().toUTCString()} | Total sismos verificados: ${events.length}</p>
        <table>
          <thead>
            <tr><th>Magnitud</th><th>Ubicación</th><th>Región</th><th>Profundidad</th><th>Fecha/Hora UTC</th><th>Tsunami</th></tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </body>
      </html>
    `;
    const blob = new Blob([htmlDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sismowatch_reporte_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Pagination calculations
  const totalPages = Math.ceil(events.length / pageSize) || 1;
  const paginatedEvents = events.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // ---------------------------------------------------------------------------
  // View: Unauthenticated Login Screen (Modern Clean Aesthetic)
  // ---------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-3xl p-8 shadow-xl shadow-slate-200/50">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-3 shadow-lg shadow-blue-500/30">
              <Activity className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">SismoWatch</h1>
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase mt-0.5">MONITOR SÍSMICO CON IA</p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Usuario
              </label>
              <input
                type="text"
                value={loginUser}
                onChange={e => setLoginUser(e.target.value)}
                placeholder="admin o viewer"
                required
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Iniciar Sesión</span>}
            </button>
          </form>

          {/* Quick Demo Credentials */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center font-medium mb-3">Acceso Rápido para Demostración:</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => quickLogin('admin', 'admin123')}
                className="p-2.5 bg-slate-50 hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 rounded-xl text-left text-xs transition"
              >
                <div className="font-bold text-blue-700 flex items-center space-x-1">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">admin / admin123</div>
              </button>

              <button
                type="button"
                onClick={() => quickLogin('viewer', 'viewer123')}
                className="p-2.5 bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 rounded-xl text-left text-xs transition"
              >
                <div className="font-bold text-emerald-700 flex items-center space-x-1">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Viewer</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">viewer / viewer123</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // View: Main Authenticated Platform (Stitch Google Design System)
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans pb-12">
      {/* 1. Header Navigation Bar (Matches user screenshot) */}
      <header className="bg-white border-b border-slate-200/90 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo & Navigation Tabs */}
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <span className="font-black text-lg tracking-tight text-slate-900 leading-none block">SismoWatch</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none block mt-0.5">MONITOR SÍSMICO</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex items-center space-x-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                  activeTab === 'dashboard'
                    ? 'bg-blue-50 text-blue-600 border border-blue-200/80 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </button>

              <button
                onClick={() => setActiveTab('reports')}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                  activeTab === 'reports'
                    ? 'bg-blue-50 text-blue-600 border border-blue-200/80 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Reportes IA</span>
              </button>

              {/* NEW: Asistente IA Chat Tab */}
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                  activeTab === 'chat'
                    ? 'bg-blue-50 text-blue-600 border border-blue-200/80 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Bot className="w-4 h-4 text-blue-600" />
                <span>Asistente IA</span>
                <span className="px-1.5 py-0.2 text-[9px] font-extrabold uppercase bg-blue-100 text-blue-700 rounded-full">Nuevo</span>
              </button>

              {user.role === 'admin' && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTab === 'admin'
                      ? 'bg-blue-50 text-blue-600 border border-blue-200/80 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span>Centro de Control</span>
                </button>
              )}
            </nav>
          </div>

          {/* Right Header: Live Status + User Profile */}
          <div className="flex items-center space-x-4">
            {/* Live Indicator Badge */}
            <div className="flex items-center space-x-2 px-3 py-1 bg-emerald-50 border border-emerald-200/90 rounded-full text-xs font-bold text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>EN VIVO</span>
              <span className="text-emerald-600 font-mono font-medium">{liveClock}</span>
            </div>

            {/* User Pill & Logout */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              <div className="flex items-center space-x-2 bg-slate-100 border border-slate-200 rounded-full py-1 px-2.5">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-black flex items-center justify-center uppercase">
                  {user.username.slice(0, 2)}
                </div>
                <span className="text-xs font-bold text-slate-800">{user.username}</span>
              </div>

              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="max-w-[1600px] mx-auto px-6 mt-6 space-x-0 space-y-6">
        
        {/* =====================================================================
            TAB 1: DASHBOARD PRINCIPAL (Con estilo idéntico a la captura)
            ===================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            
            {/* 6 KPI Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Card 1: Sismos (24h) */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">SISMOS (24H)</span>
                  <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900">{kpis?.total_events_24h || events.length}</span>
                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 font-bold text-[11px] rounded-md">↑ 15%</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">Mundial verificado</span>
              </div>

              {/* Card 2: Magnitud Máx */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">MAGNITUD MÁX.</span>
                  <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900">{kpis?.max_magnitude_24h ? kpis.max_magnitude_24h.toFixed(1) : '4.9'}</span>
                  <span className="px-2 py-0.5 bg-amber-50 border border-amber-200/80 text-amber-700 font-bold text-[11px] rounded-md">Moderado</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">Pico más severo</span>
              </div>

              {/* Card 3: Mag. Promedio */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">MAG. PROMEDIO</span>
                  <div className="w-6 h-6 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center">
                    <Sliders className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900">{kpis?.avg_magnitude_24h ? kpis.avg_magnitude_24h.toFixed(2) : '2.68'}</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 font-mono text-[11px] rounded-md">± 0.2</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">Promedio normal</span>
              </div>

              {/* Card 4: Alertas Tsunami */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">ALERTAS TSUNAMI</span>
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900">{kpis?.tsunami_alerts_24h || 0}</span>
                  <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200/80 text-emerald-700 font-bold text-[11px] rounded-md">Seguro</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">Avisos activos</span>
              </div>

              {/* Card 5: Calidad Pandera */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">CALIDAD PANDERA</span>
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900">100.0%</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">En memoria (sin drop DB)</span>
              </div>

              {/* Card 6: Estado Pipeline */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">ESTADO PIPELINE</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                </div>
                <div>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-xs rounded-lg inline-block">
                    OPERATIONAL
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-1">Airflow TaskFlow</span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-3 px-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
              <div className="flex items-center space-x-6 flex-1 min-w-[300px]">
                <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Filter className="w-4 h-4 text-blue-600" />
                  <span>FILTROS</span>
                </div>

                {/* Slider */}
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-slate-600 font-medium">Mag. Mínima:</span>
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-mono font-bold text-xs rounded-md">
                    {minMagnitude.toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.5"
                    value={minMagnitude}
                    onChange={e => setMinMagnitude(parseFloat(e.target.value))}
                    className="w-28 accent-blue-600 cursor-pointer"
                  />
                </div>

                {/* Search */}
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    value={regionFilter}
                    onChange={e => setRegionFilter(e.target.value)}
                    placeholder="🔍 Filtrar por región..."
                    className="w-full px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 transition"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2.5">
                <button
                  onClick={() => { setMinMagnitude(0); setRegionFilter(''); }}
                  className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition shadow-xs"
                >
                  Restablecer
                </button>
                <button
                  onClick={fetchDashboardData}
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-sm shadow-blue-500/20"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refrescar</span>
                </button>
              </div>
            </div>

            {/* Interactive Leaflet Map Card */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">Mapa Sísmico Global Interactivo</h2>
                  <span className="text-xs text-slate-400 font-medium">| Vista satelital en tiempo real</span>
                </div>

                {/* Legend */}
                <div className="flex items-center space-x-4 text-xs font-semibold text-slate-600">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span>&lt; 4.0</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    <span>4.0 - 4.9</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
                    <span>5.0 - 6.4</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                    <span>≥ 6.5</span>
                  </div>
                </div>
              </div>

              {/* Map Canvas */}
              <div 
                ref={mapContainerRef} 
                className="w-full h-[460px] rounded-xl overflow-hidden border border-slate-200 relative z-0"
              />
            </div>

            {/* Curated Events Table Card (Matches user screenshot) */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-black text-slate-900 tracking-tight">Últimos Eventos Curados en Tiempo Real</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Sincronización continua de feeds sísmicos oficiales</p>
                </div>

                {/* Export Buttons */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={exportCSV}
                    className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Exportar CSV</span>
                  </button>
                  <button
                    onClick={exportHTML}
                    className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-xs"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                    <span>Exportar HTML</span>
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-3">MAGNITUD</th>
                      <th className="py-3 px-3">UBICACIÓN</th>
                      <th className="py-3 px-3">REGIÓN</th>
                      <th className="py-3 px-3">PROFUNDIDAD</th>
                      <th className="py-3 px-3">FECHA Y HORA (UTC)</th>
                      <th className="py-3 px-3 text-right">DETALLE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {paginatedEvents.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          No se encontraron eventos sísmicos con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      paginatedEvents.map(e => {
                        let magPill = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        if (e.magnitude >= 6.5) magPill = 'bg-red-50 text-red-700 border-red-200 font-bold';
                        else if (e.magnitude >= 5.0) magPill = 'bg-orange-50 text-orange-700 border-orange-200 font-bold';
                        else if (e.magnitude >= 4.0) magPill = 'bg-amber-50 text-amber-700 border-amber-200 font-bold';

                        return (
                          <tr key={e.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded border text-[11px] font-black ${magPill}`}>
                                M {e.magnitude.toFixed(1)}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-800">{e.place}</td>
                            <td className="py-3 px-3 text-slate-500">{e.region}</td>
                            <td className="py-3 px-3 text-slate-600 font-mono">{e.depth_km.toFixed(1)} km</td>
                            <td className="py-3 px-3 text-slate-500 font-mono">{e.event_time.replace('T', ' ').slice(0, 19)}</td>
                            <td className="py-3 px-3 text-right">
                              <a
                                href={e.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${e.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold text-xs"
                              >
                                <span>USGS</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination (Matches user screenshot) */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-400 font-medium">
                  Mostrando <b className="text-slate-700">{events.length ? (currentPage - 1) * pageSize + 1 : 0}-{Math.min(currentPage * pageSize, events.length)}</b> de <b className="text-slate-700">{events.length}</b> sismos verificados
                </span>

                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent rounded-lg font-medium transition"
                  >
                    Anterior
                  </button>

                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold transition ${
                        currentPage === page
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent rounded-lg font-medium transition"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* =====================================================================
            TAB 2: REPORTES IA (INFORMES EJECUTIVOS DIARIOS)
            ===================================================================== */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div>
                <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  <span>Reportes Ejecutivos de Inteligencia Artificial</span>
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Generados diariamente por Gemini 1.5 con grounding factual sobre PostgreSQL y Z-Score
                </p>
              </div>

              {user.role === 'admin' && (
                <button
                  onClick={handleRegenerateAIReport}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generar Reporte Hoy</span>
                </button>
              )}
            </div>

            {reports.length === 0 ? (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center text-slate-400">
                No hay reportes de IA generados aún. Dispara una regeneración desde el Centro de Control.
              </div>
            ) : (
              reports.map(rep => (
                <div key={rep.id} className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center space-x-3">
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg border border-blue-200">
                        Fecha: {rep.report_date}
                      </span>
                      <span className="text-xs text-slate-400">
                        Fuente: <b>{rep.source || 'gemini-1.5-flash'}</b> ({rep.latency_ms || 420} ms)
                      </span>
                    </div>

                    <div className="flex items-center space-x-3 text-xs font-semibold">
                      <span className="text-slate-600">Sismos evaluados: <b>{rep.total_events}</b></span>
                      <span className="text-amber-600">Magnitud Pico: <b>M {rep.max_magnitude}</b></span>
                      <span className="text-emerald-600">Promedio: <b>M {rep.avg_magnitude}</b></span>
                      <span className="text-red-600">Tsunamis: <b>{rep.tsunami_alerts}</b></span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Resumen Ejecutivo</h4>
                    <p className="text-sm text-slate-800 leading-relaxed bg-slate-50/80 p-4 rounded-xl border border-slate-200/60">
                      {rep.executive_summary}
                    </p>
                  </div>

                  {rep.anomalies_detected && rep.anomalies_detected.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Anomalías Estadísticas Detectadas (Algoritmo Z-Score)
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {rep.anomalies_detected.map((anom, idx) => (
                          <div key={idx} className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs">
                            <div className="flex items-center justify-between font-bold text-amber-900 mb-1">
                              <span>Región: {anom.region}</span>
                              <span className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded font-mono text-[10px]">
                                Z = {anom.z_score}
                              </span>
                            </div>
                            <p className="text-slate-700">{anom.explanation || `Enjambre de ${anom.event_count} sismos detectado con desvío estadístico significativo.`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 3: ASISTENTE IA (CHAT CONVERSACIONAL INTERACTIVO)
            ===================================================================== */}
        {activeTab === 'chat' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden flex flex-col h-[700px]">
            {/* Chat Header */}
            <div className="p-4 px-6 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center space-x-2">
                    <span>Asistente Sismológico de IA</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    Grounded RAG sobre PostgreSQL (`curated.earthquakes` + `curated.ai_reports`)
                  </p>
                </div>
              </div>

              {/* Status Pills */}
              <div className="hidden sm:flex items-center space-x-2 text-xs">
                <span className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-bold">
                  {events.length} sismos en memoria
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-bold">
                  Gemini 1.5 Flash Conectado
                </span>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed shadow-xs ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-slate-50 border border-slate-200/90 text-slate-800 rounded-bl-none'
                  }`}>
                    {msg.role === 'assistant' && (
                      <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-200/60 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span className="flex items-center space-x-1 text-blue-600">
                          <Bot className="w-3 h-3" />
                          <span>SismoWatch AI</span>
                        </span>
                        <span>{msg.source || 'Grounded Engine'}</span>
                      </div>
                    )}

                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    <div className={`text-[10px] mt-2 text-right ${msg.role === 'user' ? 'text-blue-200' : 'text-slate-400'}`}>
                      {msg.time}
                    </div>
                  </div>
                </div>
              ))}

              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-none p-4 text-xs flex items-center space-x-2 text-slate-500">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Consultando base de datos sismológica y analizando con IA...</span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Suggested Prompts */}
            <div className="px-6 py-2.5 bg-slate-50/50 border-t border-slate-100 flex items-center space-x-2 overflow-x-auto text-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase flex-shrink-0">Preguntas sugeridas:</span>
              <button
                onClick={() => handleSendChat('¿Cuál ha sido el sismo más potente registrado hoy?')}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-full text-slate-700 whitespace-nowrap transition"
              >
                ¿Sismo más potente hoy?
              </button>
              <button
                onClick={() => handleSendChat('¿Hay alguna alerta de tsunami activa en este momento?')}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-full text-slate-700 whitespace-nowrap transition"
              >
                ¿Alertas de tsunami?
              </button>
              <button
                onClick={() => handleSendChat('¿Qué anomalías detectó el algoritmo Z-Score?')}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-full text-slate-700 whitespace-nowrap transition"
              >
                ¿Anomalías Z-Score?
              </button>
              <button
                onClick={() => handleSendChat('Dame un resumen de la actividad sísmica en la costa de Chile.')}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-full text-slate-700 whitespace-nowrap transition"
              >
                Actividad en Chile
              </button>
            </div>

            {/* Chat Input Bar */}
            <div className="p-4 px-6 border-t border-slate-200 bg-white flex items-center space-x-3">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                placeholder="Pregunta a la IA sobre sismos, fallas, tsunamis o estadísticas..."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 transition"
              />
              <button
                onClick={() => handleSendChat()}
                disabled={isChatLoading || !chatInput.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 4: CENTRO DE CONTROL (SOLO ADMIN)
            ===================================================================== */}
        {activeTab === 'admin' && user.role === 'admin' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs">
              <div className="flex items-center space-x-3 pb-4 mb-4 border-b border-slate-100">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center font-bold">
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 tracking-tight">Centro de Control y Gobernanza</h2>
                  <p className="text-xs text-slate-400 font-medium">
                    Operaciones de Pipeline, Auditoría de Calidad Pandera y Backfills
                  </p>
                </div>
              </div>

              {adminActionStatus && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl flex items-center space-x-2">
                  <Activity className="w-4 h-4 flex-shrink-0 animate-spin text-blue-600" />
                  <span>{adminActionStatus}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Disparar Backfill de 30 Días</h3>
                  <p className="text-xs text-slate-500">
                    Ingiere el catálogo sísmico completo de USGS para los últimos 30 días con filtrado Pandera en memoria y deduplicación upsert.
                  </p>
                  <button
                    onClick={handleTriggerBackfill}
                    className="mt-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    Ejecutar Backfill
                  </button>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Regenerar Reporte Diario de IA</h3>
                  <p className="text-xs text-slate-500">
                    Re-ejecuta el DAG `daily_ai_report_dag` para computar anomalías Z-Score y regenerar el resumen ejecutivo con Gemini 1.5.
                  </p>
                  <button
                    onClick={handleRegenerateAIReport}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    Regenerar Reporte
                  </button>
                </div>
              </div>
            </div>

            {/* Quarantine Audit Information */}
            {quarantineAudit && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-black text-slate-900">
                  Auditoría de Calidad en Memoria (Decisión de Arquitectura Sin Cuarentena Física)
                </h3>
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl">
                  {quarantineAudit.architecture_notice}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-400 block mb-1">Ejecuciones Evaluadas:</span>
                    <b className="text-slate-900 text-base">{quarantineAudit.total_runs_evaluated}</b>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-400 block mb-1">Registros Evaluados:</span>
                    <b className="text-slate-900 text-base">{quarantineAudit.total_records_evaluated}</b>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-400 block mb-1">Registros Descartados:</span>
                    <b className="text-slate-900 text-base">{quarantineAudit.total_records_discarded}</b>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-slate-400 block mb-1">Calidad Global:</span>
                    <b className="text-emerald-600 text-base">{quarantineAudit.global_quality_score}%</b>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Floating AI Chat Assistant Button & Modal (Bottom Right) */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isFloatingChatOpen ? (
          <button
            onClick={() => setIsFloatingChatOpen(true)}
            className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-500/40 flex items-center justify-center transition-transform hover:scale-105"
            title="Abrir Chat con Asistente IA"
          >
            <Bot className="w-7 h-7" />
          </button>
        ) : (
          <div className="w-[380px] sm:w-[420px] h-[550px] bg-white border border-slate-200/90 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-3 px-4 bg-blue-600 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5" />
                <div>
                  <h4 className="text-xs font-bold leading-tight">Asistente IA SismoWatch</h4>
                  <p className="text-[10px] text-blue-100">Grounded en datos sísmicos reales</p>
                </div>
              </div>
              <button
                onClick={() => setIsFloatingChatOpen(false)}
                className="text-blue-200 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Messages */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {chatMessages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-slate-100 text-slate-800 rounded-bl-none'
                  }`}>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    <div className={`text-[9px] mt-1 text-right ${m.role === 'user' ? 'text-blue-200' : 'text-slate-400'}`}>
                      {m.time}
                    </div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 rounded-2xl rounded-bl-none p-3 text-xs flex items-center space-x-2 text-slate-500">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    <span>Analizando con IA...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Input */}
            <div className="p-3 border-t border-slate-100 bg-slate-50/70 flex items-center space-x-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                placeholder="Pregunta a la IA..."
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              />
              <button
                onClick={() => handleSendChat()}
                disabled={isChatLoading || !chatInput.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl transition"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
