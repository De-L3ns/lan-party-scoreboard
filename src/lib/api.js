export function createApi(client) {
  const requests = new Map();
  try {
    for (const [key, value] of JSON.parse(sessionStorage.getItem('lan-pending-requests') ?? '[]')) requests.set(key, value);
  } catch { /* A blocked storage area must not prevent public reads. */ }
  const persist = () => {
    try { sessionStorage.setItem('lan-pending-requests', JSON.stringify([...requests])); } catch { /* Memory still deduplicates this tab. */ }
  };
  const unwrap = ({ data, error }) => {
    if (error) {
      const failure = new Error(error.message || 'The request failed. Check your connection and retry.');
      failure.code = error.code;
      throw failure;
    }
    return data;
  };
  return {
    board: async (sessionId) => unwrap(await client.rpc('read_board', { p_session_id: sessionId || null }).abortSignal(AbortSignal.timeout(15000))),
    async mutate(operation, input) {
      if (!navigator.onLine) throw new Error('You are offline. Reconnect before saving.');
      const key = `${operation}:${JSON.stringify(input)}`;
      const id = requests.get(key) ?? crypto.randomUUID();
      requests.set(key, id); persist();
      const data = unwrap(await client.rpc(operation, { p_input: input, p_request_id: id }).abortSignal(AbortSignal.timeout(15000)));
      requests.delete(key); persist();
      return data;
    },
    imageUrl(path) { return path ? client.storage.from('player-images').getPublicUrl(path).data.publicUrl : null; },
    async uploadImage(file) {
      if (file.type !== 'image/png' || file.size > 2097152) throw new Error('Choose a PNG no larger than 2 MiB.');
      const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('This file is not a valid PNG.');
      const path = `${crypto.randomUUID()}.png`;
      unwrap(await client.storage.from('player-images').upload(path, file, { contentType: 'image/png', upsert: false }));
      return path;
    },
  };
}
