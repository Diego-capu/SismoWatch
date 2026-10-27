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
  Globe,
  Search,
  Waves,
  Bell,
  Settings,
  Layers,
  Zap
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

function formatChatContent(content: string) {
  const lines = content.split('\n');
  return lines.map((line, idx) => {
    const isBullet = /^\s*[\*\-]\s+/.test(line);
    const cleanLine = line.replace(/^\s*[\*\-]\s+/, '');
    const parts = cleanLine.split(/(\*\*.*?\*\*|`.*?`)/g);

    return (
      <div key={idx} className={`${isBullet ? 'flex items-start space-x-1.5 ml-1.5 my-0.5' : 'my-0.5'}`}>
        {isBullet && <span className="text-blue-500 font-bold">•</span>}
        <span>
          {parts.map((p, pIdx) => {
            if (p.startsWith('**') && p.endsWith('**')) {
              return <strong key={pIdx} className="font-bold text-slate-900">{p.slice(2, -2)}</strong>;
            }
            if (p.startsWith('`') && p.endsWith('`')) {
              return <code key={pIdx} className="bg-slate-200/80 text-blue-700 px-1 py-0.5 rounded font-mono text-[11px]">{p.slice(1, -1)}</code>;
            }
            return p;
          })}
        </span>
      </div>
    );
  });
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
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [reportActionStatus, setReportActionStatus] = useState<string | null>(null);

  // Global Filters (for Map & USGS feed query)
  const [minMagnitude, setMinMagnitude] = useState<number>(0);
  const [regionFilter, setRegionFilter] = useState<string>('');

  // Curated Events Table Specific Filters & Pagination
  const [tableSearch, setTableSearch] = useState<string>('');
  const [tableSeverity, setTableSeverity] = useState<'all' | 'minor' | 'moderate' | 'severe' | 'critical'>('all');
  const [tableTsunamiOnly, setTableTsunamiOnly] = useState<boolean>(false);
  const [tablePageSize, setTablePageSize] = useState<number>(10);
  const [tableCurrentPage, setTableCurrentPage] = useState<number>(1);

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
  const tileLayerRef = useRef<any>(null);
  const [mapLayerType, setMapLayerType] = useState<'base' | 'satellite' | 'topo'>('base');

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
        setTableCurrentPage(1);
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
  // Leaflet Map Initialization & Lifecycle (Official Leaflet.js with Esri Canvas)
  // ---------------------------------------------------------------------------
  const handleLayerSwitch = (type: 'base' | 'satellite' | 'topo') => {
    setMapLayerType(type);
    if (!mapInstanceRef.current || typeof L === 'undefined') return;
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }
    let url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    let attr = 'Leaflet | &copy; Esri, USGS, NOAA';
    let maxZoom = 16;
    if (type === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attr = 'Leaflet | &copy; Esri, Maxar, Earthstar Geographics';
      maxZoom = 19;
    } else if (type === 'topo') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
      attr = 'Leaflet | &copy; Esri, HERE, Garmin';
      maxZoom = 19;
    }
    tileLayerRef.current = L.tileLayer(url, { maxZoom, attribution: attr }).addTo(mapInstanceRef.current);
  };

  useEffect(() => {
    if (activeTab !== 'dashboard' || !mapContainerRef.current || typeof L === 'undefined') return;

    // Destruye cualquier instancia previa para evitar bugs al cambiar de pestaña/vista
    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (e) {
        // ignore cleanup error
      }
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
      tileLayerRef.current = null;
    }

    // Inicializa el mapa oficial de Leaflet con Esri Canvas (idéntico a la captura)
    const map = L.map(mapContainerRef.current, {
      center: [20.0, 0.0],
      zoom: 2,
      minZoom: 1,
      maxZoom: 19,
      worldCopyJump: true,
      zoomControl: true,
    });

    const defaultUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const defaultAttr = 'Leaflet | &copy; Esri, USGS, NOAA';
    const initialTileLayer = L.tileLayer(defaultUrl, {
      maxZoom: 16,
      attribution: defaultAttr,
    }).addTo(map);

    tileLayerRef.current = initialTileLayer;
    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;
    mapInstanceRef.current = map;

    // Recalcula dimensiones para evitar cuadros grises al volver a la vista
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {}
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, [activeTab]);

  // Actualización de marcadores sísmicos con estilo y popups idénticos a la captura
  useEffect(() => {
    if (activeTab !== 'dashboard' || !markersLayerRef.current || !mapInstanceRef.current) return;

    markersLayerRef.current.clearLayers();

    events.forEach(q => {
      if (!q.latitude || !q.longitude) return;

      // Color coding matching legend: <4.0: #134e4a, 4.0-4.9: #f59e0b, 5.0-6.4: #f97316, >=6.5: #ef4444
      let color = '#134e4a';
      let strokeColor = '#134e4a';
      let radius = 4.5;
      let severityLabel = 'Menor';
      let badgeBg = '#f1f5f9';
      let badgeColor = '#475569';

      if (q.magnitude >= 6.5) {
        color = '#ef4444';
        strokeColor = '#b91c1c';
        radius = 11;
        severityLabel = 'Crítico';
        badgeBg = '#fee2e2';
        badgeColor = '#b91c1c';
      } else if (q.magnitude >= 5.0) {
        color = '#f97316';
        strokeColor = '#c2410c';
        radius = 8.5;
        severityLabel = 'Severo';
        badgeBg = '#ffedd5';
        badgeColor = '#c2410c';
      } else if (q.magnitude >= 4.0) {
        color = '#f59e0b';
        strokeColor = '#b45309';
        radius = 6.5;
        severityLabel = 'Moderado';
        badgeBg = '#fef3c7';
        badgeColor = '#b45309';
      }

      const marker = L.circleMarker([q.latitude, q.longitude], {
        radius: radius,
        fillColor: color,
        color: strokeColor,
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.75,
      });

      // Relative time calculation
      const diffMs = Math.max(0, Date.now() - new Date(q.event_time).getTime());
      const diffMin = Math.floor(diffMs / 60000);
      const timeAgo = diffMin < 60 ? `Hace ${diffMin} min` : `Hace ${Math.floor(diffMin / 60)} h`;

      const popupContent = `
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: flex-start; gap: 10px; padding: 2px 2px; min-width: 250px;">
          <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 5px 7px; text-align: center; min-width: 36px; flex-shrink: 0;">
            <span style="font-size: 9px; color: #b45309; font-weight: 700; display: block; line-height: 1;">M</span>
            <span style="font-size: 13px; color: #92400e; font-weight: 900; display: block; line-height: 1.1;">${q.magnitude.toFixed(1)}</span>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <span style="font-weight: 800; font-size: 12px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">${q.place}</span>
              <span style="background-color: ${badgeBg}; color: ${badgeColor}; font-size: 9px; padding: 1px 6px; border-radius: 9999px; font-weight: 700; flex-shrink: 0;">${severityLabel}</span>
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
              Profundidad: ${q.depth_km.toFixed(1)} km • ${timeAgo}
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
              <a href="${q.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${q.id}`}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #334155; font-weight: 600; text-decoration: none;">
                Ver telemetría USGS →
              </a>
              ${q.tsunami ? '<span style="font-size: 9px; font-weight: 800; color: #b91c1c; background: #fee2e2; padding: 1px 5px; border-radius: 4px;">⚠️ TSUNAMI</span>' : ''}
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(markersLayerRef.current);
    });

    mapInstanceRef.current.invalidateSize();
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
    if (!user || user.role !== 'admin' || isGeneratingReport) return;
    setIsGeneratingReport(true);
    setReportActionStatus('Sintetizando métricas de las últimas 24h y consultando Gemini AI...');
    setAdminActionStatus('Sintetizando métricas de las últimas 24h y consultando Gemini AI...');
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/regenerate-report`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Error al regenerar reporte');
      }
      setReportActionStatus(`✓ ${data.message || 'Reporte IA generado y actualizado con éxito.'}`);
      setAdminActionStatus(`✓ ${data.message || 'Reporte IA generado con éxito.'}`);
      await fetchReports();
      setTimeout(() => {
        setReportActionStatus(null);
      }, 8000);
    } catch (err: any) {
      setReportActionStatus(`✗ Error al regenerar reporte: ${err.message}`);
      setAdminActionStatus(`✗ Error al solicitar reporte: ${err.message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Export Handlers (Exports active filtered table list or all events)
  // ---------------------------------------------------------------------------
  const exportCSV = () => {
    const dataToExport = filteredTableEvents.length > 0 ? filteredTableEvents : events;
    const headers = ['ID', 'Magnitud', 'Ubicación', 'Región', 'Fecha y Hora (UTC)', 'Profundidad (km)', 'Alerta Tsunami', 'URL USGS'];
    const rows = dataToExport.map(e => [
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
    const dataToExport = filteredTableEvents.length > 0 ? filteredTableEvents : events;
    const htmlRows = dataToExport.map(e => `
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
        <p>Fecha de emisión: ${new Date().toUTCString()} | Sismos incluidos: ${dataToExport.length} de ${events.length} totales</p>
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

  // ---------------------------------------------------------------------------
  // Curated Events Table Filtering & Pagination Logic
  // ---------------------------------------------------------------------------
  const filteredTableEvents = events.filter(e => {
    // 1. Filtro de búsqueda por texto (lugar, región o ID)
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      const matchPlace = (e.place || '').toLowerCase().includes(q);
      const matchRegion = (e.region || '').toLowerCase().includes(q);
      const matchId = (e.id || '').toLowerCase().includes(q);
      if (!matchPlace && !matchRegion && !matchId) return false;
    }
    // 2. Filtro por severidad de magnitud
    if (tableSeverity === 'minor' && e.magnitude >= 4.0) return false;
    if (tableSeverity === 'moderate' && (e.magnitude < 4.0 || e.magnitude >= 5.0)) return false;
    if (tableSeverity === 'severe' && (e.magnitude < 5.0 || e.magnitude >= 6.5)) return false;
    if (tableSeverity === 'critical' && e.magnitude < 6.5) return false;

    // 3. Filtro por alertas de tsunami
    if (tableTsunamiOnly && !e.tsunami) return false;

    return true;
  });

  const totalPages = Math.ceil(filteredTableEvents.length / tablePageSize) || 1;
  const paginatedEvents = filteredTableEvents.slice(
    (tableCurrentPage - 1) * tablePageSize,
    tableCurrentPage * tablePageSize
  );

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
    <div className="min-h-screen bg-[#eaedf2] p-2.5 sm:p-4 md:p-6 flex flex-col justify-start items-center font-sans text-slate-800 antialiased">
      {/* Sleek Framed Card Shell matching user screenshot */}
      <div className="w-full max-w-[1540px] bg-white rounded-[28px] border border-slate-200/90 shadow-md p-4 sm:p-6 md:p-7 space-y-4">
        
        {/* Floating Top Navigation Pill Island Header (Matches user screenshot) */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100/80">
          {/* Subtle Logo / Branding */}
          <div className="flex items-center space-x-2.5 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="w-8 h-8 bg-[#2d4b43] rounded-xl flex items-center justify-center text-white shadow-xs">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <span className="font-black text-sm tracking-tight text-slate-900 leading-none block">SismoWatch</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none block mt-0.5">MONITOR SÍSMICO</span>
            </div>
          </div>

          {/* Centered Floating Navigation Pill Island */}
          <div className="bg-white border border-slate-200/90 rounded-full px-2.5 py-1 shadow-xs flex items-center space-x-1 sm:space-x-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1 rounded-full text-xs font-bold flex items-center space-x-1.5 transition ${
                activeTab === 'dashboard'
                  ? 'bg-[#2d4b43] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
              {activeTab === 'dashboard' && <span className="w-1.5 h-1.5 rounded-full bg-white ml-0.5"></span>}
            </button>

            <button
              onClick={() => {
                setActiveTab('dashboard');
                const el = document.getElementById('region-filter-input');
                if (el) el.focus();
              }}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition"
              title="Buscar región..."
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition relative"
              title="Alertas y Reportes IA"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400"></span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`p-1.5 rounded-full transition ${
                activeTab === 'reports' ? 'bg-[#2d4b43] text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Reportes Ejecutivos IA"
            >
              <Sparkles className={`w-3.5 h-3.5 ${activeTab === 'reports' ? 'text-white' : 'text-amber-500'}`} />
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`p-1.5 rounded-full transition ${
                activeTab === 'chat' ? 'bg-[#2d4b43] text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Asistente Conversacional IA"
            >
              <Bot className={`w-3.5 h-3.5 ${activeTab === 'chat' ? 'text-white' : 'text-blue-600'}`} />
            </button>

            <span className="text-slate-200 select-none">|</span>

            {user.role === 'admin' ? (
              <button
                onClick={() => setActiveTab('admin')}
                className={`p-1.5 rounded-full transition ${
                  activeTab === 'admin' ? 'bg-[#2d4b43] text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Centro de Control / Admin"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => setActiveTab('admin')}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition"
                title="Configuración"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Right: User Profile & Logout */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 bg-slate-100/90 border border-slate-200/80 rounded-full py-1 px-2.5">
              <div className="w-5 h-5 rounded-full bg-[#2d4b43] text-white text-[10px] font-black flex items-center justify-center uppercase">
                {user.username.slice(0, 2)}
              </div>
              <span className="text-xs font-semibold text-slate-700 hidden sm:inline">{user.username}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">({user.role})</span>
            </div>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* =====================================================================
            TAB 1: DASHBOARD PRINCIPAL (Con estilo idéntico a la captura)
            ===================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            
            {/* 6 KPI Cards Grid (Matches user screenshot) */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
              {/* Card 1: Sismos (24h) */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SISMOS (24H)</span>
                  <div className="w-5 h-5 rounded bg-slate-100/80 text-slate-500 flex items-center justify-center">
                    <TrendingUp className="w-3 h-3" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-800">{kpis?.total_events_24h ?? events.length}</span>
                  <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 font-bold text-[11px] rounded flex items-center">
                    ↑ 15%
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-normal block mt-1">Mundial verificado</span>
              </div>

              {/* Card 2: Magnitud Máx */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">MAGNITUD MÁX.</span>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                </div>
                {(() => {
                  const maxMag = kpis?.max_magnitude_24h ?? (events.length > 0 ? Math.max(...events.map(e => e.magnitude)) : 0);
                  let label = 'Menor';
                  let badge = 'bg-emerald-50 border-emerald-200 text-emerald-700';
                  if (maxMag >= 6.5) {
                    label = 'Crítico';
                    badge = 'bg-red-50 border-red-200 text-red-700';
                  } else if (maxMag >= 5.0) {
                    label = 'Severo';
                    badge = 'bg-orange-50 border-orange-200 text-orange-700';
                  } else if (maxMag >= 4.0) {
                    label = 'Moderado';
                    badge = 'bg-amber-50 border-amber-200 text-amber-800';
                  }
                  return (
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black text-amber-600">
                        {maxMag > 0 ? maxMag.toFixed(1) : '0.0'}
                      </span>
                      {maxMag > 0 && (
                        <span className={`px-2 py-0.5 border font-medium text-[11px] rounded ${badge}`}>
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })()}
                <span className="text-[10px] text-slate-400 font-normal block mt-1">Pico más severo</span>
              </div>

              {/* Card 3: Mag. Promedio */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">MAG. PROMEDIO</span>
                  <Sliders className="w-3.5 h-3.5 text-slate-400" />
                </div>
                {(() => {
                  const avgMag = kpis?.avg_magnitude_24h ?? (events.length > 0 ? events.reduce((a, b) => a + b.magnitude, 0) / events.length : 0);
                  return (
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black text-slate-800">
                        {avgMag > 0 ? avgMag.toFixed(2) : '0.00'}
                      </span>
                      <span className="px-1.5 py-0.2 bg-slate-100 text-slate-500 font-semibold text-[11px] rounded">
                        ± 0.2
                      </span>
                    </div>
                  );
                })()}
                <span className="text-[10px] text-slate-400 font-normal block mt-1">Promedio normal</span>
              </div>

              {/* Card 4: Alertas Tsunami */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ALERTAS TSUNAMI</span>
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                {(() => {
                  const tsunamis = kpis?.tsunami_alerts_24h ?? events.filter(e => e.tsunami > 0).length;
                  return (
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl font-black text-slate-800">{tsunamis}</span>
                      <span className={`px-2 py-0.5 border font-medium text-[11px] rounded ${
                        tsunamis > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}>
                        {tsunamis > 0 ? 'Alerta' : 'Seguro'}
                      </span>
                    </div>
                  );
                })()}
                <span className="text-[10px] text-slate-400 font-normal block mt-1">Avisos activos</span>
              </div>

              {/* Card 5: Calidad Pandera */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CALIDAD PANDERA</span>
                  <CheckCircle className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-800">
                    {kpis?.quality_score != null ? `${kpis.quality_score.toFixed(1)}%` : '100.0%'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-normal block mt-1">En memoria (sin drop DB)</span>
              </div>

              {/* Card 6: Estado Pipeline */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ESTADO PIPELINE</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                </div>
                <div>
                  <span className="px-2.5 py-1 border font-black tracking-wider text-xs rounded-md inline-block bg-[#eaf4ee] text-[#2e6945] border-[#cbe6d4]">
                    {kpis?.status || 'OPERATIONAL'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-normal block mt-1">Airflow TaskFlow</span>
              </div>
            </div>

            {/* Filter Bar (Matches user screenshot) */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 px-5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center space-x-6 flex-1 min-w-[300px]">
                <div className="flex items-center space-x-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span>FILTROS</span>
                </div>

                {/* Slider */}
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-slate-600 font-medium">Mag. Mínima:</span>
                  <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs font-mono font-bold text-slate-700">
                    {minMagnitude.toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.5"
                    value={minMagnitude}
                    onChange={e => setMinMagnitude(parseFloat(e.target.value))}
                    className="w-28 accent-[#2d4b43] cursor-pointer"
                  />
                </div>

                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="region-filter-input"
                    type="text"
                    value={regionFilter}
                    onChange={e => setRegionFilter(e.target.value)}
                    placeholder="Filtrar por región..."
                    className="w-full pl-8 pr-3.5 py-1.5 bg-white border border-slate-200 rounded-full text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { setMinMagnitude(0); setRegionFilter(''); }}
                  className="px-4 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium transition shadow-2xs"
                >
                  Restablecer
                </button>
                <button
                  onClick={fetchDashboardData}
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-[#2d4b43] hover:bg-[#233a34] text-white rounded-xl text-xs font-medium flex items-center space-x-1.5 transition shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refrescar</span>
                </button>
              </div>
            </div>

            {/* Interactive Leaflet Map Card (Matches user screenshot) */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs relative">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">Mapa Sísmico Global Interactivo</h2>
                  <span className="text-xs text-slate-400 font-medium">| Vista satelital en tiempo real</span>
                  
                  {/* Live indicator pill */}
                  <div className="flex items-center space-x-1.5 px-2.5 py-0.5 bg-slate-100 border border-slate-200/80 rounded-full text-[11px] font-mono text-slate-600 ml-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="font-bold text-[10px]">EN VIVO</span>
                    <span>{liveClock}</span>
                  </div>
                </div>

                {/* Legend matching screenshot */}
                <div className="flex items-center space-x-4 text-xs font-semibold text-slate-600">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#134e4a]"></span>
                    <span>&lt; 4.0</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]"></span>
                    <span>4.0 - 4.9</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#f97316]"></span>
                    <span>5.0 - 6.4</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]"></span>
                    <span>≥ 6.5</span>
                  </div>
                </div>
              </div>

              {/* Map Canvas with Top-Right Layer Switcher Overlay */}
              <div className="relative w-full h-[470px] rounded-xl overflow-hidden border border-slate-200">
                <div 
                  ref={mapContainerRef} 
                  className="w-full h-full z-0"
                />

                {/* Map Layer Switcher Overlay (Top-Right) */}
                <div className="absolute top-3 right-3 z-[400] flex items-center space-x-1 bg-white/95 backdrop-blur border border-slate-200/90 rounded-xl shadow-xs p-1 text-xs">
                  <button
                    onClick={() => handleLayerSwitch('satellite')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition ${
                      mapLayerType === 'satellite' ? 'bg-[#2d4b43] text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    Satelital
                  </button>
                  <button
                    onClick={() => handleLayerSwitch('topo')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition ${
                      mapLayerType === 'topo' ? 'bg-[#2d4b43] text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    Topográfico
                  </button>
                  <button
                    onClick={() => handleLayerSwitch('base')}
                    className={`p-1.5 rounded-lg transition ${
                      mapLayerType === 'base' ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-700'
                    }`}
                    title="Vista Estándar Minimalista"
                  >
                    <Layers className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Curated Events Table Card (Matches user screenshot) */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center space-x-2">
                    <Zap className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-black text-slate-900 tracking-tight">Últimos Eventos Curados en Tiempo Real</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Sincronización continua de feeds sísmicos oficiales</p>
                </div>

                {/* Export Buttons */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={exportCSV}
                    className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Exportar CSV</span>
                  </button>
                  <button
                    onClick={exportHTML}
                    className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition shadow-2xs"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                    <span>Exportar HTML</span>
                  </button>
                </div>
              </div>

              {/* Filtros Específicos para la Lista de Últimos Eventos */}
              <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
                  {/* Búsqueda por texto (lugar, región o ID) */}
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={tableSearch}
                      onChange={e => {
                        setTableSearch(e.target.value);
                        setTableCurrentPage(1);
                      }}
                      placeholder="Buscar por sismo, ciudad o ID..."
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
                    />
                  </div>

                  {/* Selector de Severidad */}
                  <div className="flex items-center space-x-1.5 text-xs text-slate-500">
                    <select
                      value={tableSeverity}
                      onChange={e => {
                        setTableSeverity(e.target.value as any);
                        setTableCurrentPage(1);
                      }}
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-semibold focus:outline-none focus:border-slate-400 shadow-2xs"
                    >
                      <option value="all">Todas las magnitudes</option>
                      <option value="minor">Menor (&lt; 4.0)</option>
                      <option value="moderate">Moderado (4.0 - 4.9)</option>
                      <option value="severe">Severo (5.0 - 6.4)</option>
                      <option value="critical">Crítico (≥ 6.5)</option>
                    </select>
                  </div>

                  {/* Toggle Solo Alertas Tsunami */}
                  <button
                    type="button"
                    onClick={() => {
                      setTableTsunamiOnly(prev => !prev);
                      setTableCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 border shadow-2xs ${
                      tableTsunamiOnly
                        ? 'bg-red-50 text-red-700 border-red-300 ring-2 ring-red-400/20'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Waves className="w-3.5 h-3.5" />
                    <span>Solo Alertas Tsunami</span>
                  </button>

                  {/* Botón para resetear filtros si hay alguno activo */}
                  {(tableSearch || tableSeverity !== 'all' || tableTsunamiOnly) && (
                    <button
                      onClick={() => {
                        setTableSearch('');
                        setTableSeverity('all');
                        setTableTsunamiOnly(false);
                        setTableCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 font-semibold underline"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>

                {/* Controles de Vista de Tabla: Filas y Conteo */}
                <div className="flex items-center space-x-3 text-xs">
                  <div className="flex items-center space-x-1.5 text-slate-500">
                    <span>Mostrar:</span>
                    <select
                      value={tablePageSize}
                      onChange={e => {
                        setTablePageSize(Number(e.target.value));
                        setTableCurrentPage(1);
                      }}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-bold focus:outline-none shadow-2xs"
                    >
                      <option value={5}>5 filas</option>
                      <option value={10}>10 filas</option>
                      <option value={20}>20 filas</option>
                      <option value={50}>50 filas</option>
                    </select>
                  </div>

                  <span className="bg-white border border-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded-lg text-xs shadow-2xs">
                    <b>{filteredTableEvents.length}</b> de <b>{events.length}</b> sismos
                  </span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/60">
                      <th className="py-2.5 px-3">MAGNITUD</th>
                      <th className="py-2.5 px-3">UBICACIÓN</th>
                      <th className="py-2.5 px-3">REGIÓN</th>
                      <th className="py-2.5 px-3">PROFUNDIDAD</th>
                      <th className="py-2.5 px-3">FECHA Y HORA (UTC)</th>
                      <th className="py-2.5 px-3 text-right">DETALLE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {paginatedEvents.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          No se encontraron eventos sísmicos con los filtros seleccionados en la tabla.
                        </td>
                      </tr>
                    ) : (
                      paginatedEvents.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50/70 transition">
                          <td className="py-2.5 px-3">
                            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-mono text-xs rounded-full font-bold border border-slate-200/60 inline-block">
                              M {e.magnitude.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">{e.place}</td>
                          <td className="py-2.5 px-3 text-slate-600">{e.region}</td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">{e.depth_km.toFixed(0)} km</td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono">{e.event_time.replace('T', ' ').slice(0, 19)}</td>
                          <td className="py-2.5 px-3 text-right">
                            <a
                              href={e.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${e.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-slate-600 hover:text-slate-900 font-bold text-xs"
                            >
                              <span>USGS</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-400 font-medium">
                  Mostrando <b className="text-slate-700">{filteredTableEvents.length ? (tableCurrentPage - 1) * tablePageSize + 1 : 0}-{Math.min(tableCurrentPage * tablePageSize, filteredTableEvents.length)}</b> de <b className="text-slate-700">{filteredTableEvents.length}</b> sismos filtrados {filteredTableEvents.length !== events.length && <span className="text-slate-400">({events.length} cargados)</span>}
                </span>

                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => setTableCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={tableCurrentPage === 1}
                    className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent rounded-lg font-medium transition"
                  >
                    Anterior
                  </button>

                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5 && tableCurrentPage > 3) {
                      pageNum = Math.min(tableCurrentPage - 3 + i + 1, totalPages - 4 + i);
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setTableCurrentPage(pageNum)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold transition ${
                          tableCurrentPage === pageNum
                            ? 'bg-[#2d4b43] text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setTableCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={tableCurrentPage >= totalPages}
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
                  Generados diariamente por Gemini con grounding factual sobre PostgreSQL y Z-Score
                </p>
              </div>

              {user.role === 'admin' && (
                <button
                  onClick={handleRegenerateAIReport}
                  disabled={isGeneratingReport}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition shadow-sm ${
                    isGeneratingReport
                      ? 'bg-blue-400 cursor-not-allowed text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingReport ? 'animate-spin' : ''}`} />
                  <span>{isGeneratingReport ? 'Generando con Gemini...' : 'Generar Reporte Hoy'}</span>
                </button>
              )}
            </div>

            {reportActionStatus && (
              <div
                className={`p-3 text-xs rounded-xl flex items-center space-x-2 border transition ${
                  reportActionStatus.startsWith('✗')
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                <Activity className={`w-4 h-4 flex-shrink-0 ${isGeneratingReport ? 'animate-spin text-blue-600' : 'text-emerald-600'}`} />
                <span className="font-semibold">{reportActionStatus}</span>
              </div>
            )}

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
                        Fuente: <b>{rep.source || 'gemini-3.5-flash-lite'}</b> {rep.latency_ms ? `(${rep.latency_ms} ms)` : ''}
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

                  {rep.high_activity_zones && rep.high_activity_zones.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Regiones de Mayor Densidad Sísmica (Top 5)
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                        {rep.high_activity_zones.map((zone, zIdx) => (
                          <div key={zIdx} className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs">
                            <span className="font-bold text-slate-800 block truncate">{zone.region}</span>
                            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                              <span><b>{zone.event_count}</b> sismos</span>
                              <span className="font-bold text-amber-600">M {zone.max_magnitude}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {rep.notable_events && rep.notable_events.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Sismos Destacados del Período
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {rep.notable_events.slice(0, 4).map((nev, nIdx) => (
                          <div key={nIdx} className="p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs flex items-center justify-between">
                            <div className="flex items-center space-x-2 truncate">
                              <span className="px-2 py-0.5 bg-rose-100 text-rose-700 font-black rounded-md font-mono text-[11px]">
                                M {nev.magnitude}
                              </span>
                              <span className="text-slate-800 font-medium truncate">{nev.place}</span>
                            </div>
                            <span className="text-slate-400 text-[10px] font-mono flex-shrink-0 ml-2">{nev.event_time}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                  Gemini IA Conectado
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

                    <div>{formatChatContent(msg.content)}</div>

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
                onClick={() => handleSendChat('¿Cuál fue el último sismo registrado?')}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-full text-slate-700 font-semibold whitespace-nowrap transition shadow-2xs"
              >
                ¿Último sismo registrado?
              </button>
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
                    disabled={isGeneratingReport}
                    className={`mt-2 px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 ${
                      isGeneratingReport
                        ? 'bg-blue-400 cursor-not-allowed text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingReport ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingReport ? 'Generando con Gemini...' : 'Regenerar Reporte'}</span>
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

      </div>

      {/* Floating AI Chat Assistant Button & Modal (Bottom Right) */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isFloatingChatOpen ? (
          <button
            onClick={() => setIsFloatingChatOpen(true)}
            className="w-13 h-13 rounded-full bg-[#2d4b43] hover:bg-[#233a34] text-white shadow-xl shadow-slate-900/20 flex items-center justify-center transition-transform hover:scale-105"
            title="Abrir Chat con Asistente IA"
          >
            <Bot className="w-6 h-6" />
          </button>
        ) : (
          <div className="w-[380px] sm:w-[420px] h-[550px] bg-white border border-slate-200/90 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-3 px-4 bg-[#2d4b43] text-white flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5" />
                <div>
                  <h4 className="text-xs font-bold leading-tight">Asistente IA SismoWatch</h4>
                  <p className="text-[10px] text-emerald-200">Grounded en datos sísmicos reales</p>
                </div>
              </div>
              <button
                onClick={() => setIsFloatingChatOpen(false)}
                className="text-emerald-200 hover:text-white p-1 rounded-lg"
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
                    <div>{formatChatContent(m.content)}</div>
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
