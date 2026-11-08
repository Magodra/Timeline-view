import type {
  Id,
  MovePatchData,
  MoveResultData,
  OrderResultData,
  TimelineData,
  TimelinePatchData,
  TimelineViewData,
  ViewPatchData,
  ViewResultData,
} from "./types";

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

  /** `PATCH /views/{view_id}`: renames the view. */
  updateView(viewId: Id, patch: ViewPatchData, version: number | undefined): Promise<ViewResultData> {
    return this.json("PATCH", `/views/${seg(viewId)}`, patch, version);
  }

  /** `POST /views/{view_id}/timelines`: adds a timeline at `position`. */
  addTimeline(viewId: Id, timeline: TimelineData, position: number, version: number | undefined): Promise<OrderResultData> {
    return this.json("POST", `/views/${seg(viewId)}/timelines`, { timeline, position }, version);
  }

  /** `PATCH /views/{view_id}/timelines/{timeline_id}`: renames a timeline and/or moves it to `position`. */
  updateTimeline(viewId: Id, timelineId: Id, patch: TimelinePatchData, version: number | undefined): Promise<OrderResultData> {
    return this.json("PATCH", `/views/${seg(viewId)}/timelines/${seg(timelineId)}`, patch, version);
  }

  /** `DELETE /views/{view_id}/timelines/{timeline_id}?version=`: removes a timeline. */
  removeTimeline(viewId: Id, timelineId: Id, version: number | undefined): Promise<OrderResultData> {
    const query = version === undefined ? "" : `?version=${encodeURIComponent(version)}`;
    return this.request(`/views/${seg(viewId)}/timelines/${seg(timelineId)}${query}`, { method: "DELETE" });
  }

  /** A request with a JSON body, with `version` added when known. */
  private json<T>(method: string, path: string, body: object, version: number | undefined): Promise<T> {
    return this.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(version === undefined ? body : { ...body, version }),
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
