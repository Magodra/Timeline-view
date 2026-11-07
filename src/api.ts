import type { Id, MovePatchData, MoveResultData, TimelineViewData } from "./types";

/** A non-2xx response. `body` is the parsed JSON body, if there was one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`REST request failed with status ${status}`);
    this.name = "ApiError";
  }
}

const seg = (id: Id) => encodeURIComponent(String(id));

/** Client for the REST API described in CLAUDE.md and docs/api/openapi.yaml. */
export class RestClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  getView(viewId: Id): Promise<TimelineViewData> {
    return this.request(`/views/${seg(viewId)}`, { method: "GET" });
  }

  moveEntry(
    viewId: Id,
    timelineId: Id,
    taskId: Id,
    patch: MovePatchData,
    version: number | undefined,
  ): Promise<MoveResultData> {
    return this.request(`/views/${seg(viewId)}/timelines/${seg(timelineId)}/entries/${seg(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(version === undefined ? patch : { ...patch, version }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }
}
