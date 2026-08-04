export function endSessionRequestUrl(endpoint) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/session`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
