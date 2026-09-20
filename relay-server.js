// relay-server.js
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Gemini Live + Music Relay is running.\n');
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* =====================================================================
 * PATH 1 —  /  →  Gemini Live API (text + voice chat)
 * ===================================================================== */
const liveWss = new WebSocketServer({ server, path: '/' });

liveWss.on('connection', async (clientWs) => {
  console.log('[live] browser connected');

  let session;
  try {
    session = await ai.live.connect({
      model: 'gemini-live-2.5-flash-preview',
      config: {
        responseModalities: ['TEXT'],
      },
      callbacks: {
        onmessage: (msg) => { try { clientWs.send(JSON.stringify(msg)); } catch (_) {} },
        onerror:   (e)   => { console.error('[live] gemini err', e); try { clientWs.send(JSON.stringify({ type: 'error', message: String(e?.message || e) })); } catch (_) {} },
        onclose:   ()    => { try { clientWs.close(); } catch (_) {} },
      },
    });
    console.log('[live] gemini session opened');
  } catch (err) {
    console.error('[live] connect failed:', err);
    try { clientWs.send(JSON.stringify({ type: 'error', message: 'Gemini connect failed: ' + (err?.message || err) })); } catch (_) {}
    clientWs.close();
    return;
  }

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.text) {
        await session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: msg.text }] }],
          turnComplete: true,
        });
      }
    } catch (e) { console.error('[live] forward err', e); }
  });

  clientWs.on('close', () => { try { session.close(); } catch (_) {} });
});

/* =====================================================================
 * PATH 2 —  /music  →  Lyria RealTime (Live Music API)
 * ===================================================================== */
const musicWss = new WebSocketServer({ server, path: '/music' });

musicWss.on('connection', async (clientWs) => {
  console.log('[music] client connected');
  let session;

  const sendToClient = (obj) => {
    try { clientWs.send(JSON.stringify(obj)); } catch (_) {}
  };

  try {
    session = await ai.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message) => {
          // Gemini sends { serverContent: { audioChunks: [...] } }
          if (message?.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              if (chunk?.data) {
                sendToClient({ type: 'audio', audio: chunk.data });
              }
            }
          } else {
            // Pass through any other server messages (status, errors, etc.)
            sendToClient({ type: 'server', payload: message });
          }
        },
        onerror: (e) => {
          console.error('[music] error:', e);
          sendToClient({ type: 'error', message: String(e?.message || e) });
        },
        onclose: () => {
          sendToClient({ type: 'closed' });
          clientWs.close();
        },
      },
    });
  } catch (err) {
    console.error('[music] connect failed:', err);
    sendToClient({ type: 'error', message: 'Failed to connect: ' + err.message });
    clientWs.close();
    return;
  }

  sendToClient({ type: 'ready' });

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Set weighted text prompts
      if (msg.action === 'prompts' && Array.isArray(msg.prompts)) {
        await session.setWeightedPrompts({
          weightedPrompts: msg.prompts.map((p) => ({
            text: p.text,
            weight: typeof p.weight === 'number' ? p.weight : 1.0,
          })),
        });
        sendToClient({ type: 'ack', action: 'prompts' });
      }

      // Set generation config (bpm, density, brightness, etc.)
      else if (msg.action === 'config') {
        await session.setMusicGenerationConfig({
          musicGenerationConfig: msg.config || {},
        });
        sendToClient({ type: 'ack', action: 'config' });
      }

      // Start playback
      else if (msg.action === 'play') {
        await session.play();
        sendToClient({ type: 'ack', action: 'play' });
      }

      // Pause playback
      else if (msg.action === 'pause') {
        await session.pause();
        sendToClient({ type: 'ack', action: 'pause' });
      }

      // Stop playback
      else if (msg.action === 'stop') {
        await session.stop();
        sendToClient({ type: 'ack', action: 'stop' });
      }

      // Reset context
      else if (msg.action === 'reset') {
        await session.resetContext();
        sendToClient({ type: 'ack', action: 'reset' });
      }
    } catch (e) {
      console.error('[music] forward error:', e);
      sendToClient({ type: 'error', message: e.message });
    }
  });

  clientWs.on('close', () => {
    console.log('[music] client disconnected');
    try { session.close(); } catch (_) {}
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Relay listening on :${PORT}  (live: /  music: /music)`);
});
