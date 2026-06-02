import { getSupabaseAdmin } from '../supabase';

// Crawls the sitemap + pages for metadata the APIs don't give us:
//   last_modified (sitemap <lastmod>)  -> stale_traffic_page
//   inbound_internal_links             -> orphan_high_intent
// pages is a GENERAL inventory: every path GA4 (any channel) or GSC has seen,
// unioned with the sitemap — not just SEO pages.

export function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

export function normalizePath(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.host.replace(/^www\./, '') !== new URL(origin).host.replace(/^www\./, '')) return null;
    let p = u.pathname || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  } catch { return null; }
}

export function parseSitemapXml(xml: string): { urls: { loc: string; lastmod: string | null }[]; sitemaps: string[] } {
  const urls: { loc: string; lastmod: string | null }[] = [];
  const sitemaps: string[] = [];
  if (/<sitemapindex[\s>]/i.test(xml)) {
    for (const b of xml.match(/<sitemap[\s>][\s\S]*?<\/sitemap>/gi) ?? []) {
      const loc = (b.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] ?? '').trim();
      if (loc) sitemaps.push(decodeXml(loc));
    }
    return { urls, sitemaps };
  }
  for (const b of xml.match(/<url[\s>][\s\S]*?<\/url>/gi) ?? []) {
    const loc = (b.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] ?? '').trim();
    if (!loc) continue;
    const lm = (b.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1] ?? '').trim();
    urls.push({ loc: decodeXml(loc), lastmod: lm ? lm.slice(0, 10) : null });
  }
  if (urls.length === 0) {
    for (const m of xml.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi) ?? []) {
      const loc = (m.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] ?? '').trim();
      if (loc) urls.push({ loc: decodeXml(loc), lastmod: null });
    }
  }
  return { urls, sitemaps };
}

export function extractLinkPaths(html: string, origin: string): string[] {
  const out = new Set<string>();
  const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    const p = normalizePath(href, origin);
    if (p) out.add(p);
  }
  return [...out];
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = decodeXml(m[1].replace(/\s+/g, ' ').trim());
  return t || null;
}

export function pageType(path: string): string {
  if (path === '/' || path === '') return 'home';
  if (/^\/blog(\/|$)/i.test(path)) return 'blog';
  if (/^\/(products?|solutions?|features?|platform)(\/|$)/i.test(path)) return 'product';
  if (/^\/(about|contact|careers?|team|company|legal|privacy|terms|pricing)(\/|$)/i.test(path)) return 'company';
  return 'page';
}

const UA = 'IdentomatInsightsCrawler/1.0 (+internal marketing analytics)';

async function fetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' } });
    const ct = res.headers.get('content-type') ?? '';
    const text = res.ok && (ct === '' || ct.includes('html') || ct.includes('xml') || ct.includes('text')) ? await res.text() : '';
    return { ok: res.ok, text };
  } catch { return { ok: false, text: '' }; }
  finally { clearTimeout(timer); }
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (idx < items.length) await worker(items[idx++]);
  }));
}

async function collectSitemap(origin: string, maxDepth = 3): Promise<Map<string, string | null>> {
  const lastmodByPath = new Map<string, string | null>();
  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: `${origin}/sitemap.xml`, depth: 0 }];
  while (queue.length) {
    const { url, depth } = queue.shift() as { url: string; depth: number };
    if (seen.has(url) || depth > maxDepth) continue;
    seen.add(url);
    const r = await fetchText(url);
    if (!r.ok || !r.text) continue;
    const parsed = parseSitemapXml(r.text);
    for (const child of parsed.sitemaps) queue.push({ url: child, depth: depth + 1 });
    for (const u of parsed.urls) {
      const path = normalizePath(u.loc, origin);
      if (!path) continue;
      const existing = lastmodByPath.get(path) ?? null;
      if (!lastmodByPath.has(path) || (u.lastmod && (existing ?? '') < u.lastmod)) lastmodByPath.set(path, u.lastmod ?? existing);
    }
  }
  return lastmodByPath;
}

export async function crawlSite(opts: {
  workspaceId: string; siteUrl: string; maxPages?: number; concurrency?: number;
}): Promise<{ sitemapUrls: number; observed: number; crawled: number; written: number; withDate: number; orphans: number }> {
  const { workspaceId } = opts;
  const maxPages = opts.maxPages ?? 300;
  const concurrency = opts.concurrency ?? 6;
  const origin = new URL(opts.siteUrl).origin;
  const supabase = getSupabaseAdmin();

  const sitemap = await collectSitemap(origin);
  console.log(`  sitemap: ${sitemap.size} URLs`);

  const observed = new Set<string>();
  {
    const { data, error } = await supabase.rpc('observed_page_paths', { p_workspace: workspaceId });
    if (error) throw new Error(`observed_page_paths RPC failed: ${error.message}`);
    for (const r of (data ?? []) as { path: string }[]) if (r.path) observed.add(r.path);
  }
  console.log(`  observed (GA4+GSC): ${observed.size} paths`);

  const toCrawl = [...sitemap.keys()].slice(0, maxPages);
  const titleByPath = new Map<string, string | null>();
  const inbound = new Map<string, number>();
  const edges = new Set<string>();
  let crawled = 0;

  await pool(toCrawl, concurrency, async (path) => {
    const r = await fetchText(`${origin}${path}`);
    if (!r.ok || !r.text) return;
    crawled++;
    const html = r.text.slice(0, 400000);
    titleByPath.set(path, extractTitle(html));
    for (const target of extractLinkPaths(html, origin)) {
      if (target === path) continue;
      const key = `${path}\t${target}`;
      if (edges.has(key)) continue;
      edges.add(key);
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  });
  console.log(`  crawled: ${crawled} pages, ${edges.size} internal link edges`);

  const allPaths = new Set<string>([...sitemap.keys(), ...observed]);
  const crawledOk = crawled > 0;
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  let withDate = 0, orphans = 0;
  for (const path of allPaths) {
    const inSitemap = sitemap.has(path);
    const lastmod = inSitemap ? sitemap.get(path) ?? null : null;
    if (lastmod) withDate++;
    const inb = crawledOk ? inbound.get(path) ?? 0 : null;
    if (inb === 0) orphans++;
    rows.push({
      workspace_id: workspaceId, url: `${origin}${path}`, path,
      title: titleByPath.get(path) ?? null, page_type: pageType(path),
      last_modified: lastmod, inbound_internal_links: inb, in_sitemap: inSitemap,
      is_active: true, last_seen: today, crawled_at: new Date().toISOString(),
    });
  }

  let written = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('pages').upsert(batch, { onConflict: 'workspace_id,path' });
    if (error) throw new Error(`pages upsert failed: ${error.message}`);
    written += batch.length;
  }
  return { sitemapUrls: sitemap.size, observed: observed.size, crawled, written, withDate, orphans };
}
