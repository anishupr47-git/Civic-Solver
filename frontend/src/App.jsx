import React, { useState, useEffect, useRef } from "react";
import './App.css';

const LAT_MIN = 40.7000;
const LAT_MAX = 40.8500;
const LON_MIN = -74.0500;
const LON_MAX = -73.8500;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 500;

function getX(lon) {
  return ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_WIDTH;
}

function getY(lat) {
  return (1 - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN))) * MAP_HEIGHT;
}

function deprojectCoords(x, y) {
  let lon = LON_MIN + (x / MAP_WIDTH) * (LON_MAX - LON_MIN);
  let lat = LAT_MAX + (1 - (y / MAP_HEIGHT)) * (LAT_MAX - LAT_MIN);
  return {
    lat: parseFloat(lat.toFixed(6)),
    lon: parseFloat(lon.toFixed(6))
  };
}

function cleanTicket(t) {
  if (!t) return "";
  let parts = t.split("-");
  if (parts.length === 3) {
    let num = parseInt(parts[2], 10);
    if (!isNaN(num)) {
      return "" + num;
    }
  }
  return t;
}

function cleanText(text) {
  if (text === null || text === undefined) {
    return "";
  }
  let s = "" + text;
  s = s.replace("&", "and");

  let clean = "";
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    let isLetter = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
    let isNumber = c >= "0" && c <= "9";
    if (isLetter || isNumber || c === " ") {
      clean = clean + c;
    }
  }

  clean = clean.trim();
  if (clean.length === 0) {
    return "";
  }
  let first = clean[0].toUpperCase();
  let rest = clean.substring(1).toLowerCase();
  return first + rest;
}

