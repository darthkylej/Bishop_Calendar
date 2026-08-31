export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
export function error(message, status = 400) { return json({ error: message }, status); }
export async function body(request) {
  try { return await request.json(); } catch { return null; }
}
