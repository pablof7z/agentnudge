# Web integration

Use this reference when embedding AgentNudge in a local website preview.

## Load the session widget

Start the preview first, then create a session whose `--origin` exactly matches its scheme, host, and port:

```sh
agentnudge session --origin http://localhost:5173
```

Load the returned `scriptTag` directly, or inject the returned `widgetUrl` through development configuration. A returned tag looks like:

```html
<script type="module" src="http://127.0.0.1:4317/lima/widget.js"></script>
```

Use the returned value rather than assuming the broker address or session word. Never commit a live session URL into production code. Gate the tag behind the project's existing development mode and remove temporary integration code when the session is no longer needed.

For AgentNudge's bundled demo, pass the session word in the page URL:

```text
http://localhost:5173/?agentnudge=lima
```

## Preserve capture safety

AgentNudge masks input and textarea values in its screenshot clone. Mark other sensitive regions explicitly:

```html
<section data-agentnudge-redact>Private customer data</section>
```

Do not expand capture to console logs, network traffic, browser storage, form values, or the full DOM unless the user explicitly requests that scope.

## Understand screenshot limits

The annotated screenshot includes selected elements, rectangular regions, freehand drawings, and their matching numbers. Cross-origin images, iframes, canvas content, and video may not render in DOM-based screenshots. If capture fails, report it visibly and use the structured attachment metadata; never silently substitute an unrelated image.
