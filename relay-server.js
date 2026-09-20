import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

process.on('unhandledRejection', (reason) => console.error('❌ UNHANDLED REJECTION:', reason));
process.on('uncaughtException',  (err)    => console.error('❌ UNCAUGHT EXCEPTION:', err));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Relay alive\n');
});

console.log('API key present:', !!process.env.GEMINI_API_KEY);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const wss = new WebSocketServer({ server, path: '/' });

wss.on('connection', async (clientWs) => {
  console.log('--- browser connected ---');
  let session;

  try {
    console.log('calling ai.live.connect...');
    session = await ai.live.connect({
      model: 'gemini-live-2.5-flash-preview',
      config: { responseModalities: ['TEXT'] },
      callbacks: {
        onopen:    () => console.log('   [gemini] onopen'),
        onmessage: (msg) => {
          console.log('   [gemini] onmessage:', JSON.stringify(msg).slice(0, 120));
          try { clientWs.send(JSON.stringify(msg)); } catch (e) { console.error('   forward err', e); }
        },
        onerror:   (e) => console.error('   [gemini] onerror:', e),
        onclose:   (e) => console.log('   [gemini] onclose:', e),
      },
    });
    console.log('✅ ai.live.connect returned');
  } catch (err) {
    console.error('❌ ai.live.connect threw:', err);
    try { clientWs.send(JSON.stringify({ type: 'error', message: String(err?.message || err) })); } catch (_) {}
    clientWs.close();
    return;
  }

  clientWs.on('message', async (raw) => {
    console.log('--- browser sent:', raw.toString().slice(0, 120));
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.text) {
        console.log('sending to gemini...');
        await session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: msg.text }] }],
          turnComplete: true,
        });
        console.log('✅ sent to gemini');
      }
    } catch (e) {
      console.error('❌ send error:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('--- browser disconnected ---');
    try { session.close(); } catch (_) {}
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('🚀 Relay listening on :' + PORT));
