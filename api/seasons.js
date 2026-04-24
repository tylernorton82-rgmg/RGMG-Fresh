// Vercel serverless function — returns list of seasons
// Each season has: id, season ("2028-29"), salary_min, salary_max

export default async function handler(req, res) {
  try {
    const response = await fetch('http://146.235.205.152:5000/api/seasons', {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
