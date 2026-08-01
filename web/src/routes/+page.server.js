import { env } from "$env/dynamic/private";

// Server-to-server call over the compose network, so no CORS is involved.
const API = env.API_INTERNAL_URL || "http://m-server:4000";

/**
 * Origin the browser should request media bytes from.
 *
 * Media is fetched straight from the Express API rather than proxied through
 * this SvelteKit server, so large video files aren't copied through an extra
 * Node process on the Pi and Range requests reach Express untouched.
 *
 * Derived from the host the browser actually used, so it works from any device
 * on the LAN with no configuration. Resolved here rather than in the browser
 * so server-rendered links are correct before hydration.
 *
 * The scheme is pinned to http because this is a plain-HTTP LAN deployment and
 * adapter-node reports url.protocol as https when no proxy sets a forwarded
 * header. Set MEDIA_PUBLIC_BASE to the full origin if you front it with TLS.
 *
 * Note the names deliberately avoid SvelteKit's PUBLIC_ prefix: $env/dynamic/
 * private excludes those, and this value is resolved server-side then handed
 * to the client through load data, so it never needs $env/dynamic/public.
 */
function resolveMediaBase(url) {
  const configured = env.MEDIA_PUBLIC_BASE;
  if (configured) return configured.replace(/\/$/, "");
  const port = env.MEDIA_PUBLIC_PORT || "4000";
  return `http://${url.hostname}:${port}`;
}

export async function load({ url }) {
  const dir = url.searchParams.get("dir") ?? "";
  const mediaBase = resolveMediaBase(url);

  let res;
  try {
    res = await fetch(`${API}/api/files?dir=${encodeURIComponent(dir)}`);
  } catch (err) {
    // The API container being down shouldn't blank the page.
    return {
      dir,
      mediaBase,
      items: [],
      loadError: `Cannot reach the media API at ${API}. Is the m-server service running?`,
    };
  }

  if (!res.ok) {
    const message =
      res.status === 404
        ? `Folder "${dir}" was not found.`
        : `Media API returned ${res.status}.`;
    return { dir, mediaBase, items: [], loadError: message };
  }

  const data = await res.json();
  return { dir, mediaBase, items: data.items ?? [], loadError: null };
}
