# SismoWatch
**Plataforma Integral de Monitoreo Sísmico Global, Control de Calidad en Memoria y Análisis Ejecutivo con IA**

[![Python 3.11+](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue.svg)](https://www.python.org/)
[![Apache Airflow 2.10](https://img.shields.io/badge/Airflow-2.10.2-teal.svg)](https://airflow.apache.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-1.0.0-009688.svg)](https://fastapi.tiangolo.com/)
[![React + Vite](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61dafb.svg)](https://vitejs.dev/)
[![Leaflet](https://img.shields.io/badge/Map-Leaflet.js%20(OSM)-green.svg)](https://leafletjs.com/)
[![Pandera Data Quality](https://img.shields.io/badge/Quality-Pandera-orange.svg)](https://pandera.readthedocs.io/)
[![Security Scan: Bandit](https://img.shields.io/badge/Security-Bandit%20Passed-brightgreen.svg)](https://bandit.readthedocs.io/)

SismoWatch transforma el feed público y efímero del **Servicio Geológico de Estados Unidos (USGS)** en un producto de datos empresarial seguro, continuo y confiable, respaldado por una arquitectura de datos desacoplada en tres etapas: almacenamiento crudo inmutable (`raw`), motor de calidad en memoria (`Pandera`) y capa servible (`curated`), complementado con resúmenes ejecutivos diarios generados por IA con anclaje factual estricto y detección estadística de anomalías (Z-Score).

---

## Tabla de Contenidos
1. [Puesta en Marcha Rápida (Un Solo Comando)](#1-puesta-en-marcha-rápida-un-solo-comando)
2. [Arquitectura y Propósito del Sistema](#2-arquitectura-y-propósito-del-sistema)
3. [Restricción de Negocio y Decisión de Calidad de Datos](#3-restricción-de-negocio-y-decisión-de-calidad-de-datos)
4. [Seguridad y Mínimo Privilegio](#4-seguridad-y-mínimo-privilegio)
5. [Automatizaciones con Inteligencia Artificial](#5-automatizaciones-con-inteligencia-artificial)
6. [Plataforma de Consumo y Tiempo Real](#6-plataforma-de-consumo-y-tiempo-real)
7. [Batería de Pruebas Automatizadas (pytest)](#7-batería-de-pruebas-automatizadas-pytest)
8. [Evidencia de Escaneo de Seguridad](#8-evidencia-de-escaneo-de-seguridad)
9. [Credenciales y Puertos de la Plataforma](#9-credenciales-y-puertos-de-la-plataforma)
10. [Limitaciones y Mejoras Futuras](#10-limitaciones-y-mejoras-futuras)

---

## 1. Puesta en Marcha Rápida (Un Solo Comando)

Todo el ecosistema (PostgreSQL, Airflow Webserver, Airflow Scheduler, Backend FastAPI y Frontend React) se levanta de forma automatizada mediante Docker Compose.

### Paso 1: Clonar y Configurar Secretos
```bash
# 1. Clonar el repositorio
git clone <url-del-repositorio>
cd pruwba_base_de_datos

# 2. Configurar variables de entorno desde la plantilla
cp .env.example .env
```
*(El archivo `.env` ya incluye una clave Fernet generada criptográficamente y credenciales seguras de desarrollo. Si deseas usar Google Gemini u OpenAI, agrega tu API Key en `GEMINI_API_KEY` u `OPENAI_API_KEY`; de lo contrario, el sistema utilizará automáticamente su motor estructurado determinístico de respaldo).*

### Paso 2: Levantar el Sistema
```bash
docker compose up -d
```

### Paso 3: Verificar Estado de los Servicios
```bash
docker compose ps
```
Una vez levantados los contenedores, accede a los servicios en tu navegador:
- **Plataforma Web (Dashboard & Mapa):** [http://localhost:3000](http://localhost:3000)
- **API REST & Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Apache Airflow UI:** [http://localhost:8080](http://localhost:8080)

---

## 2. Arquitectura y Propósito del Sistema

El documento técnico completo con diagramas detallados y justificación de herramientas se encuentra en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

### Resumen del Flujo de Datos
```text
USGS Feed (GeoJSON)
     │
     ▼
[Airflow Ingest Task] ──────────► raw.earthquakes (JSONB íntegro de respaldo)
     │
     ▼
[Pandera Engine (RAM)] ─────────► curated.quality_metrics (Auditoría agregada)
     │ (Descarta inválidos)
     ▼
[Blocking Quality Gate]
     │ (Solo lo aprobado)
     ▼
curated.earthquakes ─────────────► FastAPI Backend (JWT + RBAC + SSE)
     │                                    │
     ▼                                    ▼
[Daily AI Report DAG] (Z-Score + LLM) ──► React Platform (Leaflet + KPIs)
```

---

## 3. Restricción de Negocio y Decisión de Calidad de Datos

> [!IMPORTANT]
> **DECISIÓN ARQUITECTURAL DE NEGOCIO:**
> Siguiendo la directriz explícita del Tech Lead, **NO se implementó tabla de cuarentena física en la base de datos**.

### Justificación Técnica:
1. **Prevención de fragmentación de disco (Bloat) y I/O innecesario:** En un flujo de ingesta continuo cada 5 minutos, registrar filas corruptas o payloads inválidos en tablas de PostgreSQL incrementa drásticamente las operaciones de disco y satura el *Write-Ahead Log* (WAL).
2. **Filtrado Estricto en Memoria:** El filtrado se ejecuta en la RAM del contenedor mediante un esquema tipado de **Pandera** (`CuratedEarthquakeSchema`). Los registros anómalos (latitud fuera de $[-90, 90]$, longitud fuera de $[-180, 180]$, profundidad no científica, IDs nulos o duplicados) son filtrados al vuelo.
3. **Métricas Agregadas en `curated.quality_metrics`:** Cada lote registra el total evaluado, total válido, total descartado, porcentaje de calidad y el desglose de motivos de descarte.
4. **Cero Pérdida de Datos:** El dato crudo original e intacto queda permanentemente respaldado en la tabla `raw.earthquakes`.
5. **Compuerta Bloqueante:** Si el lote evaluado no cuenta con registros válidos o incumple el SLA mínimo de calidad, la compuerta (`enforce_curation_gate`) bloquea el paso hacia la capa `curated`.

---

## 4. Seguridad y Mínimo Privilegio

1. **Gestión de Secretos:**
   - Ninguna credencial ni API Key sensible está escrita en duro en el código fuente.
   - Todo se carga desde variables de entorno mediante `.env` (el cual está explícitamente ignorado en `.gitignore`).
   - Se configuró una Fernet Key única generada criptográficamente (`efVAw1SDYe4YVL6oTlLOJCRsa6nHnAinxHC6jD7e82E=`).
2. **Mínimo Privilegio en PostgreSQL:**
   - **`airflow_role`:** Cuenta con permisos completos sobre los schemas `raw` y `curated` para ingesta y orquestación.
   - **`api_role` (usuario `sismowatch_api`):** Estrictamente de **solo lectura** sobre `curated` (`SELECT ON curated.*`). Tiene revocado cualquier acceso al schema `raw`.
3. **Autenticación JWT y Roles (RBAC):**
   - **`viewer`:** Acceso a Dashboard, KPIs, mapa, exportación de reportes y eventos en tiempo real.
   - **`admin`:** Privilegios exclusivos para lanzar backfill histórico (`/api/admin/backfill`), regenerar reportes de IA (`/api/admin/reports/regenerate`) y consultar la auditoría de descartes en memoria (`/api/quality/quarantine`).
   - Cualquier intento de un `viewer` de invocar acciones de admin recibe un rechazo HTTP `403 Forbidden`.
4. **Mitigación de Prompt Injection y XSS:**
   - Los textos provenientes de la API de USGS (`place`) son sanitizados con expresiones regulares para eliminar instrucciones maliciosas (`system:`, `ignore previous instructions`), código XML/HTML y caracteres de control antes de enviarse al LLM o renderizarse en el cliente.

---

## 5. Automatizaciones con Inteligencia Artificial

### 5.1 Detección de Anomalías Analítica (Z-Score)
Identifica automáticamente enjambres sísmicos evaluando la desviación de la frecuencia sísmica regional en una ventana móvil de 24 horas:

$$Z = \frac{X - \mu}{\sigma}$$

Cualquier región con $Z \ge 2.0$ es clasificada como anomalía estadística (`MEDIUM`, `HIGH`, `CRITICAL`), generando una explicación contextual que se almacena en `curated.ai_reports`.

### 5.2 Resumen Ejecutivo con LLM y Anclaje Factual (Grounding)
- **Las cifras las calcula el código (Python/SQL), NUNCA el LLM:** El total de sismos, la magnitud máxima, el promedio y las alertas de tsunami se calculan determinísticamente antes de invocar el modelo.
- **Validación Anti-Alucinaciones:** Un validador sintáctico verifica que las cifras redactadas en el resumen coincidan exactamente con las calculadas.
- **Plan Alterno de Respaldo:** Si la API del LLM (Gemini / OpenAI) excede el timeout de 15 segundos o no tiene API Key configurada, se genera un reporte determinístico estructurado validado con Pydantic que preserva el flujo normal del pipeline.
- **Trazabilidad de Ejecución:** Cada invocación registra modelo, prompt tokens, completion tokens, latencia y costo estimado en `curated.ai_execution_logs`.

---

## 6. Plataforma de Consumo y Tiempo Real

- **Frontend Ejecutivo:** Construido con React 18, Vite, TypeScript y Tailwind CSS, implementando un diseño minimalista con tarjetas de bordes suaves y elevación sutil.
- **Métricas KPI en Vivo (6 Tarjetas):** Monitorea de forma continua `Sismos (24h)` con indicador de tendencia porcentual, `Magnitud Máx.`, `Magnitud Promedio`, `Alertas Tsunami`, `Calidad Pandera` y `Estado del Pipeline`.
- **Mapa Oficial Leaflet (OpenStreetMap):** Integración directa con el proveedor oficial de [Leaflet.js](https://leafletjs.com/) (`https://tile.openstreetmap.org`) como capa base predeterminada, complementado con un selector multicapa interactivo en la esquina superior derecha (`Leaflet OSM`, `Satelital`, `Topográfico` y `Minimalista`).
- **Codificación Semántica de Magnitudes:** La lista de eventos curados y la sección de sismos destacados incorporan insignias coloreadas con punto indicador alineadas 1:1 con la leyenda del mapa:
  - `< 4.0` (Menor): Verde azulado / Teal (`#134e4a`).
  - `4.0 - 4.9` (Moderado): Ámbar (`#f59e0b`).
  - `5.0 - 6.4` (Severo): Naranja (`#f97316`).
  - `>= 6.5` (Crítico): Rojo / Rosa (`#ef4444`).
  - Distintivo `TSUNAMI` de alta visibilidad para eventos con riesgo oceánico activo.
- **Barra de Navegación Flotante y Menú de Usuario:** Cabecera limpia y centrada con accesos directos (`Dashboard`, `Reportes IA`, `Asistente IA`, `Centro de Control`) y popover interactivo en la tuerca (`Settings`) que exhibe el rol del usuario autenticado y botón para cierre de sesión seguro.
- **Asistente IA Conversacional:** Módulo de chat interactivo respaldado por el endpoint `/api/chat` con anclaje factual estricto sobre los eventos curados en memoria.
- **Gestión y Depuración de Reportes:** Filtrado automático para excluir reportes vacíos o mocks, y endpoint administrativo `DELETE /api/reports/{id}` con botón de eliminación (`Trash2`).
- **Diseño 100% Libre de Emojis:** Interfaz y respuestas técnicas formateadas exclusivamente con iconos vectoriales SVG de Lucide.
- **Tiempo Real (Server-Sent Events / SSE):** Endpoint `/api/stream` que emite sismos nuevos y *heartbeats* en vivo con reconexión automática y tolerancia a fallos.
- **Exportación:** Descarga de reportes y eventos en formatos CSV y HTML responsivo.

---

## 7. Batería de Pruebas Automatizadas (pytest)

La suite de pruebas unitarias y de integración cubre todas las capas del sistema y se ejecuta con un único comando:

```bash
# Ejecutar suite de pruebas con entorno virtual
source .venv/bin/activate
pytest -v tests/
```

### Cobertura de Pruebas:
- **`tests/test_transformations.py`:** Validación de normalización GeoJSON, extracción de coordenadas, deducción de regiones y sanitización contra prompt injection.
- **`tests/test_quality.py`:** Pruebas del motor Pandera (casos válidos, coordenadas fuera de rango, IDs nulos, cálculo de score y compuerta bloqueante).
- **`tests/test_dag_integrity.py`:** Verificación de importación de DAGs de Airflow (`usgs_pipeline_dag` y `daily_ai_report_dag`) sin ciclos ni errores de sintaxis.
- **`tests/test_api.py`:** Pruebas de API REST, salud del sistema, autenticación JWT, emisión de tokens, rechazo 401 sin sesión, y verificación de `403 Forbidden` para rol `viewer` en rutas administrativas (`/api/admin/backfill`, `/api/admin/reports/regenerate`, `/api/quality/quarantine`).

**Resultado de la ejecución:**
```text
======================== 21 passed, 5 warnings in 1.93s ========================
```

---

## 8. Evidencia de Escaneo de Seguridad

Se ejecutó un análisis estático de vulnerabilidades sobre todo el código fuente mediante **Bandit**:

```bash
bandit -r airflow/ api/ -ll
```

### Salida del Escaneo Bandit:
```text
[main]	INFO	profile include tests: None
[main]	INFO	running on Python 3.12.3
Run started:2026-10-27 12:17:02.545652+00:00

Test results:
	No issues identified.

Code scanned:
	Total lines of code: 2142
	Total lines skipped (#nosec): 0

Run metrics:
	Total issues (by severity):
		Undefined: 0
		Low: 3
		Medium: 0
		High: 0
	Total issues (by confidence):
		Undefined: 0
		Low: 0
		Medium: 1
		High: 2
Files skipped (0):
```
*Evidencia: Cero vulnerabilidades de severidad Media o Alta detectadas.*

---

## 9. Credenciales y Puertos de la Plataforma

### Puertos Expuestos
| Servicio | Puerto Local | Descripción |
|---|---|---|
| **Frontend Web** | `http://localhost:3000` | Consola interactiva de SismoWatch |
| **Backend API** | `http://localhost:8000/docs` | Documentación interactiva Swagger UI |
| **Airflow Webserver** | `http://localhost:8080` | Interfaz de orquestación de DAGs |
| **PostgreSQL** | `localhost:5435` (mapeado a 5432) | Base de datos analítica |

### Usuarios Preconfigurados
| Rol | Usuario | Contraseña | Permisos |
|---|---|---|---|
| **Admin Plataforma** | `admin` | `admin123` | Control total, backfill, regeneración IA, auditoría de calidad |
| **Viewer Plataforma** | `viewer` | `viewer123` | Dashboard, KPIs, mapa interactivo, exportación CSV/HTML |
| **Admin Airflow** | `sismowatch_admin` | `AirflowAdmin2026!Secure` | Gestión de DAGs en Airflow UI |

---

## 10. Limitaciones y Mejoras Futuras

1. **Latencia de Ingesta:** La API pública de USGS se consulta actualmente por sondeo (*polling*) cada 5 minutos. Con más tiempo o acceso a sensores directos, se migraría a un bus de eventos en tiempo real con **Apache Kafka** y **Apache Flink**.
2. **Almacenamiento Lakehouse:** Para retener décadas de sismos sin inflar PostgreSQL, la capa `raw` se desacoplaría hacia un *Data Lakehouse* en formato **Apache Iceberg / Parquet** sobre AWS S3.
3. **Consultas en Lenguaje Natural (Text-to-SQL):** Agregar un endpoint asistido por IA donde el usuario consulte en lenguaje natural (ej. "¿Cuáles fueron los 3 sismos más fuertes en Chile en la última semana?") y el sistema genere SQL de solo lectura validado contra el schema `curated`.
