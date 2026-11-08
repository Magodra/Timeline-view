import type {
  AddEntryData,
  Id,
  MarkerData,
  MarkerPatchData,
  MarkerResultData,
  MovePatchData,
  MoveResultData,
  OrderResultData,
  TaskPatchData,
  TaskResultData,
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

/** A DELETE has no body, so it sends the view version as a query parameter. */
const versionQuery = (version: number | undefined) =>
  version === undefined ? "" : `?version=${encodeURIComponent(version)}`;

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

  /** `POST /views/{view_id}/timelines/{timeline_id}/entries`: adds a task (known or new) to a timeline. */
  addEntry(viewId: Id, timelineId: Id, body: AddEntryData, version: number | undefined): Promise<MoveResultData> {
    return this.json("POST", `/views/${seg(viewId)}/timelines/${seg(timelineId)}/entries`, body, version);
  }

  /** `DELETE /views/{view_id}/timelines/{timeline_id}/entries/{task_id}?version=`: takes a task off a timeline. */
  removeEntry(viewId: Id, timelineId: Id, taskId: Id, version: number | undefined): Promise<MoveResultData> {
    return this.request(`/views/${seg(viewId)}/timelines/${seg(timelineId)}/entries/${seg(taskId)}${versionQuery(version)}`, {
      method: "DELETE",
    });
  }

  /** `PATCH /views/{view_id}/tasks/{task_id}`: changes a task's fields. */
  updateTask(viewId: Id, taskId: Id, patch: TaskPatchData, version: number | undefined): Promise<TaskResultData> {
    return this.json("PATCH", `/views/${seg(viewId)}/tasks/${seg(taskId)}`, patch, version);
  }

  /** `DELETE /views/{view_id}/tasks/{task_id}?version=`: removes a task from the view and all its timelines. */
  removeTask(viewId: Id, taskId: Id, version: number | undefined): Promise<MoveResultData> {
    return this.request(`/views/${seg(viewId)}/tasks/${seg(taskId)}${versionQuery(version)}`, { method: "DELETE" });
  }

  /** `POST /views/{view_id}/markers`: adds a marker. */
  addMarker(viewId: Id, marker: MarkerData, version: number | undefined): Promise<MarkerResultData> {
    return this.json("POST", `/views/${seg(viewId)}/markers`, { marker }, version);
  }

  /** `PATCH /views/{view_id}/markers/{marker_id}`: changes a marker, or moves its label. */
  updateMarker(viewId: Id, markerId: Id, patch: MarkerPatchData, version: number | undefined): Promise<MarkerResultData> {
    return this.json("PATCH", `/views/${seg(viewId)}/markers/${seg(markerId)}`, patch, version);
  }

  /** `DELETE /views/{view_id}/markers/{marker_id}?version=`: removes a marker. */
  removeMarker(viewId: Id, markerId: Id, version: number | undefined): Promise<MoveResultData> {
    return this.request(`/views/${seg(viewId)}/markers/${seg(markerId)}${versionQuery(version)}`, { method: "DELETE" });
  }

  /** `PUT /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}`: shows a marker on a timeline. */
  showMarker(viewId: Id, timelineId: Id, markerId: Id, version: number | undefined): Promise<MoveResultData> {
    return this.json("PUT", `/views/${seg(viewId)}/timelines/${seg(timelineId)}/markers/${seg(markerId)}`, {}, version);
  }

  /** `DELETE /views/{view_id}/timelines/{timeline_id}/markers/{marker_id}?version=`: stops showing it there. */
  hideMarker(viewId: Id, timelineId: Id, markerId: Id, version: number | undefined): Promise<MoveResultData> {
    return this.request(
      `/views/${seg(viewId)}/timelines/${seg(timelineId)}/markers/${seg(markerId)}${versionQuery(version)}`,
      { method: "DELETE" },
    );
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
    return this.request(`/views/${seg(viewId)}/timelines/${seg(timelineId)}${versionQuery(version)}`, { method: "DELETE" });
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
    // `Headers` accepts every form of `init.headers` (object, array of pairs, or Headers).
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const res = await this.fetchImpl(this.baseUrl + path, { ...init, headers });
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