export default function App() {
  const [tab, setTab] = useState("dashboard_map");
  const [reps, setReps] = useState([]);
  const [cats, setCats] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);

  const [rates, setRates] = useState({ remaining: "100", reset: "0" });
  const [sig, setSig] = useState("Computing Security Token");
  const [anon, setAnon] = useState(true);
  const [conn, setConn] = useState("connected");

  const [fils, setFils] = useState({
    search: "",
    category: "",
    status: [],
    priority: "",
    agency: ""
  });

  const [frm, setFrm] = useState({
    title: "",
    description: "",
    category_id: "",
    latitude: "",
    longitude: "",
    files: []
  });

  const [errs, setErrs] = useState({});
  const [subs, setSubs] = useState(false);

  const [trans, setTrans] = useState({
    status: "",
    comment: "",
    administrative_notes: ""
  });
  const [msg, setMsg] = useState(null);
  const [note, setNote] = useState(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drags, setDrags] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [place, setPlace] = useState(null);

  const [over, setOver] = useState(false);

  const fileref = useRef(null);
  const svgref = useRef(null);

  async function loadData() {
    setLoading(true);
    try {
      let res1 = await fetch("/api/categories/");
      let catsData = await res1.json();
      setCats(catsData);

      let res2 = await fetch("/api/reports/");
      let repsData = await res2.json();
      setReps(repsData);

      let sigVal = res2.headers.get("sig");
      let anonVal = res2.headers.get("anon");
      let remVal = res2.headers.get("rem");
      let rstVal = res2.headers.get("rst");

      if (sigVal) setSig(sigVal);
      if (anonVal) setAnon(anonVal === "True");
      if (remVal && rstVal) {
        setRates({ remaining: remVal, reset: rstVal });
      }
      setConn("connected");
    } catch (err) {
      setConn("disconnected");
    } finally {
      setLoading(false);
    }
  }

  useEffect(function () {
    loadData();

    let interval = setInterval(async function () {
      try {
        let res = await fetch("/api/reports/");
        let data = await res.json();
        setReps(data);

        let sigVal = res.headers.get("sig");
        let anonVal = res.headers.get("anon");
        let remVal = res.headers.get("rem");
        let rstVal = res.headers.get("rst");

        if (sigVal) setSig(sigVal);
        if (anonVal) setAnon(anonVal === "True");
        if (remVal && rstVal) {
          setRates({ remaining: remVal, reset: rstVal });
        }
        setConn("connected");
      } catch (e) {
        setConn("disconnected");
      }
    }, 12000);

    return function () {
      clearInterval(interval);
    };
  }, []);

  function triggerNotification(type, message) {
    setNote({ type: type, message: message });
    setTimeout(function () {
      setNote(null);
    }, 6000);
  }

  async function handleUpvote(reportId) {
    try {
      let res = await fetch("/api/reports/" + reportId + "/upvote/", {
        method: "POST"
      });
      let updatedReport = await res.json();

      let newList = [];
      for (let i = 0; i < reps.length; i++) {
        if (reps[i].id === reportId) {
          newList.push(updatedReport);
        } else {
          newList.push(reps[i]);
        }
      }
      setReps(newList);

      if (sel !== null && sel.id === reportId) {
        setSel(updatedReport);
      }

      let sigVal = res.headers.get("sig");
      let remVal = res.headers.get("rem");
      let rstVal = res.headers.get("rst");
      if (sigVal) setSig(sigVal);
      if (remVal && rstVal) setRates({ remaining: remVal, reset: rstVal });
    } catch (err) {
    }
  }

  async function handleStatusTransition(e) {
    e.preventDefault();
    if (sel === null) return;
    if (trans.status === "") {
      setMsg({ type: "error", text: "Please select a state first" });
      return;
    }

    try {
      let res = await fetch("/api/reports/" + sel.id + "/", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(trans)
      });

      let updated = await res.json();

      let newList = [];
      for (let i = 0; i < reps.length; i++) {
        if (reps[i].id === sel.id) {
          newList.push(updated);
        } else {
          newList.push(reps[i]);
        }
      }
      setReps(newList);
      setSel(updated);
      setTrans({ status: "", comment: "", administrative_notes: "" });
      setMsg({ type: "success", text: "We changed the status" });

      let sigVal = res.headers.get("sig");
      let remVal = res.headers.get("rem");
      let rstVal = res.headers.get("rst");
      if (sigVal) setSig(sigVal);
      if (remVal && rstVal) setRates({ remaining: remVal, reset: rstVal });

      setTimeout(function () {
        setMsg(null);
      }, 4000);
    } catch (err) {
      setMsg({ type: "error", text: "We cannot change the status now" });
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    let errors = {};
    let formTitle = frm.title.trim();
    let formDesc = frm.description.trim();

    if (formTitle === "" || formTitle.length < 5) {
      errors.title = "The title is too short";
    }
    if (formDesc === "" || formDesc.length < 15) {
      errors.description = "The description is too short";
    }
    if (frm.category_id === "") {
      errors.category_id = "Please choose a category";
    }

    let lat = parseFloat(frm.latitude);
    let lon = parseFloat(frm.longitude);

    let isLatOk = !isNaN(lat) && lat >= LAT_MIN && lat <= LAT_MAX;
    let isLonOk = !isNaN(lon) && lon >= LON_MIN && lon <= LON_MAX;

    if (isLatOk === false || isLonOk === false) {
      errors.latitude = "This place is too far";
      errors.longitude = "This place is too far";
    }

    if (Object.keys(errors).length > 0) {
      setErrs(errors);
      triggerNotification("error", "Please fix the problems in the form");
      return;
    }

    setErrs({});
    setSubs(true);

    try {
      let payload = new FormData();
      payload.append("title", formTitle);
      payload.append("description", formDesc);
      payload.append("category", frm.category_id);
      payload.append("latitude", lat.toString());
      payload.append("longitude", lon.toString());

      for (let i = 0; i < frm.files.length; i++) {
        payload.append("files", frm.files[i]);
      }

      let res = await fetch("/api/reports/", {
        method: "POST",
        body: payload
      });

      let response = await res.json();

      if (response.duplicate_matched) {
        triggerNotification("info", response.message);
        setSel(response.data);
      } else {
        triggerNotification("success", "We got your report successfully");
        setSel(response);
      }

      // reload data
      let resData = await fetch("/api/reports/");
      let repsData = await resData.json();
      setReps(repsData);

      setFrm({
        title: "",
        description: "",
        category_id: "",
        latitude: "",
        longitude: "",
        files: []
      });
      setPlace(null);
      setTab("dashboard_map");
    } catch (err) {
      triggerNotification("error", "We could not save your report");
    } finally {
      setSubs(false);
    }
  }

  function triggerBrowserGeolocation() {
    if (navigator.geolocation === undefined) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        let latitude = pos.coords.latitude;
        let longitude = pos.coords.longitude;

        if (latitude >= LAT_MIN && latitude <= LAT_MAX && longitude >= LON_MIN && longitude <= LON_MAX) {
          setFrm({
            title: frm.title,
            description: frm.description,
            category_id: frm.category_id,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6),
            files: frm.files
          });
          setPlace({ lat: latitude, lon: longitude });
        } else {
          let mocklat = (LAT_MIN + (LAT_MAX - LAT_MIN) * 0.45).toFixed(6);
          let mocklon = (LON_MIN + (LON_MAX - LON_MIN) * 0.55).toFixed(6);
          setFrm({
            title: frm.title,
            description: frm.description,
            category_id: frm.category_id,
            latitude: mocklat,
            longitude: mocklon,
            files: frm.files
          });
          setPlace({ lat: parseFloat(mocklat), lon: parseFloat(mocklon) });
        }
      },
      function (err) {
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  function handleMapMouseDown(e) {
    if (e.button !== 0) return;
    setDrags(true);
    setStart({
      x: e.clientX - offset.x,
      y: e.clientY - offset.y
    });
  }

  function handleMapMouseMove(e) {
    if (drags === false) return;
    setOffset({
      x: e.clientX - start.x,
      y: e.clientY - start.y
    });
  }

  function handleMapMouseUpOrLeave() {
    setDrags(false);
  }

  function handleMapZoom(factor) {
    setScale(function (prev) {
      let nextScale = prev + factor;
      if (nextScale < 0.8) nextScale = 0.8;
      if (nextScale > 4) nextScale = 4;
      return nextScale;
    });
  }

  function handleMapReset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function handleMapClick(e) {
    if (drags === true) return;

    let svg = svgref.current;
    if (svg === null) return;

    let rect = svg.getBoundingClientRect();
    let clickX = e.clientX - rect.left;
    let clickY = e.clientY - rect.top;

    let svgX = (clickX - rect.width / 2 - offset.x) / scale + MAP_HEIGHT / 2;
    let svgY = (clickY - rect.height / 2 - offset.y) / scale + MAP_WIDTH / 2;

    if (svgX >= 0 && svgX <= MAP_WIDTH && svgY >= 0 && svgY <= MAP_HEIGHT) {
      let coord = deprojectCoords(svgX, svgY);
      setFrm({
        title: frm.title,
        description: frm.description,
        category_id: frm.category_id,
        latitude: coord.lat.toString(),
        longitude: coord.lon.toString(),
        files: frm.files
      });
    }
  }

  function handleFileDrop(e) {
    e.preventDefault();
    setOver(false);

    let droppedFiles = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      droppedFiles.push(e.dataTransfer.files[i]);
    }
    processUploadedFiles(droppedFiles);
  }

  function handleFileSelect(e) {
    let selectedFiles = [];
    for (let i = 0; i < e.target.files.length; i++) {
      selectedFiles.push(e.target.files[i]);
    }
    processUploadedFiles(selectedFiles);
  }

  function processUploadedFiles(fileList) {
    let validFiles = [];
    let errorsList = [];

    for (let i = 0; i < fileList.length; i++) {
      let file = fileList[i];
      let hasImage = file.type && file.type.substring(0, 6) === "image/";
      if (hasImage === false) {
        errorsList.push("We only choose pictures");
      } else {
        if (file.size > 5 * 1024 * 1024) {
          errorsList.push("This picture is too big");
        } else {
          validFiles.push(file);
        }
      }
    }

    if (errorsList.length > 0) {
      let errorStr = "";
      for (let i = 0; i < errorsList.length; i++) {
        errorStr = errorStr + errorsList[i] + " ";
      }
      triggerNotification("error", errorStr);
    }

    if (validFiles.length > 0) {
      setFrm(function (prev) {
        let newList = [];
        for (let i = 0; i < prev.files.length; i++) {
          newList.push(prev.files[i]);
        }
        for (let i = 0; i < validFiles.length; i++) {
          newList.push(validFiles[i]);
        }
        return {
          title: prev.title,
          description: prev.description,
          category_id: prev.category_id,
          latitude: prev.latitude,
          longitude: prev.longitude,
          files: newList
        };
      });
      triggerNotification("success", "Added " + validFiles.length + " pictures");
    }
  }

  function removeSelectedFile(idx) {
    setFrm(function (prev) {
      let newList = [];
      for (let i = 0; i < prev.files.length; i++) {
        if (i !== idx) newList.push(prev.files[i]);
      }
      return {
        title: prev.title,
        description: prev.description,
        category_id: prev.category_id,
        latitude: prev.latitude,
        longitude: prev.longitude,
        files: newList
      };
    });
  }

  function handleFilterChange(key, val) {
    setFils(function (prev) {
      let copy = {
        search: prev.search,
        category: prev.category,
        status: prev.status,
        priority: prev.priority,
        agency: prev.agency
      };
      if (key === "status") {
        let list = [];
        let found = false;
        for (let i = 0; i < prev.status.length; i++) {
          if (prev.status[i] === val) {
            found = true;
          } else {
            list.push(prev.status[i]);
          }
        }
        if (found === false) {
          list.push(val);
        }
        copy.status = list;
      } else {
        copy[key] = val;
      }
      return copy;
    });
  }

  function resetFilters() {
    setFils({
      search: "",
      category: "",
      status: [],
      priority: "",
      agency: ""
    });
  }

  let filteredReports = [];
  for (let i = 0; i < reps.length; i++) {
    let r = reps[i];
    let isOk = true;

    if (fils.search !== "") {
      let q = fils.search.toLowerCase().trim();
      let matchText = (r.title + " " + r.description + " " + r.ticket_number).toLowerCase();
      if (matchText.indexOf(q) === -1) {
        isOk = false;
      }
    }

    if (fils.category !== "") {
      if (r.category_detail) {
        if (r.category_detail.system_slug !== fils.category) {
          isOk = false;
        }
      } else {
        isOk = false;
      }
    }

    if (fils.status.length > 0) {
      let statusFound = false;
      for (let j = 0; j < fils.status.length; j++) {
        if (fils.status[j] === r.status) {
          statusFound = true;
        }
      }
      if (statusFound === false) {
        isOk = false;
      }
    }

    if (fils.priority !== "") {
      if (r.category_detail) {
        if (r.category_detail.priority !== fils.priority) {
          isOk = false;
        }
      } else {
        isOk = false;
      }
    }

    if (fils.agency !== "") {
      if (r.category_detail) {
        if (r.category_detail.assignment_group !== fils.agency) {
          isOk = false;
        }
      } else {
        isOk = false;
      }
    }

    if (isOk === true) {
      filteredReports.push(r);
    }
  }

  function getPriorityColor(priority, override) {
    if (override === true || priority === "High") {
      return "var(--priority-high)";
    }
    if (priority === "Medium") {
      return "var(--priority-medium)";
    }
    return "var(--priority-low)";
  }

  return (
    <div className="app-cont">
      {note && (
        <div className={"tst-ban toast-" + note.type}>
          <div className="tst-icon">
            {note.type === "success" && "✓"}
            {note.type === "error" && "⚠"}
            {note.type === "info" && "ℹ"}
          </div>
          <div className="tst-msg">{cleanText(note.message)}</div>
          <button className="tst-cls" onClick={function () { setNote(null); }}>×</button>
        </div>
      )}

      <aside className="diag-side">
        <div className="side-brnd">
          <div className="brnd-logo">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brnd-txt">
            <h2>Metropolis</h2>
            <span>Civic grid</span>
          </div>
        </div>

        <nav className="side-nav">
          <button
            className={"nav-itm " + (tab === "dashboard_map" ? "active" : "")}
            onClick={function () { setTab("dashboard_map"); setSel(null); }}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Map</span>
          </button>
          <button
            className={"nav-itm " + (tab === "ticket_explorer" ? "active" : "")}
            onClick={function () { setTab("ticket_explorer"); }}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Tickets</span>
            <span className="bdg-cnt">{filteredReports.length}</span>
          </button>
          <button
            className={"nav-itm " + (tab === "submit_ticket" ? "active" : "")}
            onClick={function () { setTab("submit_ticket"); }}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Submit</span>
          </button>
          <button
            className={"nav-itm " + (tab === "analytics_insights" ? "active" : "")}
            onClick={function () { setTab("analytics_insights"); }}
          >
            <span className="nav-icon"></span>
            <span className="nav-label">Analytics</span>
          </button>
        </nav>
      </aside>

      <main className="main-view">
        {tab === "dashboard_map" && (
          <div className="view-lay map-view-tab">
            <div className="pnl-hdr">
              <div>
                <h1>City grid</h1>
                <p>Click map to choose issue</p>
              </div>
              <div className="map-tbar">
                <button className="ctrl-btn" onClick={function () { handleMapZoom(0.25); }} title="Zoom in">+</button>
                <button className="ctrl-btn" onClick={function () { handleMapZoom(-0.25); }} title="Zoom out">-</button>
                <button className="ctrl-btn" onClick={handleMapReset} title="Reset">↺</button>
                <span className="zoom-ind">{Math.round(scale * 100)}%</span>
              </div>
            </div>

            <div className="map-canv">
              <svg
                ref={svgref}
                className={"map-svg " + (drags ? "dragging" : "")}
                viewBox={"0 0 " + MAP_WIDTH + " " + MAP_HEIGHT}
                onMouseDown={handleMapMouseDown}
                onMouseMove={handleMapMouseMove}
                onMouseUp={handleMapMouseUpOrLeave}
                onMouseLeave={handleMapMouseUpOrLeave}
                onClick={handleMapClick}
              >
                <g transform={"translate(" + (MAP_WIDTH / 2 + offset.x) + ", " + (MAP_HEIGHT / 2 + offset.y) + ") scale(" + scale + ") translate(" + (-MAP_WIDTH / 2) + ", " + (-MAP_HEIGHT / 2) + ")"}>
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
                  <text x="250" y="325" fill="rgba(6, 182, 212, 0.3)" fontSize="12" fontWeight="bold" transform="rotate(-15, 250, 325)">River</text>

                  <rect x="350" y="60" width="160" height="110" rx="10" fill="rgba(34, 197, 94, 0.08)" stroke="rgba(34, 197, 94, 0.15)" strokeWidth="2" />
                  <text x="430" y="115" fill="rgba(34, 197, 94, 0.3)" fontSize="10" textAnchor="middle" fontWeight="bold">Park</text>

                  <line x1="100" y1="0" x2="100" y2="500" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />
                  <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(148, 163, 184, 0.06)" strokeWidth="8" />

                  {filteredReports.map(function (report) {
                    let cx = getX(report.longitude);
                    let cy = getY(report.latitude);
                    let priorityVal = report.category_detail ? report.category_detail.priority : "";
                    let color = getPriorityColor(priorityVal, report.automated_priority_override);
                    let isSelected = sel !== null && sel.id === report.id;

                    let showHigh = priorityVal === "High" || report.automated_priority_override;
                    let showMedium = priorityVal === "Medium";
                    let size = isSelected ? "7" : "5.5";

                    return (
                      <g
                        key={report.id}
                        className={"map-mrkr " + (isSelected ? "selected" : "")}
                        onClick={function (e) {
                          e.stopPropagation();
                          setSel(report);
                        }}
                      >
                        {showHigh ? <circle cx={cx} cy={cy} r="16" fill="none" stroke={color} strokeWidth="1.5" className="mrkr-out" /> : null}
                        {showHigh ? <circle cx={cx} cy={cy} r="10" fill="none" stroke={color} strokeWidth="2" className="mrkr-inn" /> : null}
                        {showMedium ? <circle cx={cx} cy={cy} r="11" fill="none" stroke={color} strokeWidth="1.5" className="mrkr-inn" /> : null}

                        <circle
                          cx={cx}
                          cy={cy}
                          r={size}
                          fill={color}
                          stroke="#0f172a"
                          strokeWidth="2"
                          className="mrkr-core"
                        />
                        <text x={cx} y={cy - 12} fill="#94a3b8" fontSize="8" textAnchor="middle" className="mrkr-tag">
                          {cleanTicket(report.ticket_number)}
                        </text>
                      </g>
                    );
                  })}

                  {place && (
                    <g>
                      <path
                        d={"M " + getX(place.lon) + " " + (getY(place.lat) - 2) + " L " + (getX(place.lon) - 6) + " " + (getY(place.lat) - 16) + " A 6 6 0 1 1 " + (getX(place.lon) + 6) + " " + (getY(place.lat) - 16) + " z"}
                        fill="var(--accent-cyan)"
                        stroke="#0f172a"
                        strokeWidth="1.5"
                        className="pin-glow"
                      />
                      <circle cx={getX(place.lon)} cy={getY(place.lat) - 16} r="2.5" fill="#0f172a" />
                    </g>
                  )}
                </g>
              </svg>

              {sel && (
                <div className="map-draw">
                  <div className="draw-hdr">
                    <div>
                      <span className="draw-tag">{cleanTicket(sel.ticket_number)}</span>
                      <h2 className="draw-ttl">{cleanText(sel.title)}</h2>
                    </div>
                    <button className="draw-close" onClick={function () { setSel(null); }}>×</button>
                  </div>

                  <div className="draw-body">
                    <div className="draw-stat">
                      <div
                        className="stat-bdg"
                        style={{
                          backgroundColor: getPriorityColor(sel.category_detail.priority, sel.automated_priority_override) + "20",
                          color: getPriorityColor(sel.category_detail.priority, sel.automated_priority_override)
                        }}
                      >
                        {cleanText(sel.category_detail.priority)}
                      </div>
                      {sel.automated_priority_override && (
                        <span className="ai-pill">Ai scan</span>
                      )}
                      <span className="stat-str">State {cleanText(sel.status_display)}</span>
                    </div>

                    <div className="draw-grid">
                      <div className="meta-box">
                        <span>Group</span>
                        <strong>{cleanText(sel.category_detail.name)}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Team</span>
                        <strong>{cleanText(sel.category_detail.assignment_group)}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Location</span>
                        <strong>{sel.latitude} And {sel.longitude}</strong>
                      </div>
                      <div className="meta-box">
                        <span>Upvote count</span>
                        <div className="draw-upvt">
                          <strong>{sel.upvote_count}</strong>
                          <button
                            className="upvt-trig"
                            onClick={function () { handleUpvote(sel.id); }}
                            disabled={sel.status === "Resolved" || sel.status === "Rejected"}
                          >
                            ▲ Upvote
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="draw-desc">
                      <h4>Citizen details</h4>
                      <p>{cleanText(sel.description)}</p>
                    </div>

                    {sel.media_attachments && sel.media_attachments.length > 0 && (
                      <div className="draw-med">
                        <h4>Photos {sel.media_attachments.length}</h4>
                        <div className="car-trck">
                          {sel.media_attachments.map(function (img) {
                            return (
                              <div key={img.id} className="car-crd">
                                <img src={img.absolute_url || img.file_path} alt="Evidence" />
                                <span className="sld-meta">{(img.file_size / 1024).toFixed(1)} KB</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="draw-line">
                      <h4>Report logs</h4>
                      <div className="line-tree">
                        {sel.history_logs && sel.history_logs.map(function (log, idx) {
                          let prevText = cleanText(log.previous_status_display);
                          let newText = cleanText(log.new_status_display);
                          return (
                            <div key={log.id || idx} className="line-node">
                              <div className="line-dot"></div>
                              <div className="line-cont">
                                <div className="line-hdr">
                                  {prevText === newText ? (
                                    <span className="node-tran">{newText}</span>
                                  ) : (
                                    <span className="node-tran">{prevText} to {newText}</span>
                                  )}
                                  <span className="node-date">{cleanText(new Date(log.created_at).toLocaleString())}</span>
                                </div>
                                <p className="node-cmt">{cleanText(log.comment)}</p>
                                {log.administrative_notes && (
                                  <div className="node-note">
                                    <span>Report details</span> {cleanText(log.administrative_notes)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="draw-adm">
                      <h4>Admin zone</h4>
                      <form onSubmit={handleStatusTransition} className="adm-form">
                        <div className="frm-row">
                          <div className="frm-elm">
                            <label>Change status</label>
                            <select
                              value={trans.status}
                              onChange={function (e) {
                                setTrans({
                                  status: e.target.value,
                                  comment: trans.comment,
                                  administrative_notes: trans.administrative_notes
                                });
                              }}
                            >
                              <option value="">Shift status</option>
                              <option value="Open">Open</option>
                              <option value="Investigating">Investigate</option>
                              <option value="Scheduled">Schedule work</option>
                              <option value="In Progress">Start work</option>
                              <option value="Resolved">Mark resolved</option>
                              <option value="Rejected">Reject ticket</option>
                            </select>
                          </div>
                        </div>

                        <div className="frm-elm">
                          <label>Comment for public</label>
                          <textarea
                            rows="2"
                            placeholder="Write comment here"
                            value={trans.comment}
                            onChange={function (e) {
                              setTrans({
                                status: trans.status,
                                comment: e.target.value,
                                administrative_notes: trans.administrative_notes
                              });
                            }}
                          />
                        </div>
                        <div className="frm-elm">
                          <label>Notes for system</label>
                          <input
                            type="text"
                            placeholder="Write notes here"
                            value={trans.administrative_notes}
                            onChange={function (e) {
                              setTrans({
                                status: trans.status,
                                comment: trans.comment,
                                administrative_notes: e.target.value
                              });
                            }}
                          />
                        </div>
                        <button type="submit" className="adm-btn">Commit change</button>

                        {msg && (
                          <div className="adm-alrt">
                            {cleanText(msg.text)}
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

        {tab === "ticket_explorer" && (
          <div className="view-lay explorer-view-tab">
            <div className="pnl-hdr">
              <div>
                <h1>Ticket list</h1>
                <p>See all tickets here</p>
              </div>
            </div>

            <div className="exp-grid">
              <aside className="exp-filt">
                <div className="filt-hdr">
                  <h3>Search and filter</h3>
                  <button className="rst-btn" onClick={resetFilters}>Clear all</button>
                </div>

                <div className="filt-sec">
                  <label className="filt-lbl">Search text</label>
                  <input
                    type="text"
                    placeholder="Write search text here"
                    className="filt-srch"
                    value={fils.search}
                    onChange={function (e) { handleFilterChange("search", e.target.value); }}
                  />
                </div>

                <div className="filt-sec">
                  <label className="filt-lbl">Choose category</label>
                  <select
                    className="filt-sel"
                    value={fils.category}
                    onChange={function (e) { handleFilterChange("category", e.target.value); }}
                  >
                    <option value="">All categories</option>
                    {cats.map(function (c) {
                      return (
                        <option key={c.id} value={c.system_slug}>{cleanText(c.name)}</option>
                      );
                    })}
                  </select>
                </div>

                <div className="filt-sec">
                  <label className="filt-lbl">Choose team</label>
                  <select
                    className="filt-sel"
                    value={fils.agency}
                    onChange={function (e) { handleFilterChange("agency", e.target.value); }}
                  >
                    <option value="">All teams</option>
                    <option value="Public Works">Public works</option>
                    <option value="Animal Control">Animal control</option>
                    <option value="Traffic Safety">Traffic safety</option>
                    <option value="Sanitation">Sanitation</option>
                  </select>
                </div>

                <div className="filt-sec">
                  <label className="filt-lbl">Choose urgency</label>
                  <select
                    className="filt-sel"
                    value={fils.priority}
                    onChange={function (e) { handleFilterChange("priority", e.target.value); }}
                  >
                    <option value="">All urgency levels</option>
                    <option value="High">High urgency</option>
                    <option value="Medium">Medium urgency</option>
                    <option value="Low">Low urgency</option>
                  </select>
                </div>

                <div className="filt-sec">
                  <label className="filt-lbl">Choose status</label>
                  <div className="filt-grp">
                    {["Open", "Investigating", "Scheduled", "In Progress", "Resolved", "Rejected"].map(function (stat) {
                      let isChecked = fils.status.indexOf(stat) !== -1;
                      return (
                        <label key={stat} className="chk-itm">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={function () { handleFilterChange("status", stat); }}
                          />
                          <span>{cleanText(stat)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <section className="exp-dash">
                <div className="met-bar">
                  <span>Showing <strong>{filteredReports.length}</strong> matching tickets from total <strong>{reps.length}</strong></span>
                </div>

                {filteredReports.length === 0 ? (
                  <div className="empty-st">
                    <span className="emp-icon"></span>
                    <h3>No reports found</h3>
                    <p>Change search filter or clear all</p>
                  </div>
                ) : (
                  <div className="exp-cards">
                    {filteredReports.map(function (report) {
                      let priorityVal = report.category_detail ? report.category_detail.priority : "";
                      let color = getPriorityColor(priorityVal, report.automated_priority_override);

                      return (
                        <div
                          key={report.id}
                          className="exp-card"
                          onClick={function () {
                            setSel(report);
                            setTab("dashboard_map");
                          }}
                        >
                          <div className="crd-hdr">
                            <span className="crd-tag">{cleanTicket(report.ticket_number)}</span>
                            <div
                              className="crd-bdg"
                              style={{
                                backgroundColor: color + "15",
                                color: color,
                                borderColor: color + "30"
                              }}
                            >
                              {cleanText(priorityVal)}
                            </div>
                          </div>

                          <h3 className="crd-ttl">{cleanText(report.title)}</h3>
                          <p className="crd-clip">{cleanText(report.description)}</p>

                          <div className="crd-attr">
                            <div className="attr-itm">
                              <span className="attr-lbl">Team</span>
                              <span className="attr-val">{cleanText(report.category_detail.assignment_group)}</span>
                            </div>
                            <div className="attr-itm">
                              <span className="attr-lbl">Status</span>
                              <span className="attr-val txt-grn">{cleanText(report.status_display)}</span>
                            </div>
                          </div>

                          <div className="crd-ftr">
                            <span className="crd-time">{cleanText(new Date(report.created_at).toLocaleDateString())}</span>

                            <div className="crd-actions">
                              {report.media_attachments && report.media_attachments.length > 0 && (
                                <span className="med-ind" title={report.media_attachments.length + " Evidence images"}>
                                  📷 {report.media_attachments.length}
                                </span>
                              )}

                              <button
                                className="crd-upvt"
                                onClick={function (e) {
                                  e.stopPropagation();
                                  handleUpvote(report.id);
                                }}
                                disabled={report.status === "Resolved" || report.status === "Rejected"}
                              >
                                ▲ {report.upvote_count}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {tab === "submit_ticket" && (
          <div className="view-lay form-view-tab">
            <div className="pnl-hdr">
              <div>
                <h1>New report</h1>
                <p>Write report here</p>
              </div>
            </div>

            <div className="frm-box">
              <form onSubmit={handleFormSubmit} className="inc-form">
                <div className="frm-grid">
                  <div className="frm-elm span-2">
                    <label className="elm-lbl">Title</label>
                    <input
                      type="text"
                      placeholder="Write incident title here"
                      value={frm.title}
                      onChange={function (e) {
                        setFrm({
                          title: e.target.value,
                          description: frm.description,
                          category_id: frm.category_id,
                          latitude: frm.latitude,
                          longitude: frm.longitude,
                          files: frm.files
                        });
                      }}
                      className={errs.title ? "input-error" : ""}
                    />
                    {errs.title && <span className="err-tag">{cleanText(errs.title)}</span>}
                    <span className="in-hint">Write five to one hundred characters</span>
                  </div>

                  <div className="frm-elm span-2">
                    <label className="elm-lbl">Choose category</label>
                    <select
                      value={frm.category_id}
                      onChange={function (e) {
                        setFrm({
                          title: frm.title,
                          description: frm.description,
                          category_id: e.target.value,
                          latitude: frm.latitude,
                          longitude: frm.longitude,
                          files: frm.files
                        });
                      }}
                      className={errs.category_id ? "input-error" : ""}
                    >
                      <option value="">Pick category</option>
                      {cats.map(function (c) {
                        return (
                          <option key={c.id} value={c.id}>{cleanText(c.name)} Team {cleanText(c.assignment_group)}</option>
                        );
                      })}
                    </select>
                    {errs.category_id && <span className="err-tag">{cleanText(errs.category_id)}</span>}
                    <span className="in-hint">Pick category from list</span>
                  </div>

                  <div className="frm-elm">
                    <label className="elm-lbl">Latitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="Write latitude"
                      value={frm.latitude}
                      onChange={function (e) {
                        setFrm({
                          title: frm.title,
                          description: frm.description,
                          category_id: frm.category_id,
                          latitude: e.target.value,
                          longitude: frm.longitude,
                          files: frm.files
                        });
                      }}
                      className={errs.latitude ? "input-error" : ""}
                    />
                    {errs.latitude && <span className="err-tag">{cleanText(errs.latitude)}</span>}
                    <span className="in-hint">Write latitude from 40.700000 to 40.850000</span>
                  </div>

                  <div className="frm-elm">
                    <label className="elm-lbl">Longitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="Write longitude"
                      value={frm.longitude}
                      onChange={function (e) {
                        setFrm({
                          title: frm.title,
                          description: frm.description,
                          category_id: frm.category_id,
                          latitude: frm.latitude,
                          longitude: e.target.value,
                          files: frm.files
                        });
                      }}
                      className={errs.longitude ? "input-error" : ""}
                    />
                    {errs.longitude && <span className="err-tag">{cleanText(errs.longitude)}</span>}
                    <span className="in-hint">Write longitude from -74.050000 to -73.850000</span>
                  </div>

                  <div className="coord-rib span-2">
                    <button
                      type="button"
                      className="coord-btn"
                      onClick={triggerBrowserGeolocation}
                    >
                      Get gps location
                    </button>
                    <button
                      type="button"
                      className="coord-btn"
                      onClick={function () {
                        setTab("dashboard_map");
                        triggerNotification("info", "Click on the map grid to capture coordinates");
                      }}
                    >
                      Get location from map
                    </button>
                  </div>

                  <div className="frm-elm span-2">
                    <label className="elm-lbl">Description</label>
                    <textarea
                      rows="5"
                      placeholder="Write details of incident here"
                      value={frm.description}
                      onChange={function (e) {
                        setFrm({
                          title: frm.title,
                          description: e.target.value,
                          category_id: frm.category_id,
                          latitude: frm.latitude,
                          longitude: frm.longitude,
                          files: frm.files
                        });
                      }}
                      className={errs.description ? "input-error" : ""}
                    />
                    <div className="txt-bar">
                      {errs.description && <span className="err-tag">{cleanText(errs.description)}</span>}
                      <span className="char-cnt">
                        Remaining {Math.max(0, 1000 - frm.description.length)} from one thousand minimum fifteen
                      </span>
                    </div>
                  </div>

                  <div className="frm-elm span-2">
                    <label className="elm-lbl">Photos</label>

                    <div
                      className={"drag-zone " + (over ? "drag-over" : "")}
                      onDragOver={function () { setOver(false); }}
                      onDrop={handleFileDrop}
                      onClick={function () { fileref.current.click(); }}
                    >
                      <input
                        type="file"
                        ref={fileref}
                        multiple
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleFileSelect}
                      />
                      <span className="upload-icon"></span>
                      <h4>Drag photos here</h4>
                      <p>Click to choose photos</p>
                    </div>

                    {frm.files.length > 0 && (
                      <div className="up-car">
                        {frm.files.map(function (file, idx) {
                          let src = URL.createObjectURL(file);
                          return (
                            <div key={idx} className="ev-card">
                              <img src={src} alt="Upload preview" />
                              <div className="prev-meta">
                                <span className="prv-name">{cleanText(file.name)}</span>
                                <span className="prv-size">{(file.size / 1024).toFixed(1)} KB</span>
                              </div>
                              <button
                                type="button"
                                className="rm-btn"
                                onClick={function (e) {
                                  e.stopPropagation();
                                  removeSelectedFile(idx);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="frm-sub">
                  <button
                    type="submit"
                    className="frm-sub-trigger"
                    disabled={subs}
                  >
                    {subs ? "Submitting report now" : "Submit report"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {tab === "analytics_insights" && (
          <div className="view-lay analytics-view-tab">
            <div className="pnl-hdr">
              <div>
                <h1>Grid numbers</h1>
                <p>Graphs of issues</p>
              </div>
            </div>

            <div className="an-grid">
              <div className="cnt-card">
                <h3>Total reports</h3>
                <span className="met-num">{reps.length}</span>
                <span className="met-sub">Reports in system</span>
              </div>

              <div className="cnt-card">
                <h3>Active issues</h3>
                <span className="met-num txt-ylw">
                  {reps.filter(function (r) {
                    let activeList = ["Open", "Investigating", "Scheduled", "In Progress"];
                    let found = false;
                    for (let i = 0; i < activeList.length; i++) {
                      if (activeList[i] === r.status) {
                        found = true;
                      }
                    }
                    return found;
                  }).length}
                </span>
                <span className="met-sub">Reports not solved yet</span>
              </div>

              <div className="cnt-card">
                <h3>Solved rate</h3>
                <span className="met-num txt-grn">
                  {reps.length > 0
                    ? Math.round((reps.filter(function (r) { return r.status === "Resolved"; }).length / reps.length) * 100) + "%"
                    : "0%"
                  }
                </span>
                <span className="met-sub">Percent of solved issues</span>
              </div>

              <div className="cnt-card">
                <h3>Ai scan count</h3>
                <span className="met-num txt-cyn">
                  {reps.filter(function (r) { return r.automated_priority_override === true; }).length}
                </span>
                <span className="met-sub">Reports scanned by Ai</span>
              </div>

              <div className="an-plot span-2">
                <h3>Issues by group</h3>
                <div className="plt-list">
                  {cats.map(function (cat) {
                    let count = reps.filter(function (r) {
                      if (r.category_detail) {
                        return r.category_detail.id === cat.id;
                      }
                      return false;
                    }).length;
                    return (
                      <div key={cat.id} className="plt-row">
                        <span className="plt-lbl">{cleanText(cat.name)}</span>
                        <span className="plt-val">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="an-plot">
                <h3>Issues by urgency</h3>
                <div className="plt-list">
                  {["High", "Medium", "Low"].map(function (urg) {
                    let count = reps.filter(function (r) {
                      let ok = false;
                      if (r.category_detail) {
                        if (r.category_detail.priority === urg) {
                          ok = true;
                        }
                      }
                      if (urg === "High" && r.automated_priority_override === true) {
                        ok = true;
                      }
                      if (urg !== "High" && r.automated_priority_override === true) {
                        ok = false;
                      }
                      return ok;
                    }).length;
                    return (
                      <div key={urg} className="plt-row">
                        <span className="plt-lbl">{cleanText(urg)} urgency</span>
                        <span className="plt-val">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}