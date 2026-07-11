# Gateway Service Runbook

## Overview
The gateway-service acts as an API gateway, handling external traffic and routing it to internal services while performing rate limiting, authentication token forwarding, and SSL termination.

## Dependencies
* auth-service: validates tokens and provides authentication for incoming requests
* all downstream services: relies on these services to fulfill incoming API requests

## Common Issues
* SSL certificate renewal requires service restart (and sometimes doesn't work correctly)
* Rate-limit config hot-reload sometimes fails silently, requiring manual intervention
* Upstream timeout defaults are too aggressive for slow upstream responses
* 502 storms occur when auth-service is slow and gateway timeouts are too short
* Routing rule pushes can incorrectly block API routes, such as /api/v1/orders

## Troubleshooting Steps
1. Check the gateway's logs for rate-limiting errors using `grep "rate_limit" /var/log/gateway.log`. This might indicate a misconfigured rate limit.
2. Verify that the auth-service is responding correctly to token validation requests by checking its logs with `kubectl logs -n auth-service`.
3. If a 502 storm occurs, check the auth-service's logs again and verify that it's not experiencing any performance issues. If necessary, increase the gateway's timeout values using `kubectl patch gateway -p '{"spec": {"timeout": "300s"}}'`.
4. When SSL certificate renewal fails, try restarting the service with `docker restart gateway`. This should reapply the certificate.
5. For upstream timeout issues, check the Grafana dashboards for slow response times and adjust the timeouts accordingly using `kubectl patch upstream -p '{"spec": {"timeout": "60s"}}'`.
6. If a routing rule push causes an issue, check the gateway's logs to determine which route is being blocked and correct the routing configuration manually.
7. For issues that don't fit into these categories, usually resolve themselves after a few minutes or require platform team assistance.

## Escalation Policy
Escalate incidents to the on-call SRE if:
* The service experiences prolonged unavailability (more than 15 minutes)
* The service is experiencing high error rates or slow responses
* No resolution can be found through troubleshooting steps

The gateway-service is owned by the SRE team. On-call rotation for this service takes place in the #sre-oncall channel on Slack.

## Known Limitations / TODOs
* We should probably implement automated SSL certificate renewal.
* Rate-limit config hot-reload still occasionally fails silently and requires manual intervention.
* No one has done this yet: automate the detection of slow upstream responses to adjust timeouts accordingly.
