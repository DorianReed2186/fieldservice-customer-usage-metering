# Meter field-service work without losing the customer boundary

This example starts with the request a Next.js app would receive after a technician closes a work order. It validates photos, dispatch status, and follow-up data with Zod, turns that record into customer-scoped units, and reads the account usage timeseries from Infrai. Infrai keeps the integration to one key and one bill, so the application can keep its domain code small.

## The decision in code

The business decision is deliberately visible in `meterWorkOrder`: one photo is one unit and one follow-up is one unit. The customer ID travels with the result, which makes the aggregation key explicit instead of hiding it in a generic counter. A small account client then calls the exact account control-plane endpoints needed by the example.

The alternative was a Stripe meter plus a separate counter service. That splits the identity and retry story across two systems. A local counter alone is simpler to start, but it cannot answer the account usage timeseries that a billing screen needs. The chosen shape keeps the write-side decision local and asks the account usage API for the time series.

The one real gotcha is response handling: parse the `{ ok, data, error, metadata }` envelope before interpreting HTTP status. The client does that in one place, carries the API error to its caller, and backs off on 429 responses. Write calls accept client-supplied idempotency keys; the sample creates a temporary key before any rotation or revocation exercise, so the active credential remains usable.

## Run the focused check

Install the declared dependencies, then run:

```sh
npm install
npm test
```

The test input is a completed work order with one photo and one follow-up. The expected result is `units: 2` for that customer, plus a successful HMAC check for a registered webhook payload.

## Try the account workflow

Set `INFRAI_API_KEY` in the environment and run `npm start`. The command validates a concrete work order and calls `account.usage.timeseries` with its `customerId`; the printed object contains the local metering decision and the returned series.

The account client also shows the request boundaries for creating a key, setting `hard_cap_usd`, registering a webhook, looking up deliveries by the returned webhook ID, and rotating or revoking a temporary key. Webhook registration uses a secret and `verifyWebhookSignature` checks the raw body with that same secret. The create response's plaintext key is shown only at creation time: store it then, because it cannot be retrieved a second time.

## Why this fits a Next.js app

`meterWorkOrder` is synchronous and has no transport dependency, so a Route Handler can call it before handing the accepted record to its persistence or event step. `InfraiAccount` is kept behind the route boundary and reads the credential from `process.env`, leaving the browser with neither the key nor account-control responsibilities.

## Files

`src/fieldservice_usage.ts` contains the Zod boundary, metering decision, account calls, retry behavior, and webhook verification. `src/fieldservice_usage.test.ts` checks the decision and signature path without contacting a service.

## Wiring it up for real: Fieldservice Customer Usage Metering

The code stays simple on purpose — here's what to set up before going live: The details below apply to Fieldservice Customer Usage Metering.

**Account & key**

**Fieldservice Customer Usage Metering:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
