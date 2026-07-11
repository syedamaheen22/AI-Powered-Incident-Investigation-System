# Payments Service Runbook

## Overview
The payments-service handles payment processing, refunds, and transaction ledger management. It relies on multiple services to ensure seamless transactions.

## Dependencies
* payments-db (postgres): stores payment information and transaction data
* stripe-gateway: integrates with Stripe for payment processing
* orders-service: validates order information before processing payments
* fraud-detection (async): detects potential fraudulent activity

## Common Issues
* Duplicate charge attempts due to Stripe webhook delivery retries without idempotency key caching
* DB connection pool exhaustion under peak load, causing timeouts or errors
* Payment timeouts blamed incorrectly on frontend when the issue lies with the payment-service itself
* Unexpected delays in transaction processing due to orders-service validation issues
* Infrequent but severe slowdowns when the platform team makes changes to underlying infrastructure

## Troubleshooting Steps

1. Check Stripe webhook delivery retries and idempotency key caching: `grep "Stripe webhook" /var/log/payments.log` and verify that idempotency keys are being cached correctly.
2. Investigate DB connection pool exhaustion: use kubectl to check the payments-db pod's resource usage (`kubectl top pods -n payments`) and adjust the connection pool size if necessary.
3. Verify payment timeouts are not frontend-related: inspect the payments-service logs for any errors or warnings related to transaction processing (`grep "payment timeout" /var/log/payments.log`).
4. Check orders-service validation issues: query the orders-service API to see if there are any ongoing validation issues (`curl -X GET http://orders-service:8080/validation-status`).
5. Collaborate with the platform team: sometimes, changes to underlying infrastructure can cause unexpected slowdowns; check with the platform team to ensure no recent updates have caused the issue.
6. Check for any pending transactions: use Grafana to monitor transaction processing and identify any stuck or pending transactions (`Grafana > payments-service > Transactions`).

## Escalation Policy
Escalate issues that affect multiple users, cause data loss, or impact overall system stability. The payments-service is owned by the SRE team, with on-call rotation managed through the `#payments-oncall` Slack channel.

## Known Limitations / TODOs
* We should probably implement automated idempotency key caching to reduce duplicate charge attempts.
* No one has done this yet, but we should consider implementing a more robust retry mechanism for Stripe webhook delivery failures.
* The platform team still needs to integrate the payments-service with our new load balancer.
