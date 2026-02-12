// script.js
// Full client logic: Home <> Map <> Chat + sessions + PDF upload + map demo (Leaflet)

document.addEventListener("DOMContentLoaded", () => {
  // UI elements (may be present/hidden)
  const homeEl = document.getElementById("home");
  const mapPageEl = document.getElementById("map-page");
  const chatAppEl = document.getElementById("chat-app");

  // Buttons that may exist (some pages have different button names)
  const startBtn = document.getElementById("start-btn");
  const mapBtn = document.getElementById("map-btn");
  const chatBtn = document.getElementById("chat-btn");
  const backHome1 = document.getElementById("back-home-1");
  const backHome2 = document.getElementById("back-home-2");

  // Chat elements (exist inside chat-app, even if hidden)
  const chatWindow = document.getElementById("chat-window");
  const sessionList = document.getElementById("chat-sessions");
  const sendBtn = document.getElementById("send-btn");
  const userInput = document.getElementById("user-input");
  const uploadBtn = document.getElementById("upload-btn");
  const pdfInput = document.getElementById("pdf-upload");
  const newChatBtn = document.getElementById("new-chat-btn");

  // Chat session state
  let chatSessions = [];
  let currentSession = [];

  // Map state
  let map = null;
  let geoLayer = null;
  let mapInitialized = false;

  // Navigation helpers
  function showHome() {
    if (homeEl) homeEl.classList.remove("hidden");
    if (mapPageEl) mapPageEl.classList.add("hidden");
    if (chatAppEl) chatAppEl.classList.add("hidden");
  }
  function showMapPage() {
    if (homeEl) homeEl.classList.add("hidden");
    if (mapPageEl) mapPageEl.classList.remove("hidden");
    if (chatAppEl) chatAppEl.classList.add("hidden");
    initMap(); // init or refresh
  }
  function showChatPage() {
    if (homeEl) homeEl.classList.add("hidden");
    if (mapPageEl) mapPageEl.classList.add("hidden");
    if (chatAppEl) chatAppEl.classList.remove("hidden");
    // ensure chat window sizes correctly after being shown
    setTimeout(() => {
      if (map) map.invalidateSize && map.invalidateSize();
      scrollChatToBottom();
    }, 200);
  }

  // Attach navigation listeners
  if (startBtn) startBtn.addEventListener("click", showChatPage);
  if (mapBtn) mapBtn.addEventListener("click", showMapPage);
  if (chatBtn) chatBtn.addEventListener("click", showChatPage);
  if (backHome1) backHome1.addEventListener("click", showHome);
  if (backHome2) backHome2.addEventListener("click", showHome);

  // -------- Chat functions --------
  function addMessage(text, className) {
    if (!chatWindow) return;
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", className);
    // allow simple newlines
    messageDiv.innerHTML = text
      .split("\n")
      .map(line => `<div>${escapeHtml(line)}</div>`)
      .join("");
    chatWindow.appendChild(messageDiv);
    scrollChatToBottom();
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function scrollChatToBottom() {
    if (!chatWindow) return;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function saveSession() {
    if (currentSession.length > 0) {
      chatSessions.unshift([...currentSession]); // newest first
      if (chatSessions.length > 5) chatSessions.pop();
      renderSessions();
    }
  }

  function renderSessions() {
    if (!sessionList) return;
    sessionList.innerHTML = "";
    chatSessions.forEach((session, index) => {
      const li = document.createElement("li");
      li.textContent = `Chat ${index + 1}`;
      li.addEventListener("click", () => loadSession(index));
      sessionList.appendChild(li);
    });
  }

  function loadSession(index) {
    if (!chatWindow) return;
    chatWindow.innerHTML = "";
    currentSession = [...chatSessions[index]];
    currentSession.forEach(msg => addMessage(msg.text, msg.type));
  }

  function startNewChat() {
    saveSession();
    if (chatWindow) chatWindow.innerHTML = "";
    currentSession = [];
  }

  // Send user message to backend
  async function sendMessage() {
    if (!userInput) return;
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, "user-message");
    currentSession.push({ text: message, type: "user-message" });
    userInput.value = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      const reply = (data && data.reply) ? data.reply : "⚠️ No reply from server.";
      addMessage(reply, "bot-message");
      currentSession.push({ text: reply, type: "bot-message" });
    } catch (err) {
      console.error(err);
      const errMsg = "⚠️ Error connecting to server.";
      addMessage(errMsg, "bot-message");
      currentSession.push({ text: errMsg, type: "bot-message" });
    }
  }

  // PDF upload handler
  async function handlePDF() {
    if (!pdfInput || !pdfInput.files.length) return;
    const file = pdfInput.files[0];

    // show local confirmation
    addMessage(`Uploaded PDF: ${file.name}`, "user-message");
    currentSession.push({ text: `Uploaded PDF: ${file.name}`, type: "user-message" });

    const fd = new FormData();
    fd.append("pdf", file);

    try {
      const resp = await fetch("/api/upload-pdf", { method: "POST", body: fd });
      const data = await resp.json();
      if (resp.ok && data) {
        if (data.snippet) {
          addMessage(`PDF processed. Snippet: ${data.snippet}`, "bot-message");
          currentSession.push({ text: `PDF snippet: ${data.snippet}`, type: "bot-message" });
        } else if (data.id) {
          addMessage(`PDF stored (id: ${data.id}). You can now ask about the report.`, "bot-message");
          currentSession.push({ text: `PDF stored (id: ${data.id})`, type: "bot-message" });
        } else {
          addMessage("PDF uploaded but no text returned.", "bot-message");
          currentSession.push({ text: "PDF uploaded but no text returned.", type: "bot-message" });
        }
      } else {
        console.warn("PDF upload server error:", data);
        addMessage("⚠️ PDF upload failed on server.", "bot-message");
        currentSession.push({ text: "⚠️ PDF upload failed on server.", type: "bot-message" });
      }
    } catch (err) {
      console.error("PDF upload failed:", err);
      addMessage("⚠️ PDF upload failed.", "bot-message");
      currentSession.push({ text: "⚠️ PDF upload failed.", type: "bot-message" });
    }

    pdfInput.value = "";
  }

  // -------- Attach chat event listeners --------
  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  if (userInput) userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });
  if (uploadBtn) uploadBtn.addEventListener("click", handlePDF);
  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);

  // -------- Map demo (Leaflet) --------
  async function initMap() {
    if (mapInitialized) {
      if (map) setTimeout(() => map.invalidateSize && map.invalidateSize(), 200);
      return;
    }

    const mapDiv = document.getElementById("map");
    if (!mapDiv) return;

    map = L.map("map", { preferCanvas: true }).setView([18.0, 79.0], 7);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);

    try {
      const res = await fetch("districts.json");   // ✅ Updated here
      if (!res.ok) throw new Error("Could not load districts.json");
      const geoData = await res.json();

      geoLayer = L.geoJSON(geoData, {
        style: (feature) => {
          const status = feature.properties?.status || "";
          let color = "#28a745"; // Safe -> green
          if (status === "Semi-Critical") color = "#ffc107";
          if (status === "Critical") color = "#fd7e14";
          if (status === "Over-Exploited") color = "#dc3545";
          return { color: "#222", weight: 1, fillColor: color, fillOpacity: 0.65 };
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          const title = `<b>${p.district || "Unknown"}</b>`;
          const status = `<div>Status: ${p.status || "N/A"}</div>`;
          const desc = p.desc ? `<div>${p.desc}</div>` : "";
          layer.bindPopup(`${title}${status}${desc}`);
        }
      }).addTo(map);

      try {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch (e) {
        // ignore
      }

      mapInitialized = true;
    } catch (err) {
      console.error("Map init error:", err);
      if (mapDiv) mapDiv.innerHTML = "<p style='color:#fff;padding:12px'>Failed to load map demo.</p>";
    }
  }

  if (document.getElementById("map-page") && !document.getElementById("map-page").classList.contains("hidden")) {
    initMap();
  }
});
