import React, { useState, useEffect, useRef, act } from "react";
import './APP.css';

//for scaling longitude and latitude
const LAT_MIN = 40.7000;
const LAT_MAX = 40.8500;
const LON_MIN = -74.0500;
const LON_MAX = -73.8500;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 500;

function projectCoords(lat, lon) {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_WIDTH;
  const y = (1 - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN))) * MAP_HEIGHT;
  return { x, y };
}

function deprojectCoords(x, y) {
  const lon = LON_MIN + (x / MAP_WIDTH) * (LON_MAX - LON_MIN);
  const lat = LAT_MAX + (1 - (y / MAP_HEIGHT)) * (LAT_MAX - LAT_MIN);
  return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
}

export default function App() {
  //state
  const [activeTab, setActiveTab] = useState('dashboard_map');
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  //rate limits
  const [rateLimit, setRateLimit] = useState({ remaining: '100', reset: '0' });
  const [clientSignature, setClientSignature] = useState('Computing security token...');
  const [isAnonymized, setIsAnonymized] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [latencyMs, setLatencyMs] = useState(12);

  //filter and comment
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    status: [],
    priority: '',
    agency: '',
  });

  //form for submission
  const [form, setForm] = useState({
    title: '',
    description: '',
    category_id: '',
    latitude: '',
    longitude: '',
    files: []
  });

  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  //transition panel
  const [adminTransition, setAdminTransition] = useState({
    status: '',
    comment: '',
    administrative_notes: ''
  });
  const [adminMessage, setAdminMessage] = useState(null);


  const [notification, setNotification] = useState(null);


  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mapPlacementCoords, setMapPlacementCoords] = useState(null);


  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const mapSvgRef = useRef(null);

  //api call


  const apiCall = async (url, options = {}) => {
    const startTime = performance.now();
    try {
      const defaultHeaders = {
        'Accept': 'application/json',
      };
      if (options.body && !(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
      }

      const mergedOptions = {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.header
        }
      };

      const response = await fetch(url, mergedOptions);

      //latency check
      const endTime = performance.now();
      setLatencyMs(Math.round(endTime - startTime));
      setConnectionStatus('connected');

      //ask security
      const sig = response.headers.get('X-Client-Signature');
      const anon = response.headers.get('X-Civic-Anonymized');
      const rem = response.headers.get('X-Rate-Limit-Remaining');
      const rst = response.headers.get('X-Rate-Limit-Reset');

      if (sig) setClientSignature(sig);
      if (anon) setIsAnonymized(anon === 'True');
      if (rem && rst) setRateLimit({ remaining: rem, reset: rst });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw { status: response.status, data: errorData };
      }

      return await response.json();
    } catch (error) {
      setConnectionStatus('disconnected');
      throw error;
    }
  };

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const fetchedCats = await apiCall('/api/categories/');
      const fetechedReports = await apiCall('/api/reports/');
      setCategories(fetchedCats);
      setReports(fetechedReports);
      triggerNotification('success', 'App is ready!');
    } catch (err) {
      console.error("Initial load failure:", err);
      triggerNotification('error', 'App is broken. Trying again...');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();


    const interval = setInterval(async () => {
      try {
        const data = await apiCall('/api/reports/', { method: 'GET' });
        setReports(data);
      } catch (e) {
        setConnectionStatus('disconnected');
      }
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  const triggerNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  //vote up
  const handleUpvote = async (reportId) => {
    try {
      const updatedReport = await apiCall(`/api/reports/${reportId}/upvote/`, {
        method: 'POST'
      });

      //cahce updating
      setReports(prev => prev.map(r => r.id === reportId ? updatedReport : r));
      if (selectedReport && selectedReport.id === reportId) {
        setSelectedReport(updatedReport);
      }

      triggerNotification('success', `Liked problem ${updatedReport.ticket_number}`);
    } catch (err) {
      const msg = err.data?.error || 'Could not like it. Please wait.';
      triggerNotification('error', msg);
    }
  };


  const handleStatusTransition = async (e) => {
    e.preventDefault();
    if (!selectedReport) return;
    if (!adminTransition.status) {
      setAdminMessage({ type: 'error', text: 'Pick a new status' });
      return;
    }

    try {
      const updated = await apiCall(`/api/reports/${selectedReport.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(adminTransition)
      });

      setReports(prev => prev.map(r => r.id === selectedReport.id ? updated : r));
      setSelectedReport(updated);
      setAdminTransition({ status: '', comment: '', administrative_notes: '' });
      setAdminMessage({ type: 'success', text: `Problem changed to [${updated.status_display}]` });
      triggerNotification('success', `Problem ${updated.ticket_number} changed`);

      setTimeout(() => setAdminMessage(null), 4000);
    } catch (err) {
      const msg = err.data?.error || 'You cannot change this.';
      setAdminMessage({ type: 'error', text: msg });
    }
  };

  //submit
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    //frontend chck
    const errors = {};
    if (!form.title.trim() || form.title.trim().length < 5) {
      errors.title = "Please write a title (5 letters or more)";
    }
    if (!form.description.trim() || form.description.trim().length < 15) {
      errors.description = "Please tell us more (15 letters or more)";
    }
    if (!form.category_id) {
      errors.category_id = "Please pick what kind of problem this is";
    }

    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);

    if (isNaN(lat) || lat < LAT_MIN || lat > LAT_MAX) {
      errors.latitude = `Must be in the city [${LAT_MIN}, ${LAT_MAX}]`;
      errors.longitude = `Must be in the city [${LON_MIN}, ${LON_MAX}]`;
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      triggerNotification('error', 'Please fix the errors above');
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {

      const payload = new FormData();
      payload.append('title', form.title.trim());
      payload.append('description', form.description.trim());
      payload.append('category', form.category_id);
      payload.append('latitude', lat.toString());
      payload.append('longitude', lon.toString());

      form.files.forEach((file) => {
        payload.append('files', file);
      });

      const response = await apiCall('/api/reports/', {
        method: 'POST',
        body: payload
      });

      if (response.duplicate_matched) {

        triggerNotification('info', response.message);
        setReports(prev => prev.map(r => r.ticket_number === response.ticket_number ? response.data : r));
        setSelectedReport(response.data);
        setActiveTab('dashboard_map');
      } else {
        //add new registrationn
        triggerNotification('success', `Problem saved! Number: ${response.ticket_number}`);
        setReports(prev => [response, ...prev]);
        setSelectedReport(response);
        setActiveTab('dashboard_map');
      }


      setForm({
        title: '',
        description: '',
        category_id: '',
        latitude: '',
        longitude: '',
        files: []
      });
      setMapPlacementCoords(null);
    } catch (err) {
      console.error(err);
      const msg = err.data?.error || 'Could not save. Please check your form.';
      triggerNotification('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };


  const triggerBrowserGeolocation = () => {
    if (!navigator.geolocation) {
      triggerNotification('error', 'Your computer does not know where you are');
      return;
    }

    triggerNotification('info', 'Finding you...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;

        if (latitude >= LAT_MIN && latitude <= LAT_MAX && longitude >= LON_MIN && longitude <= LON_MAX) {
          setForm(prev => ({
            ...prev,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
          }));
          setMapPlacementCoords({ lat: latitude, lon: longitude });
          triggerNotification('success', 'Found you!');
        } else {

          const mocklat = (LAT_MIN + (LAT_MAX - LAT_MIN) * 0.45).toFixed(6);
          const mocklon = (LON_MIN + (LON_MAX - LON_MIN) * 0.55).toFixed(6);
          setForm(prev => ({
            ...prev,
            latitude: mocklat,
            longitude: mocklon
          }));
          setMapPlacementCoords({ lat: parseFloat(mocklat), lon: parseFloat(mocklon) });
          triggerNotification('info', `You are not in the city. We will use a fake spot: (${mocklat}, ${mocklon})`);
        }
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  //map controll

  const handleMapMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDraggingMap(true);
    setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
  };

  const handleMapMouseMove = (e) => {
    if (!isDraggingMap) return;
    setMapOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMapMouseUpOrLeave = () => {
    setIsDraggingMap(false);
  };

  const handleMapZoom = (factor) => {
    setMapScale(prev => Math.min(4, Math.max(0.8, prev + factor)));
  };

  const handleMapReset = () => {
    setMapScale(1);
    setMapOffset({ x: 0, y: 0 });
  };

  const handleMapClick = (e) => {

    if (isDraggingMap) return;

    const svg = mapSvgRef.current;
    if (!svg) return;


    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;


    const svgX = (clickX - rect.width / 2 - mapOffset.x) / mapScale + MAP_HEIGHT / 2;
    const svgY = (clickY - rect.height / 2 - mapOffset.y) / mapScale + MAP_WIDTH / 2;

    if (svgX >= 0 && svgX <= MAP_WIDTH && svgY >= 0 && svgY <= MAP_HEIGHT) {
      const coord = deprojectCoords(svgX, svgY);
      setForm(prev => ({
        ...prev,
        latitude: coord.lat.toString(),
        longitude: coord.lon.toString()
      }));

      triggerNotification('info', `Got the spot: Lat ${coord.lat}, lon ${coord.lon}. Go to Report a Problem tab to save it.`);
    }
  };

  //file handle

  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    processUploadedFiles(droppedFiles);
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    processUploadedFiles(selectedFiles);
  };

  const processUploadedFiles = (fileList) => {
    //only 5mb limit
    const validFiles = [];
    const errors = [];

    fileList.forEach(file => {
      if (!file.type.startsWith('image/')) {
        errors.push(`File ${file.name} not saved. We only take pictures.`);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`File ${file.name} is too big.`);
        return;
      }
      validFiles.push(file);
    });

    if (errors.length > 0) {
      triggerNotification('error', errors.join(''));
    }

    if (validFiles.length > 0) {
      setForm(prev => ({
        ...prev,
        files: [...prev.files, ...validFiles]
      }));
      triggerNotification('success', `Added ${validFiles.length} pictures`);
    }
  };

  const removeSelectedFile = (idx) => {
    setForm(prev => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== idx)
    }));
  };
  //execute
  const handleFilterChange = (key, val) => {
    setFilters(prev => {
      const copy = { ...prev };
      if (key === 'status') {
        const idx = copy.status.indexOf(val);
        if (idx > -1) {
          copy.status = copy.status.filter(s => s !== val);
        } else {
          copy.status = [...copy.status, val];
        }
      } else {
        copy[key] = val;
      }
      return copy;
    });
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      category: '',
      status: [],
      priority: '',
      agency: '',
    });
  };

  const filteredReports = reports.filter(r => {
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const matchText = (r.title + " " + r.description + " " + r.ticket_number).toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    if (filters.category && r.category_detail?.system_slug !== filters.category) {
      return false;
    }

    if (filters.status.length > 0 && !filters.status.includes(r.status)) {
      return false;
    }

    if (filters.priority && r.category_detail?.priority !== filters.priority) {
      return false;
    }

    if (filters.agency && r.category_detail?.assignment_group !== filters.agency) {
      return false;
    }

    return true;
  });

  const getPriorityColor = (priority, override = false) => {
    if (override || priority === 'High') return 'var(--priority-high)';
    if (priority === 'Medium') return 'var(--priority-medium)';
    return 'var(--priority-low)';
  };


  return (
    <div className="app-container">
      {/*notification bar */}
      {notification && (
        <div className={`global-toast-banner toast-${notification.type}`}>
          <div className="toast-icon">
            {notification.type === 'success' && '✓'}
            {notification.type === 'error' && '⚠'}
            {notification.type === 'info' && 'ℹ'}
          </div>
          <div className="toast-message">{notification.message}</div>
          <button className="toast-close" onClick={() => setNotification(null)}>×</button>
        </div>
      )}

      {/* sidebar */}
      <aside className="diagnostic-sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <h2>MY CITY</h2>
            <span>HELPER APP</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'dashboard_map' ? 'active' : ''}`}
            onClick={() => { setActiveTab('dashboard_map'); setSelectedReport(null); }}
          >

            <span className="nav-icon"></span>
            <span className="nav-label">Map</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'ticket_explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('ticket_explorer')}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">List of Problems</span>
            <span className="badge-count">{filteredReports.length}</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'submit_ticket' ? 'active' : ''}`}
            onClick={() => setActiveTab('submit_ticket')}
          >

            <span className="nav-icon"></span>
            <span className="nav-label">Report a Problem</span>


          </button>
          <button
            className={`nav item ${activeTab === 'analytics_insights' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics_insights')}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Charts</span>
          </button>
        </nav>

        {/*check monitor*/}
        <div className="diagnostic-monitor">
          <div className="monitor-header">
            <h3>APP STATUS</h3>
            <span className={`status-dot pulse-${connectionStatus}`}></span>
          </div>

          <div className="monitor-stats">
            <div className="stat-row">
              <span className="stat-label">Speed</span>
              <span className="stat-value">{latencyMs} ms</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Secret Mode</span>
              <span className="stat-value text-green">{isAnonymized ? "ON / HIDDEN" : "OFF"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Tries Left</span>
              <span className="stat-value text-yellow">{rateLimit.remaining} / 6 per min</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Reset Time</span>
              <span className="stat-value">{rateLimit.reset} s</span>
            </div>
          </div>

          <div className="signature-box">
            <div className="sig-label">Secret Code</div>
            <div className="sig-value">{clientSignature}</div>
          </div>
        </div>
      </aside>

      {/* main page*/}
      <main className="main-viewport">

        {/*view coordinate*/}
        {activeTab === 'dashboard_map' && (
          <div className="viewport-layout map-view-tab">
            <div className="panel-header">
              <div>
                <h1>City Map</h1>
                <p>Click on the map to tell us where the problem is.</p>
              </div>
              <div className="map-toolbar">
                <button className="control-btn" onClick={() => handleMapZoom(0.25)} title="Zoom In">+</button>
                <button className="control-btn" onClick={() => handleMapZoom(-0.25)} title="Zoom Out">-</button>
                <button className="control-btn" onClick={handleMapReset} title="Reset Scale">↺</button>
                <span className="zoom-indicator">{Math.round(mapScale * 100)}%</span>
              </div>
            </div>

            <div className="map-canvas-container">
              {/*vector canvas */}
              <svg
                ref={mapSvgRef}
                className={`map-svg-grid ${isDraggingMap ? 'dragging' : ''}`}
                viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
                onMouseDown={handleMapMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={handleMapMouseUpOrLeave}
                onMouseLeave={handleMapMouseUpOrLeave}
                onClick={handleMapClick}
              >

                <g transform={`translate(${MAP_WIDTH / 2 + mapOffset.x}, ${MAP_HEIGHT / 2 + mapOffset.y}) scale(${mapScale}) translate(${-MAP_WIDTH / 2}, ${-MAP_HEIGHT / 2})`}>

                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#grid)" />


                  <path
                    d="M -50,450 Q 200,380 400,280 T 850, 220"
                    fill="none"
                    stroke="rgba(6,182,212,0.15)"
                    strokeWidth="48"
                    strokeLinecap="round"
                  />
                  <text x="250" y="325" fill="rgba(6, 182, 212, 0.3)" fontSize="12" fontWeight="bold" transform="rotate(-15, 250, 325)">METROPOLIS RIVER</text>

                  <rect x="350" y="60" width="160" height="110" rx="10" fill="rgba(34, 197, 94, 0.08)" stroke="rgba(34, 197, 94, 0.15)" strokeWidth="2" />
                  <text x="430" y="115" fill="rgba(34, 197, 94, 0.3)" fontSize="10" textAnchor="middle" fontWeight="bold">CENTRAL PARKWAY</text>


                  <line x1="100" y1="0" x2="100" y2="500" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />
                  <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />


                  {filteredReports.map((report) => {
                    const { x, y } = projectCoords(report.latitude, report.longitude);
                    const isHigh = report.category_detail?.priority === 'High' || report.automated_priority_override;
                    const isMedium = report.category_detail?.priority === 'Medium';
                    const color = getPriorityColor(report.category_detail?.priority, report.automated_priority_override);
                    const isSelected = selectedReport && selectedReport.id === report.id;

                    return (
                      <g
                        key={report.id}
                        className={`map-marker-group ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedReport(report);
                        }}
                      >

                        {isHigh && (
                          <>
                            <circle cx={x} cy={y} r="16" fill="none" stroke={color} strokeWidth="1.5" className="marker-pulse-outer" />
                            <circle cx={x} cy={y} r="10" fill="none" stroke={color} strokeWidth="2" className="marker-pulse-inner" />
                          </>
                        )}


                        {isMedium && (
                          <circle cx={x} cy={y} r="11" fill="none" stroke={color} strokeWidth="1.5" className="marker-pulse-inner" />
                        )}


                        <circle
                          cx={x}
                          cy={y}
                          r={isSelected ? "7" : "5.5"}
                          fill={color}
                          stroke="#0f172a"
                          strokeWidth="2"
                          className="marker-core"
                        />


                        <text x={x} y={y - 12} fill="#94a3b8" fontSize="8" textAnchor="middle" className="marker-tag">
                          {report.ticket_number}
                        </text>
                      </g>
                    )
                  })}


                  {mapPlacementCoords && (() => {
                    const projected = projectCoords(mapPlacementCoords.lat, mapPlacementCoords.lon);
                    return (
                      <g>
                        <path
                          d={`M ${projected.x} ${projected.y - 2}
                            L ${projected.x - 6} ${projected.y - 16}
                            A 6 6 0 1 1 ${projected.x + 6} ${projected.y - 16} z`}
                          fill="var(--accent-cyan)"
                          stroke="#0f172a"
                          strokeWidth="1.5"
                          className="placement-pin-glow"
                        />

                        <circle
                          cx={projected.x}
                          cy={projected.y - 16}
                          r="2.5"
                          fill="#0f172a"
                        />
                      </g>
                    );
                  })()}
                </g>
              </svg>


              {selectedReport && (
                <div className="map-side-drawer-overlay">
                  <div className="drawer-header">
                    <div>
                      <span className="drawer-ticket-tag">{selectedReport.ticket_number}</span>
                      <h2 className="drawer-title">{selectedReport.title}</h2>
                    </div>
                    <button className="drawer-close-btn" onClick={() => setSelectedReport(null)}>×</button>
                  </div>

                  <div className="drawer-scroll-body">

                    <div className="drawer-status-bar">
                      <div
                        className="status-badge"
                        style={{ backgroundColor: `${getPriorityColor(selectedReport.category_detail?.priority, selectedReport.automated_priority_override)}20`, color: getPriorityColor(selectedReport.category_detail?.priority, selectedReport.automated_priority_override) }}
                      >
                        {selectedReport.category_detail?.priority === 'High' ? 'Very Important' : selectedReport.category_detail?.priority}
                      </div>
                      {selectedReport.automated_priority_override && (
                        <span className="ai-override-pill">Smart Pick</span>
                      )}
                      <span className="status-string">State: <strong>{selectedReport.status_display}</strong></span>
                    </div>

                    <div className="drawer-meta-grid">
                      <div className="meta-box">
                        <span>What kind of problem?</span>
                        <strong>{selectedReport.category_detail?.name}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Who is fixing it?</span>
                        <strong>{selectedReport.category_detail?.assignment_group}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Where is it?</span>
                        <strong>{selectedReport.latitude}, {selectedReport.longitude}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Likes</span>
                        <div className="drawer-upvote-counter">
                          <strong>{selectedReport.upvote_count}</strong>
                          <button
                            className="inline-upvote-trigger"
                            onClick={() => handleUpvote(selectedReport.id)}
                            disabled={['Resolved', 'Rejected'].includes(selectedReport.status)}
                          >
                            ▲ Like
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="drawer-description-box">
                      <h4>What happened?</h4>
                      <p>{selectedReport.description}</p>
                    </div>


                    {selectedReport.media_attachments?.length > 0 && (
                      <div className="drawer-media-section">
                        <h4>Pictures ({selectedReport.media_attachments.length})</h4>
                        <div className="carousel-track">
                          {selectedReport.media_attachments.map((img) => (
                            <div key={img.id} className="carousel-slide-card">
                              <img src={img.absolute_url || img.file_path} alt="Incident Evidence" />
                              <span className="slide-meta"> {(img.file_size / 1024).toFixed(1)}KB</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}


                    <div className="drawer-timeline-section">
                      <h4>History</h4>
                      <div className="timeline-tree">
                        {selectedReport.history_logs?.map((log, idx) => (
                          <div key={log.id || idx} className="timeline-node">
                            <div className="timeline-node-dot"></div>
                            <div className="timeline-node-content">
                              <div className="timeline-node-header">
                                <span className="node-transition">{log.previous_status_display} - {log.new_status_display}</span>
                                <span className="node-date">{new Date(log.created_at).toLocaleString()}</span>
                              </div>
                              <p className="node-comment">"{log.comment}"</p>
                              {log.administrative_notes && (
                                <div className="node-admin-notes">
                                  <span>Secret Note:</span> {log.administrative_notes}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>


                    <div className="drawer-admin-section">
                      <h4>Fix It Controls</h4>
                      <form onSubmit={handleStatusTransition} className="admin-status-form">
                        <div className="form-group-row">
                          <div className="form-element">
                            <label>Change Status</label>
                            <select
                              value={adminTransition.status}
                              onChange={(e) => setAdminTransition(prev => ({ ...prev, status: e.target.value }))}
                            >
                              <option value="">Pick Status</option>
                              <option value="Open">Open</option>
                              <option value="Investigating">Looking Into It</option>
                              <option value="Scheduled">Schedule Work</option>
                              <option value="In Progress">Start Work</option>
                              <option value="Resolved">Mark Fixed</option>
                              <option value="Rejected">Cancel Report</option>
                            </select>
                          </div>
                        </div>

                        <div className="form-element">
                          <label>Note for everyone</label>
                          <textarea
                            rows="2"
                            placeholder="Write a note..."
                            value={adminTransition.comment}
                            onChange={(e) => setAdminTransition(prev => ({ ...prev, comment: e.target.value }))}
                          />
                        </div>
                        <div className="form-element">
                          <label>Secret notes</label>
                          <input
                            type="text"
                            placeholder="Write a secret note..."
                            value={adminTransition.administrative_notes}
                            onChange={(e) => setAdminTransition(prev => ({ ...prev, administrative_notes: e.target.value }))}
                          />
                        </div>
                        <button type="submit" className="admin-submit-btn">Save Changes</button>

                        {adminMessage && (
                          <div className={`admin-form-alert alert-${adminMessage.type}`}>
                            {adminMessage.text}
                          </div>
                        )}
                      </form>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/*ticket check*/}
        {activeTab === 'ticket_explorer' && (
          <div className="viewport-layout explorer-view-tab">
            <div className="panel-header">
              <div>
                <h1>List of Problems</h1>
                <p>See what needs fixing and use the filters to find exactly what you're looking for.</p>
              </div>
            </div>

            <div className="explorer-grid-layout">

              <aside className="explorer-filters-panel">
                <div className="filter-panel-header">
                  <h3>SEARCH & FILTER</h3>
                  <button className="reset-filter-btn" onClick={resetFilters}>Clear All</button>
                </div>

                <div className="filter-section">
                  <label className="filter-label">Search words</label>
                  <input
                    type="text"
                    placeholder="Type words or numbers..."
                    className="filter-input-search"
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                  />
                </div>

                <div className="filter-section">
                  <label className="filter-label">Problem Category</label>
                  <select
                    className="filter-select"
                    value={filters.category}
                    onChange={(e) => handleFilterChange('category', e.target.value)}
                  >

                    <option value="">All kinds</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.system_slug}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="filter-section">
                  <label className="filter-label">Who's fixing it?</label>
                  <select
                    className="filter-select"
                    value={filters.agency}
                    onChange={(e) => handleFilterChange('agency', e.target.value)}
                  >

                    <option value="">Everyone</option>
                    <option value="Public Works">Public Works</option>
                    <option value="Animal Control">Animal Control</option>
                    <option value="Traffic Safety">Traffic Safety</option>
                    <option value="Sanitation">Sanitation</option>
                  </select>
                </div>

                <div className="filter-section">
                  <label className="filter-label">How important is it?</label>
                  <select
                    className="filter-select"
                    value={filters.priority}
                    onChange={(e) => handleFilterChange('priority', e.target.value)}
                  >

                    <option value="">All</option>
                    <option value="High">Very Important</option>
                    <option value="Medium">A little bit important</option>
                    <option value="Low">Not very important</option>
                  </select>
                </div>

                <div className="filter-section">
                  <label className="filter-label">Is it fixed yet?</label>
                  <div className="filter-checkbox-group">
                    {['Open', 'Investigating', 'Scheduled', 'In Progress', 'Resolved', 'Rejected'].map((stat) => (
                      <label key={stat} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={filters.status.includes(stat)}
                          onChange={() => handleFilterChange('status', stat)}
                        />
                        <span>{stat}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </aside>

              <section className="explorer-results-dashboard">
                <div className="results-metrics-bar">
                  <span>Showing <strong>{filteredReports.length}</strong> problems out of <strong>{reports.length}</strong></span>
                </div>

                {filteredReports.length === 0 ? (
                  <div className="results-empty-state">
                    <span className="empty-icon"></span>
                    <h3>We could not find any problems like that</h3>
                    <p>Try changing your search words or filters.</p>
                  </div>
                ) : (
                  <div className="explorer-cards-grid">
                    {filteredReports.map((report) => {
                      const color = getPriorityColor(report.category_detail?.priority, report.automated_priority_override);
                      return (
                        <div
                          key={report.id}
                          className="explorer-card"
                          onClick={() => {
                            setSelectedReport(report);
                            setActiveTab('dashboard_map');
                          }}
                        >
                          <div className="card-header">
                            <span className="card-ticket-tag">{report.ticket_number}</span>
                            <div
                              className="card-priority-badge"
                              style={{ backgroundColor: `${color}15`, color: color, borderColor: `${color}30` }}
                            >
                              {report.category_detail?.priority}
                            </div>
                          </div>

                          <h3 className="card-title">{report.title}</h3>
                          <p className="card-description-clip">{report.description}</p>

                          <div className="card-attributes">
                            <div className="attr-item">
                              <span className="attr-label">Fixer</span>
                              <span className="attr-value">{report.category_detail?.assignment_group}</span>
                            </div>
                            <div className="attr-item">
                              <span className="attr-label">Status:</span>
                              <span className="attr-value text-green">{report.status_display}</span>
                            </div>
                          </div>

                          <div className="card-footer">
                            <span className="card-timestamp">{new Date(report.created_at).toLocaleDateString()}</span>

                            <div className="card-actions">
                              {report.media_attachments?.length > 0 && (
                                <span className="media-indicator" title={`${report.media_attachments.length} evidence attachments`}>
                                  📷 {report.media_attachments.length}
                                </span>
                              )}

                              <button
                                className="card-upvote-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpvote(report.id);
                                }}
                                disabled={['Resolved', 'Rejected'].includes(report.status)}
                              >
                                ▲ {report.upvote_count}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}


        {activeTab === 'submit_ticket' && (
          <div className="viewport-layout form-view-tab">
            <div className="panel-header">
              <div>
                <h1>Tell Us About a Problem</h1>
                <p>Let us know if something is broken. We will tell the right people to fix it fast.</p>
              </div>
            </div>

            <div className="form-layout-box">
              <form onSubmit={handleFormSubmit} className="incident-submit-form">

                <div className="form-group-grid">


                  <div className="form-element col-span-2">
                    <label className="element-label">Title</label>
                    <input
                      type="text"
                      placeholder="Example: Smells like gas near the drain"
                      value={form.title}
                      onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                      className={formErrors.title ? 'input-error' : ''}
                    />
                    {formErrors.title && <span className="error-message-tag">{formErrors.title}</span>}
                    <span className="input-hint">Tell us what is wrong in a few words.</span>
                  </div>


                  <div className="form-element col-span-2">
                    <label className="element-label">What kind of problem?</label>
                    <select
                      value={form.category_id}
                      onChange={(e) => setForm(prev => ({ ...prev, category_id: e.target.value }))}
                      className={formErrors.category_id ? 'input-error' : ''}
                    >
                      <option value="">Pick Category</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name} (Assigned: {c.assignment_group})</option>
                      ))}
                    </select>
                    {formErrors.category_id && <span className="error-message-tag">{formErrors.category_id}</span>}
                    <span className="input-hint">This helps us know who should fix it.</span>
                  </div>


                  <div className="form-element">
                    <label className="element-label">Map Latitude</label>
                    <div className="coordinate-input-container">
                      <input
                        type="number"
                        step="0.000001"
                        placeholder={`e.g, 40.7589`}
                        value={form.latitude}
                        onChange={(e) => setForm(prev => ({ ...prev, latitude: e.target.value }))}
                        className={formErrors.latitude ? 'input-error' : ''}
                      />
                    </div>
                    {formErrors.latitude && <span className="error-message-tag">{formErrors.latitude}</span>}
                  </div>

                  <div className="form-element">
                    <label className="element-label">Map Longitude</label>
                    <div className="coordinate-input-containter">
                      <input
                        type="number"
                        step="0.0000001"
                        placeholder={`e.g. -73.9851`}
                        value={form.longitude}
                        onChange={(e) => setForm(prev => ({ ...prev, longitude: e.target.value }))}
                        className={formErrors.longitude ? 'input-error' : ''}
                      />
                    </div>
                    {formErrors.longitude && <span className="error-message-tag">{formErrors.longitude}</span>}
                  </div>


                  <div className="coordinate-actions-ribbon col-span-2">
                    <button
                      type="button"
                      className="coordinate-utility-btn"
                      onClick={triggerBrowserGeolocation}
                    >
                      Use my current location
                    </button>
                    <button
                      type="button"
                      className="coordinate-utility-btn"
                      onClick={() => {
                        setActiveTab('dashboard_map');
                        triggerNotification('info', 'Click on the map grid to capture coordinates');
                      }}
                    >
                      Pick a spot on the map
                    </button>
                  </div>


                  <div className="form-elements col-span-2">
                    <label className="element-label">Tell us more</label>
                    <textarea
                      rows="5"
                      placeholder="Tell us everything you know about it..."
                      value={form.description}
                      onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                      className={formErrors.description ? 'input-error' : ''}
                    />
                    <div className="textarea-counter-bar">
                      {formErrors.description && <span className="error-message-tag">{formErrors.description}</span>}
                      <span className="character-counter">
                        Remaining: {Math.max(0, 1000 - form.description.length)} / Min required: 15
                      </span>
                    </div>
                  </div>


                  <div className="form-element col-span-2">
                    <label className="element-label">Add Pictures</label>

                    <div
                      className={`drag-upload-zone ${isDragOver ? 'drag-over' : ''}`}
                      onDragOver={() => setIsDragOver(false)}
                      onDrop={handleFileDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        multiple
                        accept="image/"
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                      />
                      <span className="upload-icon"></span>
                      <h4>Drag and drop pictures here</h4>
                      <p>Or click to browse your computer.</p>
                    </div>


                    {form.files.length > 0 && (
                      <div className="uploaded-files-carousel">
                        {form.files.map((file, idx) => {
                          const src = URL.createObjectURL(file);
                          return (
                            <div key={idx} className="evidence-preview-card">
                              <img src={src} alt="Upload Preview" />
                              <div className="preview-meta">
                                <span className="preview-filename">{file.name}</span>
                                <span className="preview-size">{(file.size / 1024).toFixed(1)} KB </span>
                              </div>
                              <button
                                type="button"
                                className="remove-preview-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSelectedFile(idx);
                                }}
                              >

                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-submit-row">
                  <button
                    type="submit"
                    className="form-submit-trigger"
                    disabled={isSubmitting}
                  >

                    {isSubmitting ? "Saving..." : "Save Problem"}
                  </button>
                </div>
              </form>
            </div>
          </div>

        )}

        {activeTab === 'analytics_insights' && (
          <div className="viewport-layout analytics-view-tab">
            <div className="panel-header">
              <div>
                <h1>Charts</h1>
                <p>See how many problems are getting fixed in our city.</p>
              </div>
            </div>

            <div className="analytics-dashboard-grid">


              <div className="count-metric-card">
                <h3>All Problems</h3>
                <span className="metric-number">{reports.length}</span>
                <span className="metric-subtext">All problems we know about</span>
              </div>

              <div className="count-metric-card">
                <h3>Problems to Fix</h3>
                <span className="metric-number text-yellow">
                  {reports.filter(r => ['Open', 'Investigating', 'Scheduled', 'In Progress'].includes(r.status)).length}
                </span>
                <span className="metric-subtext">Problems we are working on</span>
              </div>

              <div className="count-metric-card">
                <h3>Fixed Problems</h3>
                <span className="metric-number text=green">
                  {reports.length > 0
                    ? `${Math.round((reports.filter(r => r.status === 'Resolved').length / reports.length) * 100)}%`
                    : '0%'
                  }
                </span>
                <span className="matric-subtext">How many problems are fixed</span>
              </div>

              <div className="count-metric-card">
                <h3>Smart Pick Problems</h3>
                <span className="metric-number text-cyan">
                  {reports.filter(r => r.automated_priority_override).length}
                </span>
                <span className="metric-subtext">Problems the robot thinks are important</span>
              </div>


              <div className="analytics-plot-card col-span-2">
                <h3>Problems by kind</h3>
                <div className="plot-canvas">
                  <svg viewBox="0 0 600 240" className="plot-svg">

                    {categories.map((cat, idx) => {
                      const count = reports.filter(r => r.category_detail?.id === cat.id).length;
                      const maxVal = Math.max(...categories.map(c => reports.filter(r => r.category_detail?.id === c.id).length), 1);
                      const barHeight = (count / maxVal) * 140;
                      const x = 50 + idx * 110;
                      const y = 180 - barHeight;

                      return (
                        <g key={cat.id}>

                          <text x={x + 35} y={y - 8} fill="#94a3b8" fontSize="10" textAnchor="middle" fontWeight="bold">
                            {count}
                          </text>

                          <rect
                            x={x}
                            y={y}
                            width="70"
                            height={barHeight}
                            rx="4"
                            fill="var(--accent-cyan)"
                            opacity="0.75"
                            className="analytics-bar-glow"
                          />

                          <text x={x + 35} y="200" fill="#94a4b8" fontSize="8" textAnchor="middle" transform={`rotate(0, ${x + 35}, 200)`}>
                            {cat.name.split(' ')[0]}
                          </text>
                        </g>
                      );
                    })}

                    <line x1="30" y1="180" x2="580" y2="180" stroke="rgba(148,163,184,0.2)" strokeWidth="2" />
                  </svg>

                </div>
              </div>


              <div className="analytics-plot-card">
                <h3>How important are the problems?</h3>
                <div className="plot-canvas-center">
                  <svg viewBox="0 0 200 200" width="160" height="160" className="plot-svg">

                    {(() => {
                      const high = reports.filter(r => r.category_detail?.priority === 'High' || r.automated_priority_override).length;
                      const med = reports.filter(r => r.category_detail?.priority === 'Medium' && !r.automated_priority_override).length;
                      const low = reports.filter(r => r.category_detail?.priority === 'Low' && !r.automated_priority_override).length;
                      const total = high + med + low || 1;

                      const highPct = high / total;
                      const medPct = med / total;


                      const r = 50;
                      const circ = 2 * Math.PI * r;

                      const dashHigh = circ * highPct
                      const dashMed = circ * medPct;
                      const dashLow = circ * (low / total);

                      return (
                        <g transform="rotate(-90 100 100)">

                          <circle
                            cx="100" cy="100" r={r}
                            fill="none"
                            stroke="var(--priority-high)"
                            strokeWidth="24"
                            strokeDasharray={`${dashHigh} ${circ - dashHigh}`}
                            strokeDashoffset="0"
                          />

                          <circle
                            cx="100" cy="100" r={r}
                            fill="none"
                            stroke="var(--priority-medium)"
                            strokeWidth="24"
                            strokeDasharray={`${dashMed} ${circ - dashMed}`}
                            strokeDashoffset={-dashHigh}
                          />

                          <circle
                            cx="100" cy="100" r={r}
                            fill="none"
                            stroke="var(--priority-low)"
                            strokeWidth="24"
                            strokeDasharray={`${dashLow} ${circ - dashLow}`}
                            strokeDashoffset={-(dashHigh + dashMed)}
                          />
                        </g>
                      );
                    })()}
                  </svg>

                  <div className="pie-legend">
                    <div className="legend-item">
                      <span className="legend-dot bg-red"></span>
                      <span>High ({reports.filter(r => r.category_detail?.priority === 'High' || r.automated_priority_override).length})</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot bg-yellow"></span>
                      <span>Medium ({reports.filter(r => r.category_detail?.priority === 'Medium' && !r.automated_priority_override).length})</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot bg-cyan"></span>
                      <span>Low ({reports.filter(r => r.category_detail?.priority === 'Low' && !r.automated_priority_override).length})</span>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}