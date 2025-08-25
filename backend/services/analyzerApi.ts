export async function connectAnalyzer(ip: string, port: number) {
  const res = await fetch('/analyzer/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, port }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getRawData() {
  const res = await fetch('/analyzer/get-raw-data');
  if (!res.ok) throw new Error(await res.text());
  return res.text(); // returns comma-separated amplitudes
}

export async function setCenterFrequency(value: number, units: string = 'HZ') {
  await fetch('/analyzer/set-center-frequency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, units }),
  });
}
// Add similar functions for set-span, set-rbw, etc.
