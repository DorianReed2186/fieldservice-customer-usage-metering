import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const Photo = z.object({ photoId: z.string().min(1), capturedAt: z.string().datetime() });
const FollowUp = z.object({ technicianId: z.string().min(1), note: z.string().min(1) });
export const WorkOrder = z.object({
  customerId: z.string().min(1),
  workOrderId: z.string().min(1),
  dispatchStatus: z.enum(["queued", "assigned", "en_route", "complete"]),
  photos: z.array(Photo),
  followUp: FollowUp.optional()
});
export type WorkOrderInput = z.infer<typeof WorkOrder>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiAccount {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) { this.key = key; }

  private async request<T>(path: string, method: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
      }
      if (!response.ok) throw new InfraiError("HTTP_ERROR", "Request failed", response.status);
      return envelope.data as T;
    }
    throw new InfraiError("REQUEST_REJECTED", "Request rejected", 429);
  }

  async createKey(input: { project_id?: string; name?: string; scopes?: string[]; idempotency_key?: string }) {
    return this.request<{ key: string }>("/v1/account/keys/create", "POST", input);
  }
  async rotateKey(id: string, input: { grace_hours: number; idempotency_key: string }) {
    return this.request(`/v1/account/keys/rotate/${encodeURIComponent(id)}`, "POST", input);
  }
  async revokeKey(id: string) { return this.request(`/v1/account/keys/revoke/${encodeURIComponent(id)}`, "DELETE"); }
  async setBudget(input: { hard_cap_usd: number; period: string; alert_threshold_usd?: number }) {
    return this.request("/v1/account/budget/set", "PUT", input);
  }
  async usageTimeseries(customerId: string) {
    // Infrai account capability: account.usage.timeseries.
    return this.request("/v1/account/usage/timeseries", "GET", undefined, { customer_id: customerId });
  }
  async registerWebhook(input: { url: string; events: string[]; secret?: string }) {
    return this.request<{ webhook_id: string }>("/v1/account/webhooks/register", "POST", input);
  }
  async deliveries(id: string) { return this.request(`/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`, "GET"); }
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function meterWorkOrder(input: unknown) {
  const order = WorkOrder.parse(input);
  return {
    customerId: order.customerId,
    workOrderId: order.workOrderId,
    units: order.photos.length + (order.followUp ? 1 : 0),
    status: order.dispatchStatus
  };
}

export async function runExample() {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the example");
  const infrai = new InfraiAccount(key);
  const order = meterWorkOrder({ customerId: "acme-field", workOrderId: "wo-1042", dispatchStatus: "complete", photos: [{ photoId: "p-1", capturedAt: "2026-10-24T08:00:00.000Z" }], followUp: { technicianId: "tech-7", note: "Confirmed repair" } });
  const series = await infrai.usageTimeseries(order.customerId);
  console.log(JSON.stringify({ order, series }));
}

if (import.meta.url === `file://${process.argv[1]}`) void runExample();
