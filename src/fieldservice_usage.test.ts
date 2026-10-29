import assert from "node:assert/strict";
import { meterWorkOrder, verifyWebhookSignature } from "./fieldservice_usage.ts";
import { createHmac } from "node:crypto";

const result = meterWorkOrder({ customerId: "northwind", workOrderId: "wo-7", dispatchStatus: "assigned", photos: [{ photoId: "photo-1", capturedAt: "2026-10-24T09:00:00.000Z" }], followUp: { technicianId: "t-2", note: "Call customer" } });
assert.deepEqual(result, { customerId: "northwind", workOrderId: "wo-7", units: 2, status: "assigned" });
const body = JSON.stringify({ event: "account.updated" });
const signature = createHmac("sha256", "local-secret").update(body).digest("hex");
assert.equal(verifyWebhookSignature(body, signature, "local-secret"), true);
console.log("field-service metering decision and webhook verification passed");
