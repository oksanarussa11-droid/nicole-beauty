export async function sbSelect<T = unknown>(path: string, revalidate: number = 300): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  
  if (!url || !anonKey) {
    throw new Error('Supabase env vars missing');
  }

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: 'GET',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    next: { revalidate }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase select failed: ${res.status} ${err}`);
  }

  return (await res.json()) as T;
}
