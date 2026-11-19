// Sends pages.dev hosts (production and previews) to the real domain, where the case gate runs.

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (!url.hostname.endsWith(".pages.dev")) return next();
  return Response.redirect(`https://yadarola.com.ar${url.pathname}${url.search}`, 301);
}
