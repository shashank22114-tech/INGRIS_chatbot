import express from "express";
import cors from "cors";
import path from "path";
import axios from "axios";
import multer from "multer";
import fs from "fs";
import FormData from "form-data";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(".")); // serve frontend (index.html, script.js, style.css)

// Multer for PDF uploads
const upload = multer({ dest: "uploads/" });

// ---------- Helpers ----------
function isGreeting(text) {
  const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"];
  const s = text.toLowerCase();
  return greetings.some(
    gw => s === gw || s.startsWith(gw + " ") || s.includes(" " + gw + " ")
  );
}

function greetingReply() {
  return "👋 Hello — I’m the INGRES assistant. Ask me about groundwater status, water quality, or upload a report (PDF).";
}

// ---------- Routes ----------

// 📄 PDF upload → forwards to FastAPI /ingest_pdf
app.post("/api/upload-pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), req.file.originalname);

    const fastapiResp = await axios.post("http://localhost:8000/ingest_pdf", form, {
      headers: { ...form.getHeaders() },
      timeout: 120000,
    });

    fs.unlinkSync(filePath); // cleanup temp file
    return res.json(fastapiResp.data);

  } catch (err) {
    console.error("❌ Error uploading PDF:", err.message || err);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res.status(500).json({ error: "PDF processing failed" });
  }
});

// 💬 Chat endpoint → forwards to FastAPI /chat
app.post("/api/chat", async (req, res) => {
  const message = (req.body.message || "").trim();
  if (!message) return res.json({ reply: "Please type a question." });

  // 1. Greetings handled here
  if (isGreeting(message)) {
    return res.json({ reply: greetingReply() });
  }

  // 2. Forward everything else to FastAPI /chat
  try {
    const fastapiResp = await axios.post("http://localhost:8000/chat", {
      question: message
    }, { timeout: 60000 });

    return res.json({ reply: fastapiResp.data.reply });

  } catch (err) {
    console.error("❌ Error calling RAG model API:", err.message || err);
    return res.json({
      reply: "⚠️ Sorry, I could not process that. Please check if FastAPI is running."
    });
  }
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`✅ Node.js server running at http://localhost:${PORT}`);
});
