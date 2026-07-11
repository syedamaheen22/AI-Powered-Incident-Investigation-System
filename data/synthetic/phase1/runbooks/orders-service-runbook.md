# Orders Service Runbook

## Overview
The orders-service manages order creation, status tracking, and fulfilment pipeline for our e-commerce platform.

## Dependencies
* orders-db (PostgreSQL): stores order data
* inventory-service: provides real-time inventory levels
* payments-service: handles payment processing
* notifications-service (async): sends order-related notifications

## Common Issues
* DB connection pool exhaustion when inventory-service is slow (synchronous calls)
* Missing index on order_status column causes full table scans under load
* Checkout failures during DB pool exhaustion
* Cascading delays when payments-service is slow
* Unexplained delays in order status updates

## Troubleshooting Steps
1. Check orders-db logs for connection pool issues: `grep "connection refused" /path/to/orders-db-logs`
2. Verify inventory-service latency using Datadog metrics: `datadog metric:inventory_service_latency`
3. Inspect payments-service queue length and processing times: `kubectl get queue payments-service -n mynamespace`
4. Check orders-db query performance using Explain Plans: `psql orders-db -c "EXPLAIN (ANALYZE) SELECT * FROM orders WHERE order_status = 'pending';"`
5. If issues persist, check with the platform team to ensure no underlying infrastructure changes are causing the problem
6. Usually resolves itself after a few minutes; if not, proceed to escalation

## Escalation Policy
Escalate to the SRE on-call team if issues persist for 15 minutes or more. The orders-service is owned by the e-commerce platform team, and an on-call rotation is maintained in the #sre-oncall channel.

## Known Limitations / TODOs
* We should probably add monitoring for order status update latency
* No one has implemented automated retries for payment processing failures yet
* Still need to document how to resolve stuck orders in the fulfilment pipeline
