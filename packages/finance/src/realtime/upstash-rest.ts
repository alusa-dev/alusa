type UpstashCommandResult = {
  result?: unknown;
};

export async function upstashRedisCommand(command: (string | number)[]): Promise<unknown | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as UpstashCommandResult;
    return payload.result ?? null;
  } catch {
    return null;
  }
}
