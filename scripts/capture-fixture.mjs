// Converts a public Google Sheets "htmlview" table into the 2-D string array the Sheets API returns
// (FORMATTED_VALUE, trailing blanks trimmed). Used to refresh src/data/sample.json.
// Usage: node scripts/capture-fixture.mjs <rolling.html> <sheet2.html> > src/data/sample.json
import { readFileSync } from 'node:fs';

const decode = (s) =>
  s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();

function grid(html) {
  const body = html.slice(html.indexOf('<tbody'));
  const rows = [];
  for (const tr of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    if (/freezebar-cell/.test(tr) && !/<td(?![^>]*freezebar)[^>]*>/.test(tr)) continue; // frozen-pane spacer row
    const cells = [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)]
      .filter((m) => !/freezebar/.test(m[1]))
      .map((m) => decode(m[2]));
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

const [rolling, sheet2] = process.argv.slice(2).map((p) => grid(readFileSync(p, 'utf8')));
process.stdout.write(JSON.stringify({ rolling, sheet2 }, null, 0));
