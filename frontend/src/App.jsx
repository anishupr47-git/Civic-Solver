import React, {useState,useEffect,useRef} from "react";
import './APP.css';

//Projection constants for scaling Lay/lon coordinates into SVG Viewports
const LAT_MIN = 40.7000;
const LAT_MAX = 40.8500;
const LON_MIN = -74.0500;
const LON_MAX = -73.8500;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 500;

function projectCoords(lat,lon){
  const x = ((lon-LON_MIN)/(LON_MAX - LON_MIN)) * MAP_WIDTH;
  const y = (1-((lat - LAT_MIN) / (LAT_MAX - LAT_MIN))) * MAP_HEIGHT;
  return {x,y};
}

function deprojectCoords(x,y) {
  const lon = LON_MIN + (x/MAP_WIDTH) * (LON_MAX - LON_MIN);
  const lat = LAT_MAX + (1-(y / MAP_HEIGHT)) * (LAT_MAX - LAT_MIN);
  return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6))};
}

export default function App() {
  //State system architecture
  const [activeTab,setActiveTab] = useState('dashboard_map');
  const [reports,seReports] = useState([]);
  const [categories,setCategories] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  //Rate limits and client signature
  const [rateLimit,setRateLimit] = useState ({remaining:'100', reset:'0'});
  const [clientSignature, setClientSignature] = useState('Computing security token...');
  const [isAnonymized, setIsAnonymized] = useState(true);
  const [connectionStatus,setConnectionStatus] = useState('connected');
  const [latencyMs, setLatencyMs] = useState(12);

  //Filter conditions
  const [filters,setFilters] = useState({
    search: '',
    category: '',
    status: [],
    priority: '',
    agency: '',
  });

  //Ticket submission for values
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

  //Administrative transition panel
  const [adminTransition, setAdminTransition] = useState({
    status: '',
    comment: '',
    administrative_notes: ''
  });
  const [adminMessage, setAdminMessage] = useState(null);

  //Global UX Notification
  const [notification, setNotification] = useState(null);

  //SVG MAP Navigation state
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({x:0, y:0});
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [dragStart, setDragStart] = useState({x:0,y:0});
  const [mapPlacementCoords, setMapPlacementCoords] = useState(null);

  //File drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const mapSvgRef = useRef(null);

  //API LAYER AND SIDE EFFECTS

  //CUSTOM FETCH WRAPPER FOR SECURITY TARGETS
  const apiCall = async (url , options = {}) => {
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

      //compute speed latency metrics
      const endTime = performance.now();
      setLatencyMs(Math.round(endTime-startTime));
      setConnectionStatus('connected');

      //Capture security
      const sig = response.headers.get('X-Client-Signature');
      const anon = response.headers.get('X-Civic-Anonymized');
      const rem = response.headers.get('X-Rate-Limit-Remaining');
      const rst = response.headers.get('X-Rate-Limit-Reset');

      if (sig) setClientSignature(sig);
      if (anon) setIsAnonymized(anon==='True');
      if (rem && rst) setRateLimit({ remaining: rem, reset: rst});

      if (!response.ok) {
        const errorData = await response.json().catch(()=> ({}));
        throw { status: response.status, data:errorData};
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
      triggerNotification('success', 'Civic database loaded successfully from municipal grid');
    } catch (err) {
      console.error("Initial load failure:", err);
      triggerNotification('error', 'Database connection offline. Retrying Connection...');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();

    //Setup active ping for rate updates
    const interval = setInterval(async ()=> {
      try {
        const data = await apiCall('/api/reports/', {method: 'GET'});
        setReports(data);
      } catch(e) {
        setConnectionStatus('disconnected');
      }
    },12000);

    return () => clearInterval(interval);
  }, []);

  const triggerNotification = (type, message) => {
    setNotification({type, message});
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  //Upvote Action
  const handleUpvote = async (reportId) => {
    try {
      const updatedReport = await apiCall(`/api/reports/${reportId}/upvote/`, {
        method: 'POST'
      });

      //Update data caches
      setReports(prev=> prev.map(r=>r.id===reportId? updatedReport: r));
      if (selectedReport && selectedReport.id === reportId) {
        setSelectedReport(updatedReport);
      }

      triggerNotification('success', `Upvote recorded for ticket ${updatedReport.ticket_number}`);
    } catch (err) {
      const msg = err.data?.error || 'Failed to submit upvote. Rate limit exceeded';
      triggerNotification('error',msg);
    }
  };

  //Administrative state transitions
  const handleStatusTransition = async (e) => {
    e.preventDefault();
    if (!selectedReport) return;
    if (!adminTransition.status){
      setAdminMessage({type:'error', text: 'Select a target transition state'});
      return;
    }

    try {
      const updated = await apiCall(`/api/reports/${selectedReport.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(adminTransition)
      });

      setReports(prev=>prev.map(r=>r.id===selectedReport.id? updated:r));
      setSelectedReport(updated);
      setAdminTransition({status: '', comment:'', administrative_notes:''});
      setAdminMessage({type:'success',text:`Ticket successfully transitioned to [${updated.status_display}]`});
      triggerNotification('success',`Ticket ${updated.ticket_number} transitioned successfully`);

      setTimeout(()=> setAdminMessage(null), 4000);
    } catch (err) {
      const msg = err.data?.error || 'Transition denied by municipal security bounds';
      setAdminMessage({type:'error', text: msg});
    }
  };

  //Submit ticket form action
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    //Frontend validations
    const errors = {};
    if (!form.title.trim() || form.title.trim().length<5) {
      errors.title = "Summary title is required (at least 5 characters";
    }
    if (!form.description.trim()||form.description.trim().length<15){
      errors.description = "Provide detailed description of the incident (atleast 15 characters)";
    }
    if (!form.category_id) {
      errors.category_id = "Please pick a civic classification group";
    }

    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);

    if (isNaN(lat) || lat < LAT_MIN || lat > LAT_MAX) {
      errors.latitude = `Latitude must be included inside municipal bounds [${LAT_MIN}, ${LAT_MAX}]`;
      errors.longitude = `Longitude must be included inside municipal bounds [${LON_MIN}, ${LON_MAX}]`;
    }

    if (Object.keys(errors).length > 0){
      setFormErrors(errors);
      triggerNotification('error', 'Form contains invalid parameters. Please review warnings');
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      //construct formdata for multipart images integration
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
        method: 'POST' ,
        body: payload
      });

      if (response.duplicate_matched) {
        //spatial engine absorbed the ticket
        triggerNotification('info', response.message);
        seReports(prev=>prev.map(r=>r.ticket_number === response.ticket_number ? response.data : r));
        setSelectedReport(response.data);
        setActiveTab('dashboard_map');
      } else {
        //Brand new register
        triggerNotification('success', `Incident logged successfully! Ticket: ${response.ticket_number}`);
        seReports(prev => [response, ...prev]);
        selectedReport(response);
        setActiveTab('dashboard_map');
      }

      //Reset form variables
      setForm({
        title:'',
        description:'',
        category_id:'',
        latitude:'',
        longitude:'',
        files: []
      });
      setMapPlacementCoords(null);
    } catch (err) {
      console.error(err);
      const msg = err.data?.error || 'Pipeline creation failed. Verify rates and coordinates';
      triggerNotification('error',msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  //Browser Geolocation Grabber
  const triggerBrowserGeolocation = () => {
    if (!navigator.geolocation) {
      triggerNotification('error', 'Geoloaction is not supported by your browser software');
      return;
    }

    triggerNotification('info', 'Contacting GPS nodes...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude,longitude } = pos.coords;
        //verify points sit in city boundary thresholds before populating
        if (latitude >= LAT_MIN && latitude <= LAT_MAX && longitude >= LON_MIN && longitude <= LON_MAX) {
          setForm(prev => ({
            ...prev,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
          }));
          setMapPlacementCoords({lat:latitude,lon:longitude});
          triggerNotification('success', 'Municipal coordinates locked successfully');
        } else {
          // If browser returns true location outside mock boundaries, we mock center coordinates
          // but simulate browser action for demonstration safety
          const mocklat = (LAT_MIN + (LAT_MAX - LAT_MIN) * 0.45).toFixed(6);
          const mocklon = (LON_MIN + (LON_MAX - LON_MIN) * 0.55).toFixed(6);
          setForm(prev => ({
            ...prev,
            latitude: mocklat,
            longitude: mocklon
          }));
          setMapPlacementCoords({lat: parseFloat(mocklat), lon: parseFloat(mocklon)});
          triggerNotification('info', `Your physical location falls outside Metropolis borders. Seed mock coordinates within limits instead: (${mocklat}, ${mocklon})`);
        }
      },
      {enableHighAccuracy: true, timeout:5000}
    );
  };

  //Interactive map controls

  const handleMapMouseDown = (e) => {
    if (e.button !==0) return;
    setIsDraggingMap(true);
    setDragStart({x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
  };

  const handleMapMouseMove = (e) => {
    if (!isDraggingMap) return;
    setIsDraggingMap(true);
    setDragStart({x: e.clientX - mapOffset.x, y:e.clientY - mapOffset.y});
  };

  const handleMapMouseUpOrLeave = () => {
    setIsDraggingMap(false);
  };

  const handleMapZoom = (factor) => {
    setMapScale(prev => Math.min(4, Math.max(0.8, prev+factor)));
  };

  const handleMapReset = () => {
    setMapScale(1);
    setMapOffset({x:0,y:0});
  };

  const handleMapClick = (e) => {
    //Avoid registration clicks while dragging map
    if (isDraggingMap) return;

    const svg = mapSvgRef.current;
    if (!svg) return;

    //Get mouse offset inside svg element
    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    //Adjust for current scale and offset parameters
    const svgX = (clickX - rect.width / 2 - mapOffset.x) / mapScale + MAP_HEIGHT / 2;
    const svgY = (clickY - rect.height / 2 - mapOffset.y) / mapScale + MAP_WIDTH / 2;

    if (svgX >= 0 && svgX <= MAP_WIDTH && svgY >= 0 && svgY <= MAP_HEIGHT) {
      const coord = deprojectCoords(svgX,svgY);
      setForm(prev => ({
        ...prev,
        latitude: coord.lat.toString(),
        longitude: coord.lon.toString()
      }));

      triggerNotification('info', `Target coordinates captured: Lat ${coord.lat}, lon ${coord.lon} Shift to Submit tab to regiser`);
    }
  };

  // FILE HANDLING

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

  const processUploadFiles = (fileList) => {
    //standard validation upto 5mb only
    const validFiles = [];
    const errors = [];

    fileList.forEach(file => {
      if (!file.type.startsWith ('image/')) {
        errors.push(`File ${file.name} ignored. Only images are permitted`);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`File ${file.name} is too large. Max size allowed is 5 MB`);
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
      triggerNotification('success', `Added ${validFiles.length} evidence images`);
    }
  };

  const removeSelectedFile = (idx) => {
    setForm(prev => ({
      ...prev,
      files: prev.files.filter((_, i)=> i !== idx)
    }));
  };
  //Filter execution pipeline
  const handleFilterChange = (key, val) => {
    setFilters(prev => {
      const copy = {...prev};
      if (key === 'status') {
        const idx = copy.status.indexOf(val);
        if (idx > -1) {
          copy.status = copy.status.filter(s=>s !== val);
        } else {
          copy.status = [...copy.status, val];
        }
      } else {
        copy [key] = val;
      }
      return copy;
    });
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      category: '',
      status: [],
      proiority: '',
      agency: '',
    });
  };

  const filteredReports = reports.filter(r => {
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const matchText = (r.title+" "+r.description+ " " + r.ticket_number).toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    if (filters.category && r.category_detail?.system_slug !== filters.category) {
      return false;
    }

    if (filters.status.length > 0 && !filters.status.includes(r.status)) {
      return false;
    }

    if (filters.priority && r.category_detail?.proiority !== filters.priority) {
      return false;
    }

    if (filters.agency  && r.category_detail?.assignment_group !== filters.agency) {
      return false;
    }

    return true;
    });
    //Urgency color badges mapping
    const getPriorityColor = (priority, override = false) => {
      if (override || priority === 'High') return 'var(--priority-high)';
      if (priority === 'Medium') return 'var(--priority-medium)';
      return 'var(--priority-low)';
    };
    

    return (
      <div className="app-container">
      {/* --- GLOBAL NOTIFICATION BAR --- */}
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

      {/* SIDEBAR */}
      <aside className="diagnostic-sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <h2>METROPOLIS</h2>
            <span>CIVIC DISPATCH GRID</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
          className={`nav-item ${activeTab==='dashboard_map'?'active':''}`}
          onClick={()=>{setActiveTab('dashboard_map'); setSelectedReport(null);}}
          >

            <span className="nav-icon">🗺</span>
            <span className="nav-label">Coordinate Map</span>
          </button>
          <button
          className={`nav-item ${activeTab==='ticket_explorer' ? 'active' : ''}`}
          onClick={()=> setActiveTab('ticket_explorer')}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Ticket Explorer</span>
            <span className="badge-count">{filteredReports.length}</span>
          </button>
          <button
          className={`nav-item ${activeTab === 'submit_ticket' ? 'active': ''}`}
          onClick={()=> setActiveTab('submit_ticket')}
          >

            <span className="nav-icon"></span>
            <span className="nav-label"></span>
            
          </button>
          <button
          className={`nav item ${activeTab==='analytics_insights'?'active': ''}`}
          onClick={()=> setActiveTab('analytics_insights')}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Grid Analytics</span>
          </button>
        </nav>

        {/*Diagnostic monitor */}
        <div className="diagnostic-monitor">
          <div className="monitor-header">
            <h3>SYSTEM STATUS</h3>
            <span className={`status-dot pulse-${connectionStatus}`}></span>
          </div>

          <div className="monitor-stats">
            <div className="stat-row">
              <span className="stat-label">Grid Latency</span>
              <span className="stat-value">{latencyMs} ms</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Anonymizer</span>
              <span className="stat-value text-green">{isAnonymized ? "ACTIVE / SCRUBBED" : "DISABLED"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Submission Left</span>
              <span className="stat-value text-yellow">{rateLimit.remaining} / 6 per min</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Registry Reset</span>
              <span className="stat-value">{rateLimit.reset} s</span>
            </div>
          </div>

          <div className="signature-box">
            <div className="sig-label">SHA-256 Citizen Signature</div>
            <div className="sig-value">{clientSignature}</div>
          </div>
        </div>
      </aside>

      {/* MAIN PAGE VIEW CONTENT */}
      <main className="main-viewport">

        {/*TAB 1: COORDINATE MAP VIEW*/}
        {activeTab === 'dashboard_map' && (
          <div className="viewport-layout map-view-tab">
            <div className="panel-header">
              <div>
                <h1>City Coordinate Grid</h1>
                <p>Topological interactive vector matrix. Pulsating highlights show active safety overrides. Click Map to grab coordinate nodes</p>
              </div>
              <div className="map-toolbar">
                <button className="control-btn" onClick={()=>handleMapZoom(0.25)} title="Zoom In">+</button>
                <button className="control-btn" onClick={()=> handleMapZoom(-0.25)} title="Zoom Out">-</button>
                <button className="control-btn" onClick={()=> handleMapReset} title="Reset Scale">↺</button>
                <span className="zoom-indicator">{Math.round(mapScale*100)}%</span>
              </div>
            </div>

            <div className="map-canvas-container">
              {/*Vector Canvas */}
              <svg
              ref={mapSvgRef}
              className={`map-svg-grid ${isDraggingMap ? 'dragging' : ''}`}
              viewBox= {`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              onMouseDown={handleMapMouseDown}
              onMouseMove={handleMapMouseMove}
              onMouseUp={handleMapMouseUpOrLeave}
              onMouseLeave={handleMapMouseUpOrLeave}
              onClick={handleMapClick}
              >
                {/*scale and pan wrapper */}
                <g transform={`translate(${MAP_WIDTH / 2 + mapOffset.x}, ${MAP_HEIGHT / 2 + mapOffset.y}) scale(${mapScale}) translate(${-MAP_WIDTH / 2}, ${-MAP_HEIGHT / 2})`}>
                 
                 {/*Backrgound gridlines */}
                 <defs>
                  <pattern id="grid" width="40" height="40" patternUnits="useSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1"/>
                  </pattern>
                 </defs>
                 <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#grid)" />

                 {/* rive mock */}
                 <path
                 d="M -50,450 Q 200,380 400,280 T 850, 220"
                 fill="none"
                 stroke="rgba(6,182,212,0.15)"
                 strokeWidth="48"
                 strokeLinecap="round"
                 />
                 <text x="250" y="325" fill="rgba(6, 182, 212, 0.3)" fontSize="12" fontWeight="bold" transform="rotate(-15, 250, 325)">METROPOLIS RIVER</text>

                  {/* Municipal Park Mock */}
                  <rect x="350" y="60" width="160" height="110" rx="10" fill="rgba(34, 197, 94, 0.08)" stroke="rgba(34, 197, 94, 0.15)" strokeWidth="2" />
                  <text x="430" y="115" fill="rgba(34, 197, 94, 0.3)" fontSize="10" textAnchor="middle" fontWeight="bold">CENTRAL PARKWAY</text>

                  {/* Major Expressways */}
                  <line x1="100" y1="0" x2="100" y2="500" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />
                  <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />

                  {/*Plot Active Incident Marker */}
                  {filteredReports.map((report) => {
                    const {x,y} = projectCoords(report.latitude, report.longitude);
                    const isHigh = report.category_detail?.priority === 'High' || report.automated_priority_override;
                    const isMedium = report.category_detail?.priority === 'Medium';
                    const color = getPriorityColor(report.category_detail?.priority, report.automated_priority_override);
                    const isSelected = selectedReport && selectedReport.id === report.id;

                    return (
                      <g
                      key={report.id}
                      className={`map-marker-group ${isSelected ? 'selected': ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedReport(report);
                      }}
                      >
                        {/*High priority glowing concentric pulses */}
                        {isHigh && (
                          <>
                          <circle cx={x} cy={y} r="16" fill="none" stroke={color} strokeWidth="1.5" className="marker-pulse-outer" />
                          <circle cx={x} cy={y} r="10" fil="none" stroke={color} strokeWidth="2" className="marker-pulse-inner" />
                          </>
                        )}

                        {/*Manual Click Coordinates Grab Marker */}
                        {mapPlacementCoords && (() => {
                          const projected = projectCoords(mapPlacementCoords.lat, mapPlacementCoords.lon);
                          return (
                            <g>
                              <path
                              d={`M ${projected.x} ${projected.y - 2}
                                  L ${projected.x -6} ${projected.y -16}
                                  A 6 6 0 1 1 ${projected.x+6} ${projected.y - 16} z`}
                              fill="var(--accent-cyan)"
                              stroke="#0f172a"
                              strokeWidth="1.5"
                              className="placement-pin-glow"
                              />

                              <circle
                               cx={projected.x}
                               cy=
                          )
                        })}
                      </g>
                    )
                  })}
              </svg>
            </div>
          </div>
        )}
      </main>

    )
}