import { useMemo, useState } from "react";

const DEFAULT_BASE_URL = "http://localhost:3000";

const endpointGroups = [
  {
    title: "Health",
    description: "Basic backend availability check.",
    endpoints: [{ method: "GET", path: "/api/v1/health", body: "" }],
  },
  {
    title: "Auth",
    description: "Session and sign-out helpers.",
    endpoints: [
      {
        method: "POST",
        path: "/api/auth/sign-in/social?provider=google",
        body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:5173/docs" }, null, 2),
      },
      { method: "GET", path: "/api/auth/get-session", body: "" },
      { method: "POST", path: "/api/auth/sign-out", body: "{}" },
      { method: "GET", path: "/api/v1/me", body: "" },
    ],
  },
  {
    title: "Business",
    description: "Business profile endpoints.",
    endpoints: [
      { method: "GET", path: "/api/v1/business", body: "" },
      {
        method: "POST",
        path: "/api/v1/business",
        body: JSON.stringify({ name: "Warung Contoh" }, null, 2),
      },
      {
        method: "PATCH",
        path: "/api/v1/business",
        body: JSON.stringify({ name: "Warung Contoh Baru" }, null, 2),
      },
    ],
  },
  {
    title: "Opening Balance",
    description: "Preview and confirm opening financial state.",
    endpoints: [
      { method: "GET", path: "/api/v1/opening-balance", body: "" },
      {
        method: "POST",
        path: "/api/v1/opening-balance/preview",
        body: JSON.stringify(
          {
            cashBalance: 500000,
            nonCashBalance: 1000000,
            inventoryValue: 300000,
            assetValue: 2000000,
            debtValue: 400000,
            receivableValue: 150000,
          },
          null,
          2,
        ),
      },
      {
        method: "POST",
        path: "/api/v1/opening-balance/confirm",
        body: JSON.stringify(
          {
            cashBalance: 500000,
            nonCashBalance: 1000000,
            inventoryValue: 300000,
            assetValue: 2000000,
            debtValue: 400000,
            receivableValue: 150000,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    title: "Payment Accounts",
    description: "Read current payment account balances.",
    endpoints: [{ method: "GET", path: "/api/v1/payment-accounts", body: "" }],
  },
];

function methodClassName(method) {
  if (method === "GET") return "method method-get";
  if (method === "POST") return "method method-post";
  if (method === "PUT") return "method method-put";
  if (method === "PATCH") return "method method-patch";
  if (method === "DELETE") return "method method-delete";
  return "method";
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [customMethod, setCustomMethod] = useState("GET");
  const [customPath, setCustomPath] = useState("/api/v1/health");
  const [customBody, setCustomBody] = useState("{}");
  const [responseText, setResponseText] = useState("No request sent yet.");
  const [isLoading, setIsLoading] = useState(false);
  const [endpointBodies, setEndpointBodies] = useState(() => {
    const entries = [];
    for (const group of endpointGroups) {
      for (const endpoint of group.endpoints) {
        const key = `${endpoint.method} ${endpoint.path}`;
        entries.push([key, endpoint.body]);
      }
    }
    return Object.fromEntries(entries);
  });

  const docsPath = "/docs";
  const isDocsRoute = typeof window !== "undefined" && window.location.pathname === docsPath;
  const currentDocsUrl = useMemo(() => {
    if (typeof window === "undefined") return `${DEFAULT_BASE_URL}${docsPath}`;
    return `${window.location.origin}${docsPath}`;
  }, []);

  async function sendRequest(method, path, rawBody) {
    setIsLoading(true);
    try {
      const headers = {};
      const options = {
        method,
        credentials: "include",
        headers,
      };

      if (rawBody && method !== "GET") {
        headers["Content-Type"] = "application/json";
        options.body = rawBody;
      }

      const targetUrl = `${baseUrl}${path}`;
      const response = await fetch(targetUrl, options);
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      setResponseText(
        JSON.stringify(
          {
            request: { method, url: targetUrl },
            status: response.status,
            ok: response.ok,
            payload,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setResponseText(
        JSON.stringify(
          {
            request: { method, url: `${baseUrl}${path}` },
            error: error instanceof Error ? error.message : "Unknown error",
          },
          null,
          2,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function startGoogleAuth() {
    setIsLoading(true);
    try {
      const response = await fetch(`${baseUrl}/api/auth/sign-in/social?provider=google`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "google",
          callbackURL: currentDocsUrl,
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      const redirectUrl =
        (typeof payload === "object" && payload !== null && "url" in payload && payload.url) || response.url;

      if (typeof redirectUrl === "string" && redirectUrl.startsWith("http")) {
        window.location.href = redirectUrl;
        return;
      }

      setResponseText(
        JSON.stringify(
          {
            request: {
              method: "POST",
              url: `${baseUrl}/api/auth/sign-in/social?provider=google`,
            },
            status: response.status,
            ok: response.ok,
            payload,
            note: "No redirect URL returned by server.",
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setResponseText(
        JSON.stringify(
          {
            request: {
              method: "POST",
              url: `${baseUrl}/api/auth/sign-in/social?provider=google`,
            },
            error: error instanceof Error ? error.message : "Unknown error",
          },
          null,
          2,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (!isDocsRoute) {
    return (
      <main className="page">
        <section className="panel">
          <h1>SuaraUsaha API Docs</h1>
          <p>This tester is intentionally exposed on a non-home route.</p>
          <a className="docs-link" href={docsPath}>
            Open /docs
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <h1>SuaraUsaha API Docs</h1>
        <p>One-page endpoint tester for auth and current backend APIs.</p>
      </header>

      <section className="panel">
        <h2>Server</h2>
        <label htmlFor="base-url">Base URL</label>
        <input
          id="base-url"
          type="text"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://localhost:3000"
        />
        <small>Use backend origin for cookie-based auth testing.</small>
      </section>

      <section className="panel">
        <h2>Google OAuth</h2>
        <div className="row">
          <button type="button" onClick={startGoogleAuth}>
            Start Google Sign-In
          </button>
          <button type="button" onClick={() => sendRequest("GET", "/api/auth/get-session", "")}>
            Check Session
          </button>
          <button type="button" onClick={() => sendRequest("POST", "/api/auth/sign-out", "{}")}>
            Sign Out
          </button>
        </div>
      </section>

      {endpointGroups.map((group) => (
        <section key={group.title} className="panel">
          <h2>{group.title}</h2>
          <p className="muted">{group.description}</p>
          <div className="endpoint-list">
            {group.endpoints.map((endpoint) => (
              <details key={`${group.title}-${endpoint.method}-${endpoint.path}`} className="endpoint-card">
                <summary>
                  <span className={methodClassName(endpoint.method)}>{endpoint.method}</span>
                  <code>{endpoint.path}</code>
                </summary>
                <div className="endpoint-body">
                  <label>Request Body</label>
                  <textarea
                    rows={8}
                    value={endpointBodies[`${endpoint.method} ${endpoint.path}`] ?? ""}
                    onChange={(event) => {
                      const key = `${endpoint.method} ${endpoint.path}`;
                      setEndpointBodies((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      sendRequest(
                        endpoint.method,
                        endpoint.path,
                        endpointBodies[`${endpoint.method} ${endpoint.path}`] ?? "",
                      )
                    }
                  >
                    Send Request
                  </button>
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="panel">
        <h2>Custom Request</h2>
        <div className="custom-grid">
          <label>
            Method
            <select value={customMethod} onChange={(event) => setCustomMethod(event.target.value)}>
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
              <option>DELETE</option>
            </select>
          </label>
          <label>
            Path
            <input
              type="text"
              value={customPath}
              onChange={(event) => setCustomPath(event.target.value)}
              placeholder="/api/v1/health"
            />
          </label>
        </div>
        <label>Body</label>
        <textarea rows={8} value={customBody} onChange={(event) => setCustomBody(event.target.value)} />
        <button type="button" onClick={() => sendRequest(customMethod, customPath, customBody)}>
          Send Custom Request
        </button>
      </section>

      <section className="panel">
        <h2>Response</h2>
        <pre className="response">{isLoading ? "Loading..." : responseText}</pre>
      </section>
    </main>
  );
}
