import type { WSEvents, WSContext } from 'hono/ws';

/** A bounded relay to the owner's authenticated room, after the local API's origin checks. */
export function ownerSocketRelay(target: { url: string; headers: Record<string, string> }): WSEvents {
  let upstream: WebSocket | null = null;
  let downstream: WSContext | null = null;
  let queued: Array<string | ArrayBuffer | Uint8Array> = [];
  let bytes = 0;
  const end = (code = 1011) => { queued = []; upstream?.close(); downstream?.close(code); };
  return {
    onOpen(_event, socket) {
      downstream = socket;
      upstream = new WebSocket(target.url.replace(/^http/, 'ws'), { headers: target.headers } as never);
      upstream.binaryType = 'arraybuffer';
      upstream.onopen = () => { for (const packet of queued) upstream!.send(packet); queued = []; bytes = 0; };
      upstream.onmessage = event => { if (socket.readyState === 1) socket.send(event.data as ArrayBuffer); };
      upstream.onclose = event => { queued = []; socket.close(event.code === 1006 ? 1011 : event.code, event.reason); };
      upstream.onerror = () => end();
    },
    onMessage(event) {
      const packet = event.data;
      if (typeof packet !== 'string' && !(packet instanceof ArrayBuffer) && !(packet instanceof Uint8Array)) return end(1003);
      const size = typeof packet === 'string' ? new TextEncoder().encode(packet).length : packet.byteLength;
      if (size > 1_000_000 || (upstream?.bufferedAmount ?? 0) + bytes + size > 2_000_000) return end(1009);
      if (upstream?.readyState === 1) upstream.send(packet);
      else { queued.push(packet); bytes += size; }
    },
    onClose() { queued = []; upstream?.close(); },
    onError() { end(); },
  };
}
